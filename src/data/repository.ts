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

/**
 * The only data contract the UI is allowed to depend on.
 *
 * Screens never touch `localStorage` or a Supabase client directly: they go
 * through `DataProvider`, which holds one implementation of this interface.
 * Two adapters implement it — `LocalDayPopRepository` for guest mode and
 * `SupabaseDayPopRepository` for a signed-in account — so swapping them is a
 * change in one place rather than in every screen.
 *
 * Every method resolves with the full updated document. Returning a snapshot
 * instead of a delta is what lets both adapters behave identically from the
 * caller's point of view; DP-026 decides how much of that snapshot is served
 * from a device cache.
 *
 * Editing an id that does not exist is a no-op in both adapters, not an error:
 * the UI only ever edits rows it has just rendered, and throwing would take
 * down the screen for a race that resolves itself on the next load.
 */
export interface DayPopRepository {
  load(): Promise<DayPopUserData>;
  addEvent(input: NewEventInput): Promise<DayPopUserData>;
  updateEvent(id: string, patch: EventPatch): Promise<DayPopUserData>;
  deleteEvent(id: string): Promise<DayPopUserData>;
  addTodo(input: NewTodoInput): Promise<DayPopUserData>;
  toggleTodo(id: string): Promise<DayPopUserData>;
  deleteTodo(id: string): Promise<DayPopUserData>;
  addSticker(input: NewStickerInput): Promise<DayPopUserData>;
  deleteSticker(id: string): Promise<DayPopUserData>;
  addCalendar(input: NewCalendarInput): Promise<DayPopUserData>;
  updateCalendar(id: string, patch: CalendarPatch): Promise<DayPopUserData>;
  /**
   * Deleting the last calendar is refused, and the rows of a deleted calendar
   * move to the surviving default rather than disappearing — see
   * `calendarDeletionPlan`.
   */
  deleteCalendar(id: string): Promise<DayPopUserData>;
  updatePreferences(patch: PreferencesPatch): Promise<DayPopUserData>;
}

/** Optional binary boundary implemented only by the authenticated adapter. */
export interface EventAttachmentRepository {
  uploadEventAttachment(eventId: string, file: File): Promise<DayPopUserData>;
  deleteEventAttachment(id: string): Promise<DayPopUserData>;
  createEventAttachmentUrl(id: string): Promise<string>;
}

export function canManageEventAttachments(
  repository: DayPopRepository,
): repository is DayPopRepository & EventAttachmentRepository {
  const candidate = repository as Partial<EventAttachmentRepository>;
  return (
    typeof candidate.uploadEventAttachment === 'function' &&
    typeof candidate.deleteEventAttachment === 'function' &&
    typeof candidate.createEventAttachmentUrl === 'function'
  );
}

/**
 * An adapter whose backing store can answer without awaiting.
 *
 * Only the guest adapter can: its data is already in `localStorage` when the
 * app boots. `DataProvider` uses this to paint the first frame with real data
 * instead of an empty calendar. Remote adapters simply omit it and the
 * provider falls back to the async `load()`.
 */
export interface SyncLoadCapable {
  loadSync(): DayPopUserData;
}

export function canLoadSync(
  repository: DayPopRepository,
): repository is DayPopRepository & SyncLoadCapable {
  return typeof (repository as Partial<SyncLoadCapable>).loadSync === 'function';
}
