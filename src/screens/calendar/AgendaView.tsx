import { useMemo } from 'react';
import { addDays, fromDateKey, toDateKey } from '../../domain/date';
import { calendarColor } from '../../domain/calendars';
import { eventDisplaySegments } from '../../domain/displaySegments';
import { eventDateInZone, eventStartTimeInZone } from '../../domain/eventTime';
import type { OccurrenceWindow, ResolvedEventOccurrence } from '../../domain/recurrence';
import type { Calendar, CalendarEvent, TodoItem } from '../../domain/types';
import { occurrenceTarget, type OccurrenceTarget } from './occurrenceTarget';

/** Marks the second and later days of a cross-midnight event — DP-064. */
const CONTINUATION_LABEL = '續';

/** The原檔 looks ahead 16 days and drops empty days after tomorrow. */
const LOOKAHEAD_DAYS = 16;
const WEEKDAY_LABELS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

export interface AgendaViewProps {
  /**
   * Expands the visible calendars into occurrences for one window — DP-081.
   * This list asks for exactly the 16 days it looks ahead.
   */
  resolveOccurrences(window: OccurrenceWindow): ResolvedEventOccurrence[];
  /** The one timezone this list is drawn in — DP-064. */
  displayTimezone: string;
  /** Today in that zone, computed once by the screen. */
  todayKey: string;
  todos: TodoItem[];
  calendars: Calendar[];
  onOpenEvent(target: OccurrenceTarget): void;
  onToggleTodo(id: string): void;
}

/**
 * 列表檢視 — the upcoming agenda, ported from the `agendaDays` block of
 * `日曆桌寵 Calendar Pet.dc.html`.
 *
 * Today and tomorrow always appear even when empty; later days only appear when
 * they have something on them.
 *
 * The原檔 shows a weather line on the right of each day header. That is one of
 * the prototype's fake features (`weather()` picks a string from a fixed array
 * by day-of-month), so the slot stays empty until a real source is chosen — see
 * `docs/prototype-behavior-baseline.md`. The原檔 also only knows
 * `when=today|tomorrow` for todos; DayPop stores real dates, so todos appear on
 * the day they are actually due.
 */
export function AgendaView({
  resolveOccurrences,
  displayTimezone,
  todayKey,
  todos,
  calendars,
  onOpenEvent,
  onToggleTodo,
}: AgendaViewProps) {
  const days = useMemo(() => {
    // The screen's one reading of "today", not a second one from the device
    // clock — DP-064. The rows are filled with events placed by the display
    // zone, so the row they start from has to come from the same zone.
    const today = fromDateKey(todayKey);
    // One pass over the events for the whole look-ahead, not one per day —
    // cutting every event 16 times and keeping one slice is what made 綜覽 take
    // 16 seconds before it was bucketed (DP-064).
    const lastKey = toDateKey(addDays(today, LOOKAHEAD_DAYS - 1));
    // The look-ahead is also the occurrence window — DP-081. Nothing outside
    // the 16 days this list can draw is expanded.
    const occurrences = resolveOccurrences({ startDate: todayKey, endDate: lastKey });
    type AgendaRow = {
      event: CalendarEvent;
      /** Which drawn occurrence this row is — DP-082. */
      target: OccurrenceTarget;
      /** Occurrence key — DP-081, see `AgendaItem.rowKey`. */
      key: string;
      time: string;
      isContinuation: boolean;
    };
    const segmentsByDate = new Map<string, AgendaRow[]>();
    const bucket = (dateKey: string, row: AgendaRow) => {
      const list = segmentsByDate.get(dateKey);
      if (list) list.push(row);
      else segmentsByDate.set(dateKey, [row]);
    };

    for (const resolved of occurrences) {
      const { key: occurrenceKey, event } = resolved;
      const target = occurrenceTarget(resolved);
      if (event.allDay) {
        const dateKey = eventDateInZone(event, displayTimezone);
        if (dateKey >= todayKey && dateKey <= lastKey) {
          bucket(dateKey, { event, target, key: occurrenceKey, time: '全天', isContinuation: false });
        }
        continue;
      }
      // The occurrence key, not the event id — DP-081.
      for (const segment of eventDisplaySegments(event, occurrenceKey, displayTimezone, {
        startDateKey: todayKey,
        endDateKey: lastKey,
      })) {
        bucket(segment.dateKey, {
          event,
          target,
          key: segment.key,
          // A continuation day says so instead of repeating the start clock.
          time: segment.isContinuation
            ? CONTINUATION_LABEL
            : eventStartTimeInZone(event, displayTimezone),
          isContinuation: segment.isContinuation,
        });
      }
    }

    const result: {
      key: string;
      dateLabel: string;
      weekdayLabel: string;
      isToday: boolean;
      items: AgendaItem[];
    }[] = [];

    for (let offset = 0; offset < LOOKAHEAD_DAYS; offset += 1) {
      const date = addDays(today, offset);
      const key = toDateKey(date);

      const eventItems: AgendaItem[] = (segmentsByDate.get(key) ?? [])
        .slice()
        .sort((left, right) => {
          if (left.event.allDay !== right.event.allDay) return left.event.allDay ? -1 : 1;
          if (left.isContinuation !== right.isContinuation) return left.isContinuation ? -1 : 1;
          return left.time.localeCompare(right.time);
        })
        .map((row) => ({
          kind: 'event',
          rowKey: row.key,
          id: row.event.id,
          target: row.target,
          time: row.time,
          title: row.event.title,
          done: false,
          color: calendarColor(calendars, row.event.calendarId),
        }));

      const todoItems: AgendaItem[] = todos
        .filter((todo) => todo.dueDate === key)
        .map((todo) => ({
          kind: 'todo',
          rowKey: todo.id,
          id: todo.id,
          time: '待辦',
          title: todo.title,
          done: todo.completedAt !== null,
          // Todos have no calendar colour in the原檔 either.
          color: 'var(--accent)',
        }));

      const items = [...eventItems, ...todoItems];
      if (items.length === 0 && offset > 1) continue;

      result.push({
        key,
        dateLabel: `${date.getMonth() + 1}月${date.getDate()}日`,
        weekdayLabel: offset === 0 ? '今天' : offset === 1 ? '明天' : WEEKDAY_LABELS[date.getDay()]!,
        isToday: key === todayKey,
        items,
      });
    }

    return result;
  }, [calendars, displayTimezone, resolveOccurrences, todayKey, todos]);

  return (
    <div className="cal-view-pane cal-agenda">
      {days.map((day) => (
        <div className="cal-agenda-day" key={day.key}>
          <div className="cal-agenda-head">
            <div
              className="cal-agenda-date"
              style={{ color: day.isToday ? 'var(--accent)' : 'var(--fg)' }}
            >
              {day.dateLabel}
            </div>
            <div className="cal-agenda-weekday">{day.weekdayLabel}</div>
            <div className="cal-agenda-spacer" />
          </div>
          {day.items.length === 0 && <div className="cal-agenda-empty">沒有安排</div>}
          {day.items.map((item) => (
            <button
              className="cal-agenda-item"
              key={`${item.kind}-${item.rowKey}`}
              type="button"
              onClick={() =>
                item.kind === 'event' && item.target
                  ? onOpenEvent(item.target)
                  : onToggleTodo(item.id)
              }
            >
              <span className="cal-agenda-bar" style={{ background: item.color }} />
              <span className="cal-agenda-time">{item.time}</span>
              <span className="cal-agenda-body">
                <span
                  className="cal-agenda-title"
                  style={{
                    color: item.done ? 'var(--faint)' : 'var(--fg)',
                    textDecoration: item.done ? 'line-through' : 'none',
                  }}
                >
                  {item.title}
                </span>
              </span>
              {item.kind === 'todo' && (
                <span
                  className="cal-agenda-check"
                  style={{ color: item.done ? 'var(--accent)' : 'var(--faint)' }}
                >
                  {item.done ? '✓' : '○'}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

interface AgendaItem {
  kind: 'event' | 'todo';
  /** React key: the occurrence key for events, the id for todos — DP-081. */
  rowKey: string;
  /** What a tap addresses — the base event id, or the todo id. */
  id: string;
  /** Set for events: which occurrence was tapped — DP-082. */
  target?: OccurrenceTarget;
  time: string;
  title: string;
  done: boolean;
  /** Owning calendar's colour for events; the accent for todos. */
  color: string;
}
