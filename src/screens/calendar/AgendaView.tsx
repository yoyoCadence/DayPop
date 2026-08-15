import { useMemo } from 'react';
import { addDays, fromDateKey, toDateKey } from '../../domain/date';
import { calendarColor } from '../../domain/calendars';
import { eventDateInZone, eventStartTimeInZone } from '../../domain/eventTime';
import type { Calendar, CalendarEvent, TodoItem } from '../../domain/types';

/** The原檔 looks ahead 16 days and drops empty days after tomorrow. */
const LOOKAHEAD_DAYS = 16;
const WEEKDAY_LABELS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

export interface AgendaViewProps {
  events: CalendarEvent[];
  /** The one timezone this list is drawn in — DP-064. */
  displayTimezone: string;
  /** Today in that zone, computed once by the screen. */
  todayKey: string;
  todos: TodoItem[];
  calendars: Calendar[];
  onOpenEvent(id: string): void;
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
  events,
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

      const eventItems: AgendaItem[] = events
        .filter((event) => eventDateInZone(event, displayTimezone) === key)
        .sort((left, right) => {
          if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
          return eventStartTimeInZone(left, displayTimezone).localeCompare(
            eventStartTimeInZone(right, displayTimezone),
          );
        })
        .map((event) => ({
          kind: 'event',
          id: event.id,
          time: event.allDay ? '全天' : eventStartTimeInZone(event, displayTimezone),
          title: event.title,
          done: false,
          color: calendarColor(calendars, event.calendarId),
        }));

      const todoItems: AgendaItem[] = todos
        .filter((todo) => todo.dueDate === key)
        .map((todo) => ({
          kind: 'todo',
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
  }, [calendars, displayTimezone, events, todayKey, todos]);

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
              key={`${item.kind}-${item.id}`}
              type="button"
              onClick={() => (item.kind === 'event' ? onOpenEvent(item.id) : onToggleTodo(item.id))}
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
  id: string;
  time: string;
  title: string;
  done: boolean;
  /** Owning calendar's colour for events; the accent for todos. */
  color: string;
}
