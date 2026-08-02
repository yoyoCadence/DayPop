import { useMemo } from 'react';
import { addDays, startOfDay, toDateKey } from '../../domain/date';
import type { CalendarEvent, TodoItem } from '../../domain/types';

/** The原檔 looks ahead 16 days and drops empty days after tomorrow. */
const LOOKAHEAD_DAYS = 16;
const WEEKDAY_LABELS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

export interface AgendaViewProps {
  events: CalendarEvent[];
  todos: TodoItem[];
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
export function AgendaView({ events, todos, onOpenEvent, onToggleTodo }: AgendaViewProps) {
  const days = useMemo(() => {
    const today = startOfDay(new Date());
    const todayKey = toDateKey(today);
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
        .filter((event) => event.date === key)
        .sort((left, right) => {
          if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
          return left.start.localeCompare(right.start);
        })
        .map((event) => ({
          kind: 'event',
          id: event.id,
          time: event.allDay ? '全天' : event.start,
          title: event.title,
          done: false,
        }));

      const todoItems: AgendaItem[] = todos
        .filter((todo) => todo.date === key)
        .map((todo) => ({
          kind: 'todo',
          id: todo.id,
          time: '待辦',
          title: todo.title,
          done: todo.done,
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
  }, [events, todos]);

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
              <span
                className="cal-agenda-bar"
                style={{
                  // Per-calendar colours arrive with DP-012/DP-026; todos use the
                  // accent in the原檔 too.
                  background: 'var(--accent)',
                }}
              />
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
}
