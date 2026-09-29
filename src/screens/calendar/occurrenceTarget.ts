import type { CalendarEvent, EventOccurrence } from '../../domain/types';

/**
 * What a view hands back when the user taps one drawn occurrence — DP-082.
 *
 * The原檔 already did this: its `openEvent(id, occ)` (`:909`) takes the
 * occurrence alongside the id and keeps it in `editOcc`, which is what the
 * scope dialog's 只改這一次 later writes against. DayPop passed only the id
 * until now, so every edit necessarily applied to the whole series.
 *
 * `event` is the **concrete occurrence**, not the base row: the shifted copy
 * for a plain occurrence, or the replacement row when this occurrence already
 * has one. Seeding the sheet from it is a deliberate departure from the原檔,
 * which fills the form from the base event and then overrides the date only
 * inside `scopeApply()`. DayPop cannot do that — `replaceEventOccurrence()`
 * applies the sheet's patch to the resolved occurrence, and the sheet always
 * sends `date`, so a form showing the series' start date would silently move
 * the occurrence there the moment the user chose 只改這一次.
 */
export interface OccurrenceTarget {
  /** The series row an occurrence-scoped write targets. */
  sourceEventId: string;
  occurrence: EventOccurrence;
  event: CalendarEvent;
}

/** Narrows a resolved occurrence to what the sheet needs, dropping the render key. */
export function occurrenceTarget(resolved: {
  sourceEventId: string;
  occurrence: EventOccurrence;
  event: CalendarEvent;
}): OccurrenceTarget {
  return {
    sourceEventId: resolved.sourceEventId,
    occurrence: resolved.occurrence,
    event: resolved.event,
  };
}
