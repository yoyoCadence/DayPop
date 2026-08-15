import {
  useCallback,
  useEffect,
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
  daysBetween,
  fromDateKey,
  monthGridWeekCount,
  startOfWeek,
  toDateKey,
  weeksBetween,
} from '../../domain/date';
import {
  eventDisplaySegments,
  occurrencesConflict,
  type DisplaySegmentWindow,
} from '../../domain/displaySegments';
import { eventDateInZone, eventStartTimeInZone } from '../../domain/eventTime';
import { calendarColor, CALENDAR_TEXT_COLOR } from '../../domain/calendars';
import { lunarCell } from '../../domain/lunar';
import { stickerFontSize } from '../../domain/stickerGlyphs';
import type { Calendar, CalendarEvent, CalendarGridMode, Sticker } from '../../domain/types';

/**
 * Continuously scrolling month grid, ported from the `data-month-scroll` block
 * of `日曆桌寵 Calendar Pet.dc.html`.
 *
 * The原檔 does not paginate month by month: it renders a rolling buffer of week
 * rows and grows it at either end while the user scrolls, deriving the header
 * label from whichever week sits at the top. That behaviour is the design, so it
 * is reproduced here rather than replaced with a 6×7 page.
 */

/** Buffer starts 26 weeks back and covers a year, matching the原檔. */
const INITIAL_WEEKS_BEFORE = 26;
const INITIAL_BUFFER_WEEKS = 53;
const BUFFER_GROWTH_WEEKS = 12;
const MIN_ROW_HEIGHT = 58;
const INITIAL_ROW_HEIGHT = 96;
/** Events drawn inside a cell before collapsing into a `+N` line. */
const MAX_CELL_EVENTS = 3;

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
  events: CalendarEvent[];
  stickers: Sticker[];
  calendars: Calendar[];
  selectedDate: string;
  todayKey: string;
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
  events,
  stickers,
  calendars,
  selectedDate,
  todayKey,
  flashToday,
  onSelectDate,
  onPeriodLabelChange,
}: MonthViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Anchored on the display zone's today, like everything else about "today"
  // on this grid — DP-064.
  const [bufferStart, setBufferStart] = useState(() =>
    toDateKey(addDays(startOfWeek(fromDateKey(todayKey), weekStartsOn), -INITIAL_WEEKS_BEFORE * 7)),
  );
  const [bufferWeeks, setBufferWeeks] = useState(INITIAL_BUFFER_WEEKS);
  const [rowHeight, setRowHeight] = useState(INITIAL_ROW_HEIGHT);
  const rowHeightRef = useRef(INITIAL_ROW_HEIGHT);
  const [visibleMonth, setVisibleMonth] = useState(() => fromDateKey(todayKey));
  const weeksShown = monthGridWeekCount(visibleMonth, weekStartsOn, calendarGridMode);
  const labelRef = useRef('');
  // Scroll compensation for rows prepended above the current position.
  const pendingScrollAdjust = useRef(0);

  const gridStart = useMemo(
    () => startOfWeek(fromDateKey(bufferStart), weekStartsOn),
    [bufferStart, weekStartsOn],
  );
  // Date keys are zero-padded `YYYY-MM-DD`, so string order is date order.
  const firstKey = toDateKey(gridStart);
  const lastKey = toDateKey(addDays(gridStart, bufferWeeks * 7 - 1));
  const inBuffer = useCallback(
    (key: string) => key >= firstKey && key <= lastKey,
    [firstKey, lastKey],
  );

  const eventsByDate = useMemo(
    // Windowed to the rendered buffer: an event longer than it is clipped to
    // what this grid can draw rather than cut into every day it spans, and a
    // span past `MAX_SEGMENT_DAYS` stays a drawable event instead of throwing.
    () => groupEventsByDate(events, displayTimezone, { startDateKey: firstKey, endDateKey: lastKey }),
    [displayTimezone, events, firstKey, lastKey],
  );
  const stickersByDate = useMemo(() => groupStickersByDate(stickers), [stickers]);

  // Roving tabindex — DP-069. The buffer holds hundreds of day cells and grows
  // as the user scrolls, so leaving every cell in the tab order put the bottom
  // tab bar 382 Tab presses away. Exactly one cell is tabbable; the arrow keys
  // move between days from there.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  /** A ref, not state: this only drives a DOM call, never what is rendered. */
  const pendingFocus = useRef<string | null>(null);

  const scrollToToday = useCallback(
    (smooth: boolean, height?: number) => {
      const element = scrollRef.current;
      if (!element) return;
      const row = height ?? rowHeight;
      // `todayKey` is already read in the display zone by the screen. Reading
      // the device clock here instead scrolled to a different day than the one
      // the grid had highlighted — DP-064.
      const index = weeksBetween(
        fromDateKey(bufferStart),
        startOfWeek(fromDateKey(todayKey), weekStartsOn),
      );
      element.scrollTo({ top: Math.max(0, index * row), behavior: smooth ? 'smooth' : 'auto' });
    },
    [bufferStart, rowHeight, todayKey, weekStartsOn],
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollToToday: (smooth: boolean) => scrollToToday(smooth),
      page: (direction: 1 | -1) => {
        scrollRef.current?.scrollBy({
          top: direction * rowHeight * weeksShown,
          behavior: 'smooth',
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
      const previous = rowHeightRef.current;
      if (previous === next) return;
      const topWeek = element.scrollTop / previous;
      rowHeightRef.current = next;
      element.scrollTop = topWeek * next;
      setRowHeight(next);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [weeksShown]);

  // Land on today once the real row height is known.
  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current || rowHeight === INITIAL_ROW_HEIGHT) return;
    initialised.current = true;
    scrollToToday(false, rowHeight);
  }, [rowHeight, scrollToToday]);

  useLayoutEffect(() => {
    if (!pendingScrollAdjust.current || !scrollRef.current) return;
    scrollRef.current.scrollTop += pendingScrollAdjust.current;
    pendingScrollAdjust.current = 0;
  });

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;

    const index = Math.round(element.scrollTop / rowHeight);
    // The原檔 labels the buffer by its middle day, so a row straddling two
    // months reads as the month that owns most of it.
    const middle = addDays(fromDateKey(bufferStart), index * 7 + 3);
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
      pendingScrollAdjust.current += BUFFER_GROWTH_WEEKS * rowHeight;
      setBufferStart((current) => toDateKey(addDays(fromDateKey(current), -BUFFER_GROWTH_WEEKS * 7)));
      setBufferWeeks((current) => current + BUFFER_GROWTH_WEEKS);
    } else if (index > bufferWeeks - 8) {
      setBufferWeeks((current) => current + BUFFER_GROWTH_WEEKS);
    }
  }, [bufferStart, bufferWeeks, onPeriodLabelChange, rowHeight]);

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
   * Extends the rolling buffer so `key` has a cell to focus. Called from the
   * key handler rather than from the effect below, so the effect stays a pure
   * DOM side effect with no state updates of its own.
   */
  const ensureInBuffer = useCallback(
    (key: string) => {
      if (key < firstKey) {
        const weeks = Math.max(
          BUFFER_GROWTH_WEEKS,
          Math.ceil(daysBetween(fromDateKey(key), fromDateKey(firstKey)) / 7) + 1,
        );
        // Prepending rows pushes everything down; compensate so the viewport
        // stays where the user left it, exactly as `handleScroll` does.
        pendingScrollAdjust.current += weeks * rowHeightRef.current;
        setBufferStart((current) => toDateKey(addDays(fromDateKey(current), -weeks * 7)));
        setBufferWeeks((current) => current + weeks);
      } else if (key > lastKey) {
        const weeks = Math.max(
          BUFFER_GROWTH_WEEKS,
          Math.ceil(daysBetween(fromDateKey(lastKey), fromDateKey(key)) / 7) + 1,
        );
        setBufferWeeks((current) => current + weeks);
      }
    },
    [firstKey, lastKey],
  );

  // Focus follows the key once its cell exists. The buffer bounds are
  // dependencies so a key that needed a bigger buffer gets focused on the
  // render that adds its row.
  useEffect(() => {
    const key = pendingFocus.current;
    if (key === null) return;

    const cell = scrollRef.current?.querySelector<HTMLButtonElement>(`[data-date-key="${key}"]`);
    if (!cell) return;

    cell.focus();
    pendingFocus.current = null;
  }, [firstKey, focusKey, lastKey]);

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
      ensureInBuffer(next);
      setFocusKey(next);
      pendingFocus.current = next;
    },
    [ensureInBuffer, weekStartsOn],
  );

  const weeks = useMemo(
    () =>
    Array.from({ length: bufferWeeks }, (_, week) =>
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
          lunar: lunarCell(date),
          hasConflict: hasOverlap(dayEvents),
        };
      }),
    ),
    [bufferWeeks, eventsByDate, gridStart, stickersByDate],
  );

  return (
    <div className="cal-view-pane">
      <div className="cal-weekhead">
        {weekdayHead.map((head, index) => (
          <div key={index} style={{ color: head.isWeekend ? 'var(--accent)' : 'var(--muted)' }}>
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
        {weeks.map((cells, week) => (
          <div className="cal-week-row" key={week} style={{ height: `${rowHeight}px` }}>
            {cells.map((cell) => {
              const isToday = cell.key === todayKey;
              const isSelected = cell.key === selectedDate;
              const hidden = cell.dayEvents.length - MAX_CELL_EVENTS;
              return (
                <button
                  className="cal-cell"
                  key={cell.key}
                  type="button"
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
                          ? 'var(--accent)'
                          : 'var(--fg)',
                      fontWeight: isToday || isSelected || cell.isFirstOfMonth ? 800 : 500,
                    }}
                  >
                    {cell.isFirstOfMonth ? `${cell.date.getMonth() + 1}月` : cell.date.getDate()}
                  </div>
                  <div
                    className="cal-cell-lunar"
                    style={{
                      // Festivals keep the原檔's accent; ordinary days use the
                      // DP-070 token instead of `--faint`, which fails AA here.
                      color: cell.lunar.isFestival ? 'var(--accent)' : 'var(--lunar-muted)',
                      fontWeight: cell.lunar.isFestival ? 800 : 600,
                    }}
                  >
                    {cell.lunar.text}
                  </div>
                  {isToday && flashToday && <div className="cal-cell-flash" aria-hidden="true" />}
                  {cell.hasConflict && <div className="cal-cell-conflict" aria-hidden="true" />}
                  {cell.dayEvents.slice(0, MAX_CELL_EVENTS).map((entry) => (
                    <div
                      className="cal-cell-event"
                      // A cross-midnight event has one entry per day, so the
                      // event id alone is not unique across the grid.
                      key={`${entry.key}:${entry.isContinuation ? 'cont' : 'start'}`}
                      style={{
                        background: calendarColor(calendars, entry.event.calendarId),
                        color: CALENDAR_TEXT_COLOR,
                      }}
                    >
                      {entry.time ? `${entry.time} ${entry.event.title}` : entry.event.title}
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
  events: CalendarEvent[],
  displayTimezone: string,
  window: DisplaySegmentWindow,
): Map<string, MonthCellEntry[]> {
  const map = new Map<string, MonthCellEntry[]>();
  const push = (dateKey: string, entry: MonthCellEntry) => {
    const list = map.get(dateKey);
    if (list) list.push(entry);
    else map.set(dateKey, [entry]);
  };

  for (const event of events) {
    if (event.allDay) {
      // All-day placement is unchanged by DP-064; it has no instants to cut.
      push(eventDateInZone(event, displayTimezone), {
        event,
        key: event.id,
        isContinuation: false,
        time: '',
      });
      continue;
    }

    // Identity is the event id until DP-014 wires recurring occurrences into
    // these views; both halves of one event still share it, which is the
    // property the conflict check and the counts rely on.
    for (const segment of eventDisplaySegments(event, event.id, displayTimezone, window)) {
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
