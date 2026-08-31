import { findEvent, type OccurrenceMutationContext } from '../domain/mutations';
import type {
  CalendarPatch,
  EventPatch,
  NewCalendarInput,
  NewEventInput,
  NewStickerInput,
  NewTodoInput,
  PreferencesPatch,
} from '../domain/mutations';
import type { ImportCommand } from '../domain/dataTransfer';
import { createDomainId, type DayPopUserData, type EventOccurrence } from '../domain/types';

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
  /**
   * Remove one generated occurrence of a recurring event — DP-082.
   *
   * `updateEvent`/`deleteEvent` stay the explicit "整個系列" operations; these
   * two are the "只有這一次" half, and the pair is what the原檔's scope dialog
   * (`scopeThis`/`scopeAll`) chooses between. Both write an `event_exceptions`
   * row keyed on (event, occurrence), so repeating the same call is idempotent
   * rather than piling up rows — a retried write cannot double-cancel.
   *
   * A no-op, like the row edits above, when `eventId` is unknown **or no
   * longer recurring**: the user tapped an occurrence that was on screen, and
   * a series another tab has since edited must not take this screen down. An
   * occurrence whose shape disagrees with the event (all-day vs timed) does
   * throw — that is a caller passing the wrong occurrence, not a race.
   */
  cancelEventOccurrence(
    eventId: string,
    occurrence: EventOccurrence,
  ): Promise<DayPopUserData>;
  /**
   * Detach one generated occurrence into a standalone, non-recurring event and
   * apply `patch` to it — DP-082. The series keeps every other occurrence.
   *
   * Re-editing the same occurrence reuses both the exception row and the
   * replacement event, so this never accumulates copies. Same no-op and throw
   * rules as `cancelEventOccurrence`.
   */
  replaceEventOccurrence(
    eventId: string,
    occurrence: EventOccurrence,
    patch: EventPatch,
  ): Promise<DayPopUserData>;
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
  /**
   * Applies a confirmed import — DP-056.
   *
   * Takes the command rather than a finished document on purpose. The plan is
   * built when the preview is shown, and the data can legitimately change
   * before the user confirms; an adapter therefore applies the command to
   * whatever it reads at commit time. There is deliberately **no** general
   * `save(document)` on this contract, because that is the shape that lets a
   * stale snapshot overwrite newer rows.
   *
   * All-or-nothing: on failure the stored data is left exactly as it was.
   */
  importData(command: ImportCommand): Promise<DayPopUserData>;
}

/**
 * The no-op guard both adapters apply before an occurrence write — DP-082.
 *
 * Kept here rather than in each adapter so the contract's promise and its two
 * implementations cannot drift apart.
 */
export function canEditOccurrencesOf(data: DayPopUserData, eventId: string): boolean {
  return findEvent(data, eventId)?.recurrence != null;
}

/**
 * Fresh ids and a timestamp for one occurrence write — DP-082.
 *
 * The domain mutations take these as input rather than minting them, which is
 * what makes them pure and testable. Both are only used when the occurrence
 * has no exception row yet; re-editing reuses the stored ids instead.
 */
export function occurrenceWriteContext(): OccurrenceMutationContext {
  return {
    exceptionId: createDomainId(),
    replacementEventId: createDomainId(),
    now: new Date().toISOString(),
  };
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
