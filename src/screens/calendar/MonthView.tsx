import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  addDays,
  addMonths,
  fromDateKey,
  monthGridWeekCount,
  startOfWeek,
  toDateKey,
  weeksBetween,
} from '../../domain/date';
import {
  allDayDisplaySegments,
  eventDisplaySegments,
  occurrencesConflict,
  type DisplaySegmentWindow,
} from '../../domain/displaySegments';
import { eventStartTimeInZone } from '../../domain/eventTime';
import { calendarColor } from '../../domain/calendars';
import { calendarTextColor } from '../../theme/calendarTextColor';
import { lunarCell } from '../../domain/lunar';
import type { OccurrenceWindow, ResolvedEventOccurrence } from '../../domain/recurrence';
import { stickerFontSize } from '../../domain/stickerGlyphs';
import type { Calendar, CalendarEvent, CalendarGridMode, Sticker } from '../../domain/types';
import { isDateKey } from '../../domain/validation';
import { smoothScrollBehavior } from '../../shell/motion';
import { cellChipBudget } from './monthCellLayout';
import {
  centredMonthWindow, clampMonthDate, clampMonthWindowStart, monthWindowBounds,
  MONTH_SHIFT_WEEKS, MONTH_WINDOW_WEEKS,
} from './monthWindow';

/**
 * Continuously scrolling month grid, ported from the `data-month-scroll` block
 * of `日曆桌寵 Calendar Pet.dc.html`.
 *
 * The原檔 does not paginate month by month: it renders a rolling buffer of week
 * rows and extends it at either end while the user scrolls, deriving the header
 * label from whichever week sits at the top. That behaviour is the design, so it
 * is reproduced here rather than replaced with a 6×7 page.
 */

// DP-180: retain the original continuous grid, with a bounded rolling window.
const MIN_ROW_HEIGHT = 58;
const INITIAL_ROW_HEIGHT = 96;

/** Marks the second and later days of a cross-midnight event — DP-064. */
const CONTINUATION_LABEL = '續';

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

export interface MonthViewHandle {
  scrollToToday(smooth: boolean): void;
  /** One screenful of weeks, used by the header's ‹ › buttons in month view. */
  page(direction: 1 | -1): void;
}

export interface MonthViewProps {
  ref?: RefObject<MonthViewHandle | null>;
  weekStartsOn: 0 | 1;
  /** The one timezone this grid is drawn in — DP-064. */
  displayTimezone: string;
  calendarGridMode: CalendarGridMode;
  /**
   * Expands the visible calendars into occurrences for one window — DP-081.
   * The grid asks for exactly its bounded rendered window as the user pans.
   */
  resolveOccurrences(window: OccurrenceWindow): ResolvedEventOccurrence[];
  stickers: Sticker[];
  calendars: Calendar[];
  selectedDate: string;
  todayKey: string;
  /** Search opens a fresh calendar screen at this day, without focusing behind its sheet. */
  initialDateKey?: string;
  flashToday: boolean;
  onSelectDate(dateKey: string): void;
  /** Reports the month that the top of the viewport is currently showing. */
  onPeriodLabelChange(label: string): void;
}

export function MonthView({
  ref,
  weekStartsOn,
  displayTimezone,
  calendarGridMode,
  resolveOccurrences,
  stickers,
  calendars,
  selectedDate,
  todayKey,
  initialDateKey = todayKey,
  flashToday,
  onSelectDate,
  onPeriodLabelChange,
}: MonthViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Search can seed a distant day; all other mounts start at display-zone today.
  const [bufferStart, setBufferStart] = useState(() => centredMonthWindow(fromDateKey(initialDateKey), weekStartsOn));
  const [rowHeight, setRowHeight] = useState(INITIAL_ROW_HEIGHT);
  const rowHeightRef = useRef(INITIAL_ROW_HEIGHT);
  const [visibleMonth, setVisibleMonth] = useState(() => fromDateKey(initialDateKey));
  const weeksShown = monthGridWeekCount(visibleMonth, weekStartsOn, calendarGridMode);
  const labelRef = useRef('');
  // A logical top week + intra-row fraction survives both trimming and resize.
  const pendingAnchor = useRef<{ date: Date; fraction: number } | null>(null);
  const measured = useRef(false);
  const initialised = useRef(false);

  const gridStart = useMemo(
    () => clampMonthWindowStart(bufferStart, weekStartsOn),
    [bufferStart, weekStartsOn],
  );
  // Date keys are zero-padded `YYYY-MM-DD`, so string order is date order.
  const { startDate: firstKey, endDate: lastKey } = monthWindowBounds(gridStart);
  const inBuffer = useCallback(
    (key: string) => key >= firstKey && key <= lastKey,
    [firstKey, lastKey],
  );

  // The same buffer bounds the occurrence expansion and the segment window:
  // the grid never asks for an occurrence it cannot draw — DP-081.
  const occurrences = useMemo(
    () => resolveOccurrences({ startDate: firstKey, endDate: lastKey }),
    [resolveOccurrences, firstKey, lastKey],
  );

  const eventsByDate = useMemo(
    // Windowed to the rendered buffer: an event longer than it is clipped to
    // what this grid can draw rather than cut into every day it spans, and a
    // span past `MAX_SEGMENT_DAYS` stays a drawable event instead of throwing.
    () =>
      groupEventsByDate(occurrences, displayTimezone, {
        startDateKey: firstKey,
        endDateKey: lastKey,
      }),
    [displayTimezone, occurrences, firstKey, lastKey],
  );
  const stickersByDate = useMemo(() => groupStickersByDate(stickers), [stickers]);

  // Roving tabindex — DP-069. The buffer holds hundreds of day cells and shifts
  // as the user scrolls, so leaving every cell in the tab order put the bottom
  // tab bar 382 Tab presses away. Exactly one cell is tabbable; the arrow keys
  // move between days from there.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  /** A ref, not state: this only drives a DOM call, never what is rendered. */
  const pendingFocus = useRef<{ key: string; preventScroll: boolean } | null>(null);

  const readAnchor = useCallback(() => {
    const position = (scrollRef.current?.scrollTop ?? 0) / rowHeightRef.current;
    const week = Math.floor(position);
    return { date: addDays(gridStart, week * 7), fraction: position - week };
  }, [gridStart]);

  const moveWindow = useCallback((start: Date, anchor = readAnchor()) => {
    const next = clampMonthWindowStart(start, weekStartsOn);
    if (next.getTime() === gridStart.getTime()) return;
    pendingAnchor.current = anchor;
    const bounds = monthWindowBounds(next);
    const retained = (key: string) => key >= bounds.startDate && key <= bounds.endDate;
    const active = document.activeElement as HTMLElement | null;
    const focused = active && scrollRef.current?.contains(active) ? active.dataset.dateKey : undefined;
    if ((focused && !retained(focused)) || !retained(focusKey ?? selectedDate)) {
      // The first fully visible row is safe even when the previous top is partial.
      const visible = toDateKey(clampMonthDate(addDays(anchor.date, anchor.fraction > 0 ? 7 : 0)));
      setFocusKey(visible);
      if (focused && !retained(focused)) pendingFocus.current = { key: visible, preventScroll: true };
    }
    setBufferStart(next);
  }, [focusKey, gridStart, readAnchor, selectedDate, weekStartsOn]);

  const scrollToToday = useCallback(
    (smooth: boolean) => {
      const element = scrollRef.current;
      if (!element) return;
      // `todayKey` is already read in the display zone by the screen. Reading
      // the device clock here instead scrolled to a different day than the one
      // the grid had highlighted — DP-064.
      const date = startOfWeek(fromDateKey(todayKey), weekStartsOn);
      if (!inBuffer(todayKey)) {
        moveWindow(centredMonthWindow(date, weekStartsOn), { date, fraction: 0 });
      } else {
        const index = weeksBetween(gridStart, date);
        element.scrollTo({ top: Math.max(0, index * rowHeight), behavior: smooth ? smoothScrollBehavior() : 'auto' });
      }
    },
    [gridStart, inBuffer, moveWindow, rowHeight, todayKey, weekStartsOn],
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollToToday: (smooth: boolean) => scrollToToday(smooth),
      page: (direction: 1 | -1) => {
        scrollRef.current?.scrollBy({
          top: direction * rowHeight * weeksShown,
          behavior: smoothScrollBehavior(),
        });
      },
    }),
    [rowHeight, scrollToToday, weeksShown],
  );

  // Fixed mode shows six rows. Adaptive mode follows the 4-6 rows required by
  // the month currently at the top, while preserving that top week when the
  // row height changes.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const measure = () => {
      if (element.clientHeight <= 0) return;
      const next = Math.max(MIN_ROW_HEIGHT, Math.floor(element.clientHeight / weeksShown));
      measured.current = true;
      if (rowHeightRef.current === next) return;
      pendingAnchor.current ??= readAnchor();
      rowHeightRef.current = next;
      setRowHeight(next);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [readAnchor, weeksShown]);

  // Land on today once the real row height is known.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    // Wait for the DOM height to match the measurement; writing before that
    // commit can clamp scrollTop against the old (shorter) scrollHeight.
    if (!element || rowHeight !== rowHeightRef.current) return;
    if (!initialised.current && measured.current) {
      initialised.current = true;
      pendingAnchor.current = { date: startOfWeek(fromDateKey(initialDateKey), weekStartsOn), fraction: 0 };
    }
    const anchor = pendingAnchor.current;
    if (anchor) {
      element.scrollTop = Math.max(0, (weeksBetween(gridStart, anchor.date) + anchor.fraction) * rowHeight);
      pendingAnchor.current = null;
    }
  });

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element || pendingAnchor.current) return;

    const index = Math.round(element.scrollTop / rowHeight);
    // The原檔 labels the buffer by its middle day, so a row straddling two
    // months reads as the month that owns most of it.
    const middle = clampMonthDate(addDays(gridStart, index * 7 + 3));
    const label = `${middle.getFullYear()}年 ${middle.getMonth() + 1}月`;

    if (label !== labelRef.current) {
      labelRef.current = label;
      setVisibleMonth((current) =>
        current.getFullYear() === middle.getFullYear() && current.getMonth() === middle.getMonth()
          ? current
          : new Date(middle.getFullYear(), middle.getMonth(), 1),
      );
      onPeriodLabelChange(label);
    }

    if (index < 4) {
      moveWindow(addDays(gridStart, -MONTH_SHIFT_WEEKS * 7));
    } else if (index > MONTH_WINDOW_WEEKS - 8) {
      moveWindow(addDays(gridStart, MONTH_SHIFT_WEEKS * 7));
    }
  }, [gridStart, moveWindow, onPeriodLabelChange, rowHeight]);

  const weekdayHead = useMemo(
    () =>
      Array.from({ length: 7 }, (_, offset) => {
        const weekday = (weekStartsOn + offset) % 7;
        return {
          label: WEEKDAY_LABELS[weekday] ?? '',
          isWeekend: weekday === 0 || weekday === 6,
        };
      }),
    [weekStartsOn],
  );

  /**
   * The single tabbable cell: wherever the keyboard left off, else the selected
   * day, else today. Falling back keeps a tab stop in the grid even when the
   * selection sits outside the rendered buffer.
   */
  const preferredKey = focusKey ?? selectedDate;
  const activeKey = inBuffer(preferredKey)
    ? preferredKey
    : inBuffer(todayKey)
      ? todayKey
      : firstKey;

  /**
   * Moves the rolling window so `key` has a cell to focus. Called from the
   * key handler rather than from the effect below, so the effect stays a pure
   * DOM side effect with no state updates of its own.
   */
  const ensureInBuffer = useCallback(
    (key: string) => {
      if (key < firstKey) {
        moveWindow(addDays(gridStart, -MONTH_SHIFT_WEEKS * 7));
      } else if (key > lastKey) {
        moveWindow(addDays(gridStart, MONTH_SHIFT_WEEKS * 7));
      }
    },
    [firstKey, gridStart, lastKey, moveWindow],
  );

  // Focus follows the key once its cell exists. The buffer bounds are
  // A layout effect runs after both the window and its measured row height
  // commit, so focus never races the scroll compensation.
  useLayoutEffect(() => {
    const request = pendingFocus.current;
    if (!request || rowHeight !== rowHeightRef.current) return;

    const cell = scrollRef.current?.querySelector<HTMLButtonElement>(`[data-date-key="${request.key}"]`);
    if (!cell) return;

    cell.focus({ preventScroll: request.preventScroll });
    pendingFocus.current = null;
  });

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const from = (event.target as HTMLElement).dataset?.dateKey;
      if (!from || event.altKey || event.ctrlKey || event.metaKey) return;

      const date = fromDateKey(from);
      // Weekday offset within the row, so Home/End land on the row's own ends
      // whether the week starts on Sunday or Monday.
      const offset = (date.getDay() - weekStartsOn + 7) % 7;

      let next: string;
      switch (event.key) {
        case 'ArrowLeft':
          next = toDateKey(addDays(date, -1));
          break;
        case 'ArrowRight':
          next = toDateKey(addDays(date, 1));
          break;
        case 'ArrowUp':
          next = toDateKey(addDays(date, -7));
          break;
        case 'ArrowDown':
          next = toDateKey(addDays(date, 7));
          break;
        case 'Home':
          next = toDateKey(addDays(date, -offset));
          break;
        case 'End':
          next = toDateKey(addDays(date, 6 - offset));
          break;
        case 'PageUp':
          next = toDateKey(addMonths(date, -1));
          break;
        case 'PageDown':
          next = toDateKey(addMonths(date, 1));
          break;
        default:
          return;
      }

      // Arrow keys would otherwise scroll the buffer out from under the focus.
      event.preventDefault();
      if (!isDateKey(next)) return;
      ensureInBuffer(next);
      setFocusKey(next);
      pendingFocus.current = { key: next, preventScroll: false };
    },
    [ensureInBuffer, weekStartsOn],
  );

  const weeks = useMemo(
    () =>
    Array.from({ length: MONTH_WINDOW_WEEKS }, (_, week) =>
      Array.from({ length: 7 }, (_, day) => {
        const date = addDays(gridStart, week * 7 + day);
        const key = toDateKey(date);
        const dayEvents = eventsByDate.get(key) ?? [];
        return {
          key,
          date,
          dayEvents,
          dayStickers: stickersByDate.get(key) ?? [],
          isFirstOfMonth: date.getDate() === 1,
          // Alternating month shading, so month boundaries stay readable while
          // scrolling continuously.
          isZebra: (date.getFullYear() * 12 + date.getMonth()) % 2 === 1,
          supported: date.getFullYear() >= 100 && date.getFullYear() <= 9999,
          lunar: date.getFullYear() >= 100 && date.getFullYear() <= 9999 ? lunarCell(date) : { text: '', isFestival: false },
          hasConflict: hasOverlap(dayEvents),
        };
      }),
    ),
    [eventsByDate, gridStart, stickersByDate],
  );

  return (
    <div className="cal-view-pane">
      <div className="cal-weekhead">
        {weekdayHead.map((head, index) => (
          <div key={index} style={{ color: head.isWeekend ? 'var(--accent-text)' : 'var(--muted)' }}>
            {head.label}
          </div>
        ))}
      </div>
      <div
        className="cal-month-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
      >
        {weeks.map((cells) => (
          <div className="cal-week-row" key={cells[0]!.key} style={{ height: `${rowHeight}px` }}>
            {cells.map((cell) => {
              const isToday = cell.key === todayKey;
              const isSelected = cell.key === selectedDate;
              const { shown, hidden } = cellChipBudget(
                rowHeight,
                cell.dayEvents.length,
                cell.dayStickers.length > 0 ? stickerFontSize(cell.dayStickers.length) : null,
              );
              return (
                <button
                  className="cal-cell"
                  key={cell.key}
                  type="button"
                  disabled={!cell.supported}
                  data-date-key={cell.key}
                  tabIndex={cell.key === activeKey ? 0 : -1}
                  onClick={() => onSelectDate(cell.key)}
                  onFocus={() => setFocusKey(cell.key)}
                  aria-pressed={isSelected}
                  aria-label={`${cell.key}，${cell.dayEvents.length} 個行程`}
                  style={{ background: cellBackground(isToday, isSelected, cell.isZebra) }}
                >
                  <div
                    className="cal-cell-day"
                    style={{
                      color: isToday
                        ? 'var(--today-fg)'
                        : isSelected || cell.isFirstOfMonth
                          ? 'var(--accent-text)'
                          : 'var(--fg)',
                      fontWeight: isToday || isSelected || cell.isFirstOfMonth ? 800 : 500,
                    }}
                  >
                    {cell.isFirstOfMonth ? `${cell.date.getMonth() + 1}月` : cell.date.getDate()}
                  </div>
                  <div
                    className="cal-cell-lunar"
                    style={{
                      // Separate text tokens clear every cell background;
                      // the原檔's accent still supplies fills and outlines.
                      color: cell.lunar.isFestival ? 'var(--accent-text)' : 'var(--lunar-muted)',
                      fontWeight: cell.lunar.isFestival ? 800 : 600,
                    }}
                  >
                    {cell.lunar.text}
                  </div>
                  {isToday && flashToday && <div className="cal-cell-flash" aria-hidden="true" />}
                  {cell.hasConflict && <div className="cal-cell-conflict" aria-hidden="true" />}
                  {cell.dayEvents.slice(0, shown).map((entry) => (
                    <div
                      className="cal-cell-event"
                      // A cross-midnight event has one entry per day, so the
                      // event id alone is not unique across the grid.
                      key={`${entry.key}:${entry.isContinuation ? 'cont' : 'start'}`}
                      // The clock stays in the tooltip and the order; the day
                      // sheet carries the full times (DP-165).
                      title={entry.time ? `${entry.time} ${entry.event.title}` : entry.event.title}
                      style={{
                        background: calendarColor(calendars, entry.event.calendarId),
                        color: calendarTextColor(calendarColor(calendars, entry.event.calendarId)),
                      }}
                    >
                      {chipLabel(entry)}
                    </div>
                  ))}
                  {hidden > 0 && <div className="cal-cell-more">+{hidden}</div>}
                  {cell.dayStickers.length > 0 && (
                    // `margin-top:auto` in CSS pins the row to the bottom of
                    // the cell, as in the原檔, whatever else the cell holds.
                    <div
                      className="cal-cell-stickers"
                      style={{ fontSize: `${stickerFontSize(cell.dayStickers.length)}px` }}
                    >
                      {cell.dayStickers.map((sticker) => (
                        <span key={sticker.id}>{sticker.glyph}</span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A chip shows the title, not the clock — DP-165.
 *
 * The原檔 drew `10:00 團隊週會`. A phone cell is about 50px wide, so at 8.5px the
 * clock alone filled it and every chip read `10:00 …`. The cell's job is the
 * date, how many and which; the day sheet a tap opens lists the times in full.
 * A later day of a spanning event keeps its `續`, because without it the chip
 * would look like a separate event starting that day.
 */
function chipLabel(entry: MonthCellEntry): string {
  return entry.isContinuation ? `${CONTINUATION_LABEL} ${entry.event.title}` : entry.event.title;
}

function cellBackground(isToday: boolean, isSelected: boolean, isZebra: boolean): string {
  if (isToday) return 'var(--today-bg)';
  if (isSelected) return 'var(--surface-2)';
  return isZebra ? 'rgba(130,130,130,0.06)' : 'transparent';
}

/** One row inside a cell: an event, plus whether this day continues it. */
export interface MonthCellEntry {
  event: CalendarEvent;
  /** The occurrence's identity, shared by both halves of a cross-midnight event. */
  key: string;
  isContinuation: boolean;
  /** Clock label for this day, or `''` for an all-day event. */
  time: string;
}

/**
 * Places events on the days they visibly occupy — DP-064.
 *
 * A timed event is cut into display segments, so a 23:00–隔天 14:00 event
 * appears on both days instead of vanishing from the second one. The segments
 * share the occurrence key, which is what the conflict check and any count
 * deduplicate on.
 */
function groupEventsByDate(
  occurrences: ResolvedEventOccurrence[],
  displayTimezone: string,
  window: DisplaySegmentWindow,
): Map<string, MonthCellEntry[]> {
  const map = new Map<string, MonthCellEntry[]>();
  const push = (dateKey: string, entry: MonthCellEntry) => {
    const list = map.get(dateKey);
    if (list) list.push(entry);
    else map.set(dateKey, [entry]);
  };

  for (const { key: occurrenceKey, event } of occurrences) {
    if (event.allDay) {
      for (const segment of allDayDisplaySegments(event, window)) {
        push(segment.dateKey, {
          event,
          key: occurrenceKey,
          isContinuation: segment.isContinuation,
          time: segment.isContinuation ? CONTINUATION_LABEL : '',
        });
      }
      continue;
    }

    // Identity is the **occurrence** key, not the event id — DP-081. Two
    // occurrences of one weekly series must not be read as the same row, and
    // both halves of one cross-midnight occurrence must be. That is the exact
    // property the conflict check and the counts below deduplicate on.
    for (const segment of eventDisplaySegments(event, occurrenceKey, displayTimezone, window)) {
      push(segment.dateKey, {
        event,
        key: segment.key,
        isContinuation: segment.isContinuation,
        time: segment.isContinuation
          ? CONTINUATION_LABEL
          : eventStartTimeInZone(event, displayTimezone),
      });
    }
  }

  // All-day first, then by start time — the原檔's `dayEvents()` ordering. A
  // continuation starts at midnight, so it naturally leads the timed rows.
  for (const list of map.values()) {
    list.sort((left, right) => {
      if (left.event.allDay !== right.event.allDay) return left.event.allDay ? -1 : 1;
      if (left.isContinuation !== right.isContinuation) return left.isContinuation ? -1 : 1;
      return left.time.localeCompare(right.time);
    });
  }
  return map;
}

/** Stored order per day, matching the原檔's `stickersOn()`. */
function groupStickersByDate(stickers: Sticker[]): Map<string, Sticker[]> {
  const map = new Map<string, Sticker[]>();
  for (const sticker of stickers) {
    const list = map.get(sticker.date);
    if (list) list.push(sticker);
    else map.set(sticker.date, [sticker]);
  }
  return map;
}

/**
 * Two timed events overlapping — the red dot in the corner.
 *
 * DP-064 replaced the same-day clock-string comparison this used to do with the
 * shared instant check: `minutes(end) = 30 < minutes(start) = 1380` meant a
 * cross-midnight event could never be flagged, however obvious the overlap.
 *
 * Entries are compared, not segments: the same occurrence appearing twice in a
 * cell would otherwise be read as conflicting with itself.
 *
 * DP-081: `key` is now the occurrence key, so two occurrences of one weekly
 * series landing in the same cell are compared like any other pair, while the
 * two halves of one cross-midnight occurrence still share a key and are skipped.
 * Each entry's `event` carries that occurrence's own instants, so the overlap
 * test reads the times actually drawn rather than the first occurrence's.
 */
function hasOverlap(entries: MonthCellEntry[]): boolean {
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const left = entries[i]!;
      const right = entries[j]!;
      if (left.key === right.key) continue;
      if (occurrencesConflict(left.event, right.event)) return true;
    }
  }
  return false;
}
