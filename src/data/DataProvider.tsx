import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { DataTransferError } from '../domain/dataTransfer';
import { TodoInputError } from '../domain/todos';
import { TitleInputError } from '../domain/titles';
import { AllDayInputError } from '../domain/allDayDates';
import type { DayPopUserData } from '../domain/types';
import { calendarDeletionPlan } from '../domain/mutations';
import { canShareCalendars, receivedCalendar, type SharingWriteOptions } from './calendarSharing';
import type { RetainedSharingDraft } from './retainedSharingDraft';
import { LocalDataBlockedError, LocalDayPopRepository } from '../storage/localRepository';
import { CachedRemoteLoadError } from './cachedSupabaseRepository';
import { DataContext, type DataActions, type DataContextValue, type DataState, type SharingConfirmation } from './dataContext';
import {
  canLoadSync,
  canManageEventAttachments,
  type DayPopRepository,
} from './repository';
import { RemoteDataError } from './supabaseRepository';
import { createTodoCompletionFeedback } from './todoCompletionFeedback';

interface DataProviderProps {
  /** Injected by tests. Production uses the guest adapter — see below. */
  repository?: DayPopRepository;
}

/**
 * Owns the active repository and the one copy of the user's data.
 *
 * This is the seam the whole boundary exists for. Screens ask for data and
 * writes; only this component knows which adapter is answering.
 *
 * `SessionDataProvider` chooses the guest or authenticated adapter after Auth
 * resolves. Keeping that decision one level above this component lets an
 * identity change remount the data boundary and discard both the previous
 * snapshot and its pending mutation queue.
 */
export function DataProvider({ children, repository }: PropsWithChildren<DataProviderProps>) {
  const activeRepository = useMemo(
    () => repository ?? new LocalDayPopRepository(),
    [repository],
  );
  const [state, setState] = useState<DataState>(() => bootstrap(activeRepository));
  const todoFeedback = useMemo(() => ({ repository: activeRepository, ...createTodoCompletionFeedback() }), [activeRepository]);
  useLayoutEffect(() => () => todoFeedback.clear(), [todoFeedback]);
  // Bumping this re-runs the async load; the recovery screen uses it after a reset.
  const [generation, setGeneration] = useState(0);
  const pendingWrite = useRef<Promise<void>>(Promise.resolve());
  const pendingWriteCount = useRef(0);
  const [retainedSharingDrafts,setRetainedSharingDrafts]=useState<RetainedSharingDraft[]>([]);
  const keepSharingDraft=useCallback((draft:RetainedSharingDraft)=>{
    setRetainedSharingDrafts(current=>[...current.filter(item=>item.key!==draft.key),draft]);
  },[]);
  const discardSharingDraft=useCallback((key:string)=>setRetainedSharingDrafts(current=>current.filter(item=>item.key!==key)),[]);
  const offline=useRef(typeof navigator!=='undefined' && !navigator.onLine);
  const stateRef=useRef(state);
  useEffect(()=>{stateRef.current=state;},[state]);
  const [confirmation,setConfirmation]=useState<SharingConfirmation|null>(null);
  const settleConfirmation=useRef<((value:boolean)=>void)|null>(null);
  useEffect(()=>()=>{settleConfirmation.current?.(false);},[]);
  const askSharingConfirmation=useCallback((title:string,message:string,confirmLabel:string)=>new Promise<boolean>(resolve=>{
    settleConfirmation.current?.(false);
    const settle=(value:boolean)=>{settleConfirmation.current=null;setConfirmation(null);resolve(value);};
    settleConfirmation.current=settle;
    setConfirmation({title,message,confirmLabel,onConfirm:()=>settle(true),onCancel:()=>settle(false)});
  }),[]);

  const revalidateShares=useCallback(()=>{
    if(!canShareCalendars(activeRepository) || stateRef.current.status!=='ready' || offline.current) return;
    // Foreground reads share the write queue but leave mounted editors intact.
    const scheduled=pendingWrite.current.then(()=>activeRepository.load());
    pendingWrite.current=scheduled.then(data=>{
      if(offline.current) {
        const personal=activeRepository.clearReceived();
        setState(current=>current.status==='ready'?{...current,data:personal,warning:offlineSharingWarning()}:current);
        return;
      }
      setState(current=>current.status==='ready'?{...current,data,
        ...(current.warning?.kind==='cached'?{warning:undefined}:{})}:current);
    },error=>{
      if(error instanceof CachedRemoteLoadError) setState(toFailureState(error));
      else {
        const personal=activeRepository.personalData();
        setState(current=>current.status==='ready'?{...current,data:personal,
          warning:{kind:'cached',message:'目前無法確認分享權限，暫時只顯示自己的資料。'}}:current);
      }
    });
  },[activeRepository]);
  useEffect(()=>{
    if(!canShareCalendars(activeRepository)) return;
    const disconnected=()=>{
      offline.current=true;
      if(stateRef.current.status!=='ready')return;
      const personal=activeRepository.clearReceived();
      setState(current=>current.status==='ready'?{...current,data:personal,warning:offlineSharingWarning()}:current);
    };
    const connected=()=>{offline.current=false;revalidateShares();};
    const visible=()=>{if(document.visibilityState==='visible') revalidateShares();};
    window.addEventListener('focus',revalidateShares);
    window.addEventListener('online',connected);
    window.addEventListener('offline',disconnected);
    document.addEventListener('visibilitychange',visible);
    return ()=>{window.removeEventListener('focus',revalidateShares);window.removeEventListener('online',connected);window.removeEventListener('offline',disconnected);
      document.removeEventListener('visibilitychange',visible);};
  },[activeRepository,revalidateShares]);

  const refresh = useCallback(() => {
    setState(bootstrap(activeRepository));
    setGeneration((current) => current + 1);
  }, [activeRepository]);

  // Only runs for adapters that cannot answer synchronously. The guest adapter
  // has already produced `ready` above, so the first paint shows real data.
  useEffect(() => {
    if (state.status !== 'loading') return;
    let active = true;
    void activeRepository.load().then(
      (data) => {
        if (active) setState(offline.current && canShareCalendars(activeRepository)
          ? {status:'ready',data:activeRepository.clearReceived(),warning:offlineSharingWarning()}
          : { status: 'ready', data });
      },
      (error: unknown) => {
        if (active) setState(toFailureState(error));
      },
    );
    return () => {
      active = false;
    };
  }, [activeRepository, state.status, generation]);

  const actions = useMemo<DataActions>(() => {
    /**
     * Writes reach the repository in call order, whether screens await their
     * confirmation or continue immediately. Remote methods replace their shared
     * snapshot, so merely ignoring a stale response would still allow an
     * earlier request to overwrite durable data after a later request.
     *
     * Both branches handle the result and therefore leave the queue tail
     * resolved. A rejected write reports its failure without poisoning the
     * queue or preventing a write the user already issued from running next.
     */
    function enqueue(operation: () => Promise<DayPopUserData>,options?:SharingWriteOptions): Promise<DayPopUserData> {
      const sharingRepository=canShareCalendars(activeRepository)?activeRepository:null;
      const versions=options?.versions ?? (sharingRepository && stateRef.current.status==='ready' ? sharingRepository.captureSharingVersions() : null);
      pendingWriteCount.current += 1;
      setState((current) =>
        current.status === 'ready' ? { ...current, saving: true } : current,
      );

      const finishWrite = () => {
        pendingWriteCount.current = Math.max(0, pendingWriteCount.current - 1);
        return pendingWriteCount.current > 0;
      };

      const scheduled = pendingWrite.current.then(()=>sharingRepository && versions
        ? sharingRepository.withSharingVersions(versions,operation) : operation());
      pendingWrite.current = scheduled.then(
          (data) => {
            const saving = finishWrite();
            const disconnected=offline.current && canShareCalendars(activeRepository);
            setState({ status: 'ready', data:disconnected?activeRepository.clearReceived():data,
              ...(disconnected?{warning:offlineSharingWarning()}:{}), ...(saving ? { saving: true } : {}) });
          },
          (error: unknown) => {
            const saving = finishWrite();
            setState((current) => {
              const failure = toWriteFailureState(error, current);
              return failure.status === 'ready'
                ? { ...failure, saving }
                : failure;
            });
          },
        );
      return scheduled;
    }

    function run(operation: () => Promise<DayPopUserData>) {
      void enqueue(operation);
    }

    /** Awaitable by sheets; existing fire-and-forget callers remain safe. */
    function confirmed(operation: () => Promise<DayPopUserData>,options?:SharingWriteOptions): Promise<void> {
      const result = enqueue(operation,options).then(() => {});
      // This handles ignored promises without replacing the rejecting result
      // that an awaiting editor needs. enqueue still reports the data warning.
      void result.catch(() => {});
      return result;
    }

    async function confirmReceivedDeletion(id:string,kind:'event'|'todo') {
      if(!canShareCalendars(activeRepository)) return;
      const current=stateRef.current;
      if(current.status!=='ready') return;
      const item=(kind==='event'?current.data.events:current.data.todos).find(item=>item.id===id);
      if(item && receivedCalendar(activeRepository.sharingSession(),item.calendarId)) {
        if(!await askSharingConfirmation('刪除共享事項','刪除後，所有能查看這本日曆的成員都會看不到這項內容。','確認刪除')) throw new SharingCancelledError();
      }
    }
    async function exposureOptions(sourceId:string|undefined,targetId:string|undefined,options?:SharingWriteOptions):Promise<SharingWriteOptions|undefined> {
      if(!canShareCalendars(activeRepository) || !sourceId || !targetId || sourceId===targetId) return options;
      const session=activeRepository.sharingSession();
      const target=session.shares.find(s=>s.calendarId===targetId && s.ownerId===session.userId);
      if(target) {
        if(!await askSharingConfirmation('確認搬移後的分享範圍',`搬移後，原有內容會依目的日曆的分享設定，讓家庭成員${target.permission==='edit'?'共同編輯':'查看'}。`,'確認搬移')) throw new SharingCancelledError();
        return {...options,confirmExposure:{[targetId]:target.updatedAt}};
      }
      return options;
    }

    return {
      addEvent(input) {
        if (!input.title.trim()) return Promise.resolve();
        return confirmed(() => activeRepository.addEvent(input));
      },
      updateEvent(id, patch, options) {
        const current=stateRef.current;
        const source=current.status==='ready'?current.data.events.find(e=>e.id===id)?.calendarId:undefined;
        return confirmed(async () => activeRepository.updateEvent(id, patch,await exposureOptions(source,patch.calendarId,options)));
      },
      deleteEvent(id,options) {
        return confirmed(async () => {await confirmReceivedDeletion(id,'event');return activeRepository.deleteEvent(id,options);});
      },
      cancelEventOccurrence(eventId, occurrence,options) {
        return confirmed(async () => {await confirmReceivedDeletion(eventId,'event');return activeRepository.cancelEventOccurrence(eventId, occurrence,options);});
      },
      replaceEventOccurrence(eventId, occurrence, patch, options) {
        const current=stateRef.current;
        const source=current.status==='ready'?current.data.events.find(e=>e.id===eventId)?.calendarId:undefined;
        return confirmed(async () => activeRepository.replaceEventOccurrence(eventId, occurrence, patch,await exposureOptions(source,patch.calendarId,options)));
      },
      addTodo(input) {
        if (!input.title.trim()) return Promise.resolve();
        return confirmed(() => activeRepository.addTodo(input));
      },
      toggleTodo(id) {
        const notify = todoFeedback.capture();
        const result = enqueue(() => todoFeedback.repository.toggleTodo(id)).then(data => {
          // The repository toggles only this row. A present, completed result
          // therefore confirms an incomplete -> complete command, not a reload.
          if (data.todos.find(todo => todo.id === id)?.completedAt != null) notify();
        });
        void result.catch(() => {});
        return result;
      },
      async renameTodo(id, title,options) {
        await enqueue(() => activeRepository.renameTodo(id, title),options);
      },
      async setTodoPriority(id, priority,options) {
        await enqueue(() => activeRepository.setTodoPriority(id, priority),options);
      },
      async rescheduleTodo(id, date,options) {
        await enqueue(() => activeRepository.rescheduleTodo(id, date),options);
      },
      deleteTodo(id) {
        run(async () => {await confirmReceivedDeletion(id,'todo');return activeRepository.deleteTodo(id);});
      },
      setTodoSharingScope(id,scope) {
        return confirmed(()=>{
          if(!activeRepository.setTodoSharingScope) throw new TodoInputError('目前無法修改不分享設定。');
          return activeRepository.setTodoSharingScope(id,scope);
        });
      },
      setCalendarShare(id,permission) {
        return confirmed(()=>{
          if(!canShareCalendars(activeRepository)) throw new TodoInputError('請先登入，才能分享日曆。');
          return activeRepository.setCalendarShare(id,permission);
        });
      },
      addSticker(input) {
        if (!input.glyph.trim()) return;
        run(() => activeRepository.addSticker(input));
      },
      deleteSticker(id) {
        run(() => activeRepository.deleteSticker(id));
      },
      addCalendar(input) {
        return confirmed(() => activeRepository.addCalendar(input));
      },
      updateCalendar(id, patch) {
        return confirmed(() => activeRepository.updateCalendar(id, patch));
      },
      deleteCalendar(id) {
        const current=stateRef.current;
        const personal=canShareCalendars(activeRepository)?activeRepository.personalData():current.status==='ready'?current.data:null;
        const target=personal?calendarDeletionPlan(personal,id)?.target.id:undefined;
        return confirmed(async () => activeRepository.deleteCalendar(id,await exposureOptions(id,target)));
      },
      updatePreferences(patch) {
        run(() => activeRepository.updatePreferences(patch));
      },
      async importData(command) {
        // Awaited so the preview sheet can report the outcome, and queued so it
        // cannot overtake an edit already in flight.
        await enqueue(() => activeRepository.importData(command));
      },
      async uploadEventAttachment(eventId, file) {
        if (!canManageEventAttachments(activeRepository)) {
          throw new Error('附件只會保存到登入帳號的私人雲端空間。');
        }
        await enqueue(() => activeRepository.uploadEventAttachment(eventId, file));
      },
      async deleteEventAttachment(id) {
        if (!canManageEventAttachments(activeRepository)) {
          throw new Error('附件只會保存到登入帳號的私人雲端空間。');
        }
        await enqueue(() => activeRepository.deleteEventAttachment(id));
      },
      createEventAttachmentUrl(id) {
        if (!canManageEventAttachments(activeRepository)) {
          return Promise.reject(new Error('附件只會保存到登入帳號的私人雲端空間。'));
        }
        return activeRepository.createEventAttachmentUrl(id);
      },
    };
  }, [activeRepository,askSharingConfirmation,todoFeedback]);

  const value = useMemo<DataContextValue>(
    () => ({
      state,
      actions,
      todoCompletions: todoFeedback.source,
      capabilities: { eventAttachments: canManageEventAttachments(activeRepository) },
      ...(canShareCalendars(activeRepository) && state.status==='ready'?{
        sharing:activeRepository.sharingSession(),personalData:activeRepository.personalData(),revalidateShares,
      }:{}),
      confirmation,
      retainedSharingDrafts,keepSharingDraft,discardSharingDraft,
      refresh,
    }),
    [actions, activeRepository, confirmation,refresh,revalidateShares,state,retainedSharingDrafts,keepSharingDraft,discardSharingDraft,todoFeedback],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

function bootstrap(repository: DayPopRepository): DataState {
  if (!canLoadSync(repository)) return { status: 'loading' };
  try {
    return { status: 'ready', data: repository.loadSync() };
  } catch (error) {
    return toFailureState(error);
  }
}

function toFailureState(error: unknown): DataState {
  if (error instanceof CachedRemoteLoadError) {
    return {
      status: 'ready',
      data: error.cachedData,
      warning: { kind: 'cached', message: error.message },
    };
  }
  if (error instanceof LocalDataBlockedError) {
    return { status: 'blocked', result: error.result };
  }
  return {
    status: 'failed',
    message: error instanceof Error ? error.message : '資料存取失敗。',
  };
}

function toWriteFailureState(error: unknown, current: DataState): DataState {
  if(error instanceof SharingCancelledError) return current;
  if (error instanceof LocalDataBlockedError) {
    return { status: 'blocked', result: error.result };
  }
  // Import validation can refuse a command before any write (e.g. an account
  // still has attachments). Keep the dialog mounted to show its awaited
  // rejection, and retain the last snapshot and any existing sync warning.
  if (error instanceof DataTransferError && current.status === 'ready') {
    return current;
  }
  if (error instanceof RemoteDataError && current.status === 'ready') {
    return {
      ...current,
      ...(error.currentData?{data:error.currentData}:{}),
      warning: {
        kind: 'write-failed',
        message: '剛才的變更沒有保存。' + error.message,
      },
    };
  }
  // Input guards (title, date range, or a subtask whose parent was deleted)
  // refuse a command, not the stored document: retain the live App. This is
  // not a sync failure either (DP-123), and must not hide one that is.
  if ((error instanceof TodoInputError || error instanceof TitleInputError || error instanceof AllDayInputError) && current.status === 'ready') {
    if (current.warning && current.warning.kind !== 'refused') return current;
    return { ...current, warning: { kind: 'refused', message: error.message } };
  }
  return toFailureState(error);
}

class SharingCancelledError extends Error {
  constructor(){super('已取消，沒有變更資料。');this.name='SharingCancelledError';}
}

function offlineSharingWarning():{kind:'cached';message:string} {
  return {kind:'cached',message:'目前離線，暫時只顯示自己的資料；收到的分享將在連線後重新確認。'};
}
