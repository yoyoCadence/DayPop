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
import { addDays, fromDateKey, startOfWeek, toDateKey, weeksBetween } from '../../domain/date';
import { eventDate, eventEndTime, eventStartTime } from '../../domain/eventTime';
import { lunarCell } from '../../domain/lunar';
import { stickerFontSize } from '../../domain/stickerGlyphs';
import type { CalendarEvent, Sticker } from '../../domain/types';

/**
 * Continuously scrolling month grid, ported from the `data-month-scroll` block
 * of `日曆桌寵 Calendar Pet.dc.html`.
 *
 * The原檔 does not paginate month by month: it renders a rolling buffer of week
 * rows and grows it at either end while the user scrolls, deriving the header
 * label from whichever week sits at the top. That behaviour is the design, so it
 * is reproduced here rather than replaced with a 6×7 page.
 */

/** Week rows visible at once. DP-018 turns this into a stored preference. */
const WEEKS_SHOWN = 4;
/** Buffer starts 26 weeks back and covers a year, matching the原檔. */
const INITIAL_WEEKS_BEFORE = 26;
const INITIAL_BUFFER_WEEKS = 53;
const BUFFER_GROWTH_WEEKS = 12;
const MIN_ROW_HEIGHT = 58;
const INITIAL_ROW_HEIGHT = 96;
/** Events drawn inside a cell before collapsing into a `+N` line. */
const MAX_CELL_EVENTS = 3;

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

export interface MonthViewHandle {
  scrollToToday(smooth: boolean): void;
  /** One screenful of weeks, used by the header's ‹ › buttons in month view. */
  page(direction: 1 | -1): void;
}

export interface MonthViewProps {
  ref?: RefObject<MonthViewHandle | null>;
  weekStartsOn: 0 | 1;
  events: CalendarEvent[];
  stickers: Sticker[];
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
  events,
  stickers,
  selectedDate,
  todayKey,
  flashToday,
  onSelectDate,
  onPeriodLabelChange,
}: MonthViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [bufferStart, setBufferStart] = useState(() =>
    toDateKey(addDays(startOfWeek(new Date(), weekStartsOn), -INITIAL_WEEKS_BEFORE * 7)),
  );
  const [bufferWeeks, setBufferWeeks] = useState(INITIAL_BUFFER_WEEKS);
  const [rowHeight, setRowHeight] = useState(INITIAL_ROW_HEIGHT);
  const labelRef = useRef('');
  // Scroll compensation for rows prepended above the current position.
  const pendingScrollAdjust = useRef(0);

  const eventsByDate = useMemo(() => groupEventsByDate(events), [events]);
  const stickersByDate = useMemo(() => groupStickersByDate(stickers), [stickers]);

  const scrollToToday = useCallback(
    (smooth: boolean, height?: number) => {
      const element = scrollRef.current;
      if (!element) return;
      const row = height ?? rowHeight;
      const index = weeksBetween(fromDateKey(bufferStart), startOfWeek(new Date(), weekStartsOn));
      element.scrollTo({ top: Math.max(0, index * row), behavior: smooth ? 'smooth' : 'auto' });
    },
    [bufferStart, rowHeight, weekStartsOn],
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollToToday: (smooth: boolean) => scrollToToday(smooth),
      page: (direction: 1 | -1) => {
        scrollRef.current?.scrollBy({
          top: direction * rowHeight * WEEKS_SHOWN,
          behavior: 'smooth',
        });
      },
    }),
    [rowHeight, scrollToToday],
  );

  // Row height follows the available space, so a full screenful is WEEKS_SHOWN
  // rows on any device. Re-measured whenever the viewport resizes.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const measure = () => {
      if (element.clientHeight <= 0) return;
      const next = Math.max(MIN_ROW_HEIGHT, Math.floor(element.clientHeight / WEEKS_SHOWN));
      setRowHeight((current) => (current === next ? current : next));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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

  const weeks = useMemo(() => {
    const gridStart = startOfWeek(fromDateKey(bufferStart), weekStartsOn);
    return Array.from({ length: bufferWeeks }, (_, week) =>
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
    );
  }, [bufferStart, bufferWeeks, eventsByDate, stickersByDate, weekStartsOn]);

  return (
    <div className="cal-view-pane">
      <div className="cal-weekhead">
        {weekdayHead.map((head, index) => (
          <div key={index} style={{ color: head.isWeekend ? 'var(--accent)' : 'var(--muted)' }}>
            {head.label}
          </div>
        ))}
      </div>
      <div className="cal-month-scroll" ref={scrollRef} onScroll={handleScroll}>
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
                  onClick={() => onSelectDate(cell.key)}
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
                      color: cell.lunar.isFestival ? 'var(--accent)' : 'var(--faint)',
                      fontWeight: cell.lunar.isFestival ? 800 : 600,
                    }}
                  >
                    {cell.lunar.text}
                  </div>
                  {isToday && flashToday && <div className="cal-cell-flash" aria-hidden="true" />}
                  {cell.hasConflict && <div className="cal-cell-conflict" aria-hidden="true" />}
                  {cell.dayEvents.slice(0, MAX_CELL_EVENTS).map((event) => (
                    <div
                      className="cal-cell-event"
                      key={event.id}
                      // Per-calendar colour rendering is wired with settings／CRUD.
                      style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                    >
                      {event.allDay ? event.title : `${eventStartTime(event)} ${event.title}`}
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

function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = eventDate(event);
    const list = map.get(key);
    if (list) list.push(event);
    else map.set(key, [event]);
  }
  // All-day first, then by start time — the原檔's `dayEvents()` ordering.
  for (const list of map.values()) {
    list.sort((left, right) => {
      if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
      return eventStartTime(left).localeCompare(eventStartTime(right));
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

/** Two timed events on the same day overlapping — the red dot in the corner. */
function hasOverlap(events: CalendarEvent[]): boolean {
  const timed = events.filter((event) => !event.allDay);
  for (let i = 0; i < timed.length; i += 1) {
    for (let j = i + 1; j < timed.length; j += 1) {
      const a = timed[i]!;
      const b = timed[j]!;
      if (
        minutes(eventStartTime(a)) < minutes(eventEndTime(b)) &&
        minutes(eventStartTime(b)) < minutes(eventEndTime(a))
      ) {
        return true;
      }
    }
  }
  return false;
}

function minutes(time: string): number {
  const [hour = 0, minute = 0] = (time || '0:0').split(':').map(Number);
  return hour * 60 + minute;
}
