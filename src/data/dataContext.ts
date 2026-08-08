import { createContext, useContext } from 'react';
import type {
  CalendarPatch,
  EventPatch,
  NewCalendarInput,
  NewEventInput,
  NewStickerInput,
  NewTodoInput,
  PreferencesPatch,
} from '../domain/mutations';
import type { DayPopUserData } from '../domain/types';
import type { StorageReadResult } from '../storage/versionedStorage';

/** The non-`ready` half of a local read — what the recovery screen works on. */
export type BlockedRead = Exclude<StorageReadResult, { status: 'ready' }>;

/**
 * `blocked` is the DP-016 fail-closed state: the stored bytes could not be
 * read, so nothing may be written until the user has backed them up.
 * `failed` covers everything else a repository can reject with; it only
 * becomes reachable once DP-026 wires the remote adapter in.
 */
export type DataState =
  | { status: 'loading' }
  | { status: 'ready'; data: DayPopUserData }
  | { status: 'blocked'; result: BlockedRead }
  | { status: 'failed'; message: string };

/** Every write the UI is allowed to make. Identities are stable across renders. */
export interface DataActions {
  addEvent(input: NewEventInput): void;
  updateEvent(id: string, patch: EventPatch): void;
  deleteEvent(id: string): void;
  addTodo(input: NewTodoInput): void;
  toggleTodo(id: string): void;
  deleteTodo(id: string): void;
  addSticker(input: NewStickerInput): void;
  deleteSticker(id: string): void;
  addCalendar(input: NewCalendarInput): void;
  updateCalendar(id: string, patch: CalendarPatch): void;
  deleteCalendar(id: string): void;
  updatePreferences(patch: PreferencesPatch): void;
}

export interface DataContextValue {
  state: DataState;
  actions: DataActions;
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
export function useDayPopData(): DataActions & { data: DayPopUserData } {
  const value = useDayPopDataState();
  if (value.state.status !== 'ready') {
    throw new Error('DayPop 資料尚未就緒，畫面不應該在此時掛載。');
  }
  return { data: value.state.data, ...value.actions };
}
