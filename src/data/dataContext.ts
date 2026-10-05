import { createContext, useContext } from 'react';
import type { ImportCommand } from '../domain/dataTransfer';
import type {
  CalendarPatch,
  EventPatch,
  NewCalendarInput,
  NewEventInput,
  NewStickerInput,
  NewTodoInput,
  PreferencesPatch,
} from '../domain/mutations';
import type { DayPopUserData, EventOccurrence, TodoPriority } from '../domain/types';
import type { StorageReadResult } from '../storage/versionedStorage';

/** The non-`ready` half of a local read — what the recovery screen works on. */
export type BlockedRead = Exclude<StorageReadResult, { status: 'ready' }>;

/**
 * `refused` is a command the domain turned down before any write, such as a
 * subtask whose parent was just deleted. Nothing is out of sync, so it must not
 * read as a sync failure — a guest has nothing to sync at all (DP-123).
 */
export type DataWarning =
  | { kind: 'cached'; message: string }
  | { kind: 'write-failed'; message: string }
  | { kind: 'refused'; message: string };

/**
 * `blocked` is the DP-016 fail-closed state: the stored bytes could not be
 * read, so nothing may be written until the user has backed them up.
 * `failed` covers everything else a repository can reject with; it only
 * becomes reachable once DP-026 wires the remote adapter in.
 */
export type DataState =
  | { status: 'loading' }
  | {
      status: 'ready';
      data: DayPopUserData;
      warning?: DataWarning;
      /** True while one or more serialized repository mutations are unsettled. */
      saving?: boolean;
    }
  | { status: 'blocked'; result: BlockedRead }
  | { status: 'failed'; message: string };

/** Every write the UI is allowed to make. Identities are stable across renders. */
export interface DataActions {
  addEvent(input: NewEventInput): void;
  updateEvent(id: string, patch: EventPatch): void;
  deleteEvent(id: string): void;
  /**
   * The 只有這一次 half of the原檔's scope dialog — DP-082.
   *
   * `updateEvent`/`deleteEvent` remain 整個系列. Both go through the same
   * serialized mutation queue, so choosing 單次 cannot interleave with an edit
   * the user issued a moment earlier.
   */
  cancelEventOccurrence(eventId: string, occurrence: EventOccurrence): void;
  replaceEventOccurrence(
    eventId: string,
    occurrence: EventOccurrence,
    patch: EventPatch,
  ): void;
  addTodo(input: NewTodoInput): void;
  /** Awaited so an inline editor keeps its draft if the write is refused. */
  renameTodo(id: string, title: string): Promise<void>;
  setTodoPriority(id: string, priority: TodoPriority): Promise<void>;
  rescheduleTodo(id: string, date: string): Promise<void>;
  toggleTodo(id: string): void;
  deleteTodo(id: string): void;
  addSticker(input: NewStickerInput): void;
  deleteSticker(id: string): void;
  addCalendar(input: NewCalendarInput): void;
  updateCalendar(id: string, patch: CalendarPatch): void;
  deleteCalendar(id: string): void;
  updatePreferences(patch: PreferencesPatch): void;
  uploadEventAttachment(eventId: string, file: File): Promise<void>;
  deleteEventAttachment(id: string): Promise<void>;
  createEventAttachmentUrl(id: string): Promise<string>;
  /**
   * Applies a confirmed import — DP-056.
   *
   * Awaitable, unlike the row edits above: the screen has to know whether the
   * import landed before it closes the preview and tells the user how many
   * rows arrived. It goes through the same mutation queue as everything else,
   * so it cannot interleave with an edit the user issued a moment earlier.
   */
  importData(command: ImportCommand): Promise<void>;
}

export interface DataContextValue {
  state: DataState;
  actions: DataActions;
  capabilities: { eventAttachments: boolean };
  /** Re-runs the load — used after the recovery screen resets the data. */
  refresh(): void;
}

export const DataContext = createContext<DataContextValue | null>(null);

/** App-level: decides between the recovery screen and the real tabs. */
export function useDayPopDataState(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) throw new Error('useDayPopDataState 必須在 DataProvider 內使用。');
  return value;
}

/**
 * Screen-level: data plus writes.
 *
 * Screens only mount once `App` has seen `ready`, so `data` is non-null here
 * and no screen has to render a loading branch of its own.
 */
export function useDayPopData(): DataActions & {
  data: DayPopUserData;
  capabilities: DataContextValue['capabilities'];
} {
  const value = useDayPopDataState();
  if (value.state.status !== 'ready') {
    throw new Error('DayPop 資料尚未就緒，畫面不應該在此時掛載。');
  }
  return { data: value.state.data, capabilities: value.capabilities, ...value.actions };
}
