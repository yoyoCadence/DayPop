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
import type { SharingSession, SharingWriteOptions } from './calendarSharing';
import type { RetainedSharingDraft } from './retainedSharingDraft';

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

/**
 * Every write the UI is allowed to make. Identities are stable across renders.
 * Event-sheet saves (DP-133) and deletions (DP-134), and the calendar dialog's
 * writes (DP-141), return confirmation; other callers may ignore those
 * promises safely, while DataProvider still reports the failure.
 */
export interface DataActions {
  addEvent(input: NewEventInput): Promise<void>;
  updateEvent(id: string, patch: EventPatch, options?: SharingWriteOptions): Promise<void>;
  deleteEvent(id: string, options?: SharingWriteOptions): Promise<void>;
  /**
   * The 只有這一次 half of the原檔's scope dialog — DP-082.
   *
   * `updateEvent`/`deleteEvent` remain 整個系列. Both go through the same
   * serialized mutation queue, so choosing 單次 cannot interleave with an edit
   * the user issued a moment earlier.
   */
  cancelEventOccurrence(eventId: string, occurrence: EventOccurrence, options?: SharingWriteOptions): Promise<void>;
  replaceEventOccurrence(
    eventId: string,
    occurrence: EventOccurrence,
    patch: EventPatch,
    options?: SharingWriteOptions,
  ): Promise<void>;
  addTodo(input: NewTodoInput): Promise<void>;
  /** Awaited so an inline editor keeps its draft if the write is refused. */
  renameTodo(id: string, title: string, options?: SharingWriteOptions): Promise<void>;
  setTodoPriority(id: string, priority: TodoPriority, options?: SharingWriteOptions): Promise<void>;
  rescheduleTodo(id: string, date: string, options?: SharingWriteOptions): Promise<void>;
  toggleTodo(id: string): void;
  deleteTodo(id: string): void;
  setTodoSharingScope?(id: string,scope: 'inherit'|'private'): Promise<void>;
  setCalendarShare?(id: string,permission: 'view'|'edit'|null): Promise<void>;
  addSticker(input: NewStickerInput): void;
  deleteSticker(id: string): void;
  addCalendar(input: NewCalendarInput): Promise<void>;
  updateCalendar(id: string, patch: CalendarPatch): Promise<void>;
  deleteCalendar(id: string): Promise<void>;
  updatePreferences(patch: PreferencesPatch): void;
  uploadEventAttachment(eventId: string, file: File): Promise<void>;
  deleteEventAttachment(id: string): Promise<void>;
  createEventAttachmentUrl(id: string): Promise<string>;
  /**
   * Applies a confirmed import — DP-056.
   *
   * Awaitable: the screen has to know whether the
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
  sharing?: SharingSession;
  personalData?: DayPopUserData;
  revalidateShares?(): void;
  confirmation?: SharingConfirmation | null;
  retainedSharingDrafts?: readonly RetainedSharingDraft[];
  keepSharingDraft?(draft:RetainedSharingDraft):void;
  discardSharingDraft?(key:string):void;
  /** Re-runs the load — used after the recovery screen resets the data. */
  refresh(): void;
}

export interface SharingConfirmation {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm(): void;
  onCancel(): void;
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
  sharing?: SharingSession;
  personalData: DayPopUserData;
} {
  const value = useDayPopDataState();
  if (value.state.status !== 'ready') {
    throw new Error('DayPop 資料尚未就緒，畫面不應該在此時掛載。');
  }
  return { data: value.state.data, personalData:value.personalData ?? value.state.data, sharing:value.sharing,
    capabilities: value.capabilities, ...value.actions };
}
