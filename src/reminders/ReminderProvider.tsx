import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type PropsWithChildren } from 'react';
import { AuthContext, useAuth } from '../auth/authContext';
import { getSupabaseClient } from '../lib/supabase';
import { getAppStorage } from '../storage/browserStorage';
import { BrowserReminderDevice } from './browserPush';
import { ReminderDeviceController, type ReminderDeviceView } from './deviceController';
import { ReminderDeviceRecords } from './deviceRecords';
import { ReminderContext } from './reminderContext';
import { ReminderError, SupabaseReminderService, type ReminderRuleInput, type ReminderService } from './reminderService';

type Controller = Pick<ReminderDeviceController, 'getSnapshot' | 'subscribe' | 'setIdentity' | 'refresh' | 'enable' | 'disable' | 'invalidatePreflight'>;
interface Props {
  /** Pure construction only; effects may be replayed by React StrictMode. */
  createController?: () => Controller;
  serviceForUser?: (userId: string) => ReminderService;
}
const sessionChanged = () => new ReminderError('session', '登入狀態已變更，請重新確認帳號後再試。');
async function waitForRule<T>(task: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([task, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new ReminderError('failed', '尚無法確認提醒設定是否已保存。請先重新載入已保存設定。')), 10000);
    })]);
  } finally { clearTimeout(timer); }
}
function productionController() {
  const scope = new URL(import.meta.env.BASE_URL, window.location.href).href;
  return new ReminderDeviceController(scope, new BrowserReminderDevice(), new ReminderDeviceRecords(scope));
}
const productionService = (userId: string) => new SupabaseReminderService(getSupabaseClient(), userId);

/** Above the keyed account-data subtree; Auth callbacks themselves never await this runtime. */
export function ReminderProvider({ children, createController = productionController, serviceForUser = productionService }: PropsWithChildren<Props>) {
  const auth = useAuth(), accountId = auth.user?.id ?? null, confirmed = !auth.initializing && !auth.sessionUnconfirmed;
  const identity = useMemo(() => ({ accountId, confirmed }), [accountId, confirmed]);
  const currentAuth = useRef(auth), currentIdentity = useRef(identity);
  useLayoutEffect(() => { currentAuth.current = auth; currentIdentity.current = identity; }, [auth, identity]);
  const [controller] = useState(createController);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const service = useMemo(() => accountId && confirmed ? serviceForUser(accountId) : null, [accountId, confirmed, serviceForUser]);
  const [savingFor, setSavingFor] = useState<typeof identity | null>(null);
  const signOutTask = useRef<{ identity: typeof identity; task: Promise<void> } | null>(null);
  const ruleTask = useRef<{ identity: typeof identity; task: Promise<unknown> } | null>(null);

  useEffect(() => {
    void controller.setIdentity(!confirmed ? { kind: 'waiting' } : accountId && service ? { kind: 'account', userId: accountId, service } : { kind: 'guest' });
    // Token refresh updates captured cleanup while preserving the same account and active subscription.
  }, [accountId, confirmed, service, controller, auth.session?.access_token]);
  useEffect(() => {
    const prefix = 'daypop.reminder-device.' + encodeURIComponent(new URL(import.meta.env.BASE_URL, window.location.href).href) + '.';
    const refresh = () => { void controller.refresh(); };
    const visibility = () => { if (document.hidden) controller.invalidatePreflight(); else refresh(); };
    const storage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(prefix)) { controller.invalidatePreflight(); refresh(); }
    };
    const updated = () => { controller.invalidatePreflight(); refresh(); };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('online', refresh); window.addEventListener('storage', storage);
    navigator.serviceWorker?.addEventListener('controllerchange', updated);
    const stopWatchingStorage = getAppStorage().subscribe(updated);
    return () => {
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('online', refresh); window.removeEventListener('storage', storage);
      navigator.serviceWorker?.removeEventListener('controllerchange', updated); stopWatchingStorage();
      // Unmount/StrictMode replay is not a sign-out and must retain active notifications.
    };
  }, [controller]);

  const signOut = useCallback(() => {
    const actor = currentIdentity.current;
    if (signOutTask.current?.identity === actor) return signOutTask.current.task;
    const task = (async () => {
      await controller.disable(); // Failure remains visible in safe receipts; it must not trap someone in their account.
      if (currentIdentity.current !== actor) throw sessionChanged();
      await currentAuth.current.signOut();
    })();
    const operation = { identity: actor, task }; signOutTask.current = operation;
    void task.then(() => { if (signOutTask.current === operation) signOutTask.current = null; }, () => { if (signOutTask.current === operation) signOutTask.current = null; });
    return task;
  }, [controller]);
  const wrappedAuth = useMemo(() => ({ ...auth, signOut }), [auth, signOut]);
  const saveRule = useCallback(async (input: ReminderRuleInput, expectedUpdatedAt: string | null) => {
    const actor = currentAuth.current;
    if (currentIdentity.current !== identity || !service || !accountId || actor.initializing || actor.sessionUnconfirmed || actor.user?.id !== accountId) throw sessionChanged();
    if (ruleTask.current?.identity === identity) throw new ReminderError('conflict', '提醒設定仍在儲存中，請稍後重新確認。');
    const task = service.setRule(input, expectedUpdatedAt), operation = { identity, task };
    ruleTask.current = operation; setSavingFor(identity);
    try {
      const result = await waitForRule(task);
      if (currentIdentity.current !== identity || currentAuth.current.user?.id !== accountId || currentAuth.current.initializing || currentAuth.current.sessionUnconfirmed) throw sessionChanged();
      await controller.refresh();
      if (currentIdentity.current !== identity || currentAuth.current.user?.id !== accountId || currentAuth.current.initializing || currentAuth.current.sessionUnconfirmed) throw sessionChanged();
      return result;
    } finally {
      if (ruleTask.current === operation) { ruleTask.current = null; setSavingFor(null); }
    }
  }, [service, accountId, controller, identity]);
  const reloadRule = useCallback(async (calendarId: string) => {
    if (currentIdentity.current !== identity || !accountId || currentAuth.current.user?.id !== accountId || currentAuth.current.initializing || currentAuth.current.sessionUnconfirmed) throw sessionChanged();
    await controller.refresh();
    if (currentIdentity.current !== identity || currentAuth.current.user?.id !== accountId || currentAuth.current.initializing || currentAuth.current.sessionUnconfirmed) throw sessionChanged();
    const latest = controller.getSnapshot();
    if (latest.userId !== accountId || !latest.snapshot || ['waiting', 'guest', 'loading', 'busy'].includes(latest.phase)) {
      throw new ReminderError('failed', '尚無法讀取已保存的提醒設定，請確認連線後再試。');
    }
    return latest.snapshot.rules.find(row => row.calendarId === calendarId) ?? null;
  }, [accountId, controller, identity]);
  // A render with B must never expose A while the identity effect is still queued.
  const view: ReminderDeviceView = useMemo(() => snapshot.userId === accountId && confirmed ? snapshot : {
    userId: accountId, phase: confirmed && !accountId ? 'guest' : 'waiting', canEnable: false, deviceId: null,
    pendingCount: snapshot.pendingCount, error: null, snapshot: null,
  }, [snapshot, accountId, confirmed]);
  const value = useMemo(() => ({ view, savingRule: savingFor === identity && accountId !== null,
    refresh: () => controller.refresh(), enable: () => controller.enable(), disable: () => controller.disable(), saveRule, reloadRule }), [view, savingFor, accountId, identity, controller, saveRule, reloadRule]);
  return <AuthContext.Provider value={wrappedAuth}><ReminderContext.Provider value={value}>{children}</ReminderContext.Provider></AuthContext.Provider>;
}
