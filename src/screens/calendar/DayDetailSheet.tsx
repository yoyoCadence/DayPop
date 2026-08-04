import { useMemo, useState, type FormEvent } from 'react';
import { fromDateKey, toDateKey } from '../../domain/date';
import { eventDate, eventEndTime, eventStartTime } from '../../domain/eventTime';
import { minutesFromTime } from '../../domain/timeGrid';
import type { CalendarEvent, TodoItem } from '../../domain/types';
import { ViewportLayer } from '../../shell/ViewportLayer';
import type { NewTodoInput } from '../../domain/mutations';

const WEEKDAY_NAMES = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

export interface DayDetailSheetProps {
  /** `YYYY-MM-DD`, or null when the sheet is closed. */
  dateKey: string | null;
  events: CalendarEvent[];
  todos: TodoItem[];
  onClose(): void;
  onOpenEvent(id: string): void;
  onNewEvent(): void;
  onAddTodo(input: NewTodoInput): void;
  onToggleTodo(id: string): void;
  onDeleteTodo(id: string): void;
}

/**
 * 日詳情 sheet, ported from the `dayOpen` block of
 * `日曆桌寵 Calendar Pet.dc.html`. Opened by tapping a month cell.
 *
 * Sticker, subtask and ordering fields now exist in the domain. Their visual
 * controls remain deliberately deferred to DP-055／DP-014.
 */
export function DayDetailSheet({ dateKey, ...rest }: DayDetailSheetProps) {
  if (!dateKey) return null;
  return <DayDetailSheetBody dateKey={dateKey} {...rest} />;
}

function DayDetailSheetBody({
  dateKey,
  events,
  todos,
  onClose,
  onOpenEvent,
  onNewEvent,
  onAddTodo,
  onToggleTodo,
  onDeleteTodo,
}: DayDetailSheetProps & { dateKey: string }) {
  const [todoDraft, setTodoDraft] = useState('');

  // Escape is handled by `CalendarScreen`, not here: the event sheet can be open
  // on top of this one, and two window listeners would close both at once.
  const date = fromDateKey(dateKey);
  const dayLabel = `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAY_NAMES[date.getDay()]}`;
  const todayKey = toDateKey(new Date());

  const dayEvents = useMemo(() => {
    const list = events
      .filter((event) => eventDate(event) === dateKey)
      .sort((left, right) => {
        if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
        return eventStartTime(left).localeCompare(eventStartTime(right));
      });
    const conflicting = overlappingIds(list);
    return list.map((event) => ({
      event,
      time: event.allDay ? '全天' : `${eventStartTime(event)}–${eventEndTime(event)}`,
      conflict: conflicting.has(event.id),
    }));
  }, [dateKey, events]);

  const dayTodos = useMemo(
    () =>
      todos
        .filter((todo) => todo.dueDate === dateKey)
        .map((todo) => ({
          todo,
          overdue: todo.completedAt === null && todo.dueDate !== null && todo.dueDate < todayKey,
        })),
    [dateKey, todayKey, todos],
  );

  function submitTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!todoDraft.trim()) return;
    onAddTodo({ title: todoDraft, date: dateKey });
    setTodoDraft('');
  }

  return (
    <ViewportLayer>
      <div className="cal-day-layer">
        <div className="cal-day-backdrop" onClick={onClose} />
        <div className="cal-day-sheet" role="dialog" aria-modal="true" aria-label={dayLabel}>
          <div className="cal-day-grip" aria-hidden="true" />
          <div className="cal-day-head">
            <div className="cal-day-title">{dayLabel}</div>
            <button className="cal-day-done" type="button" onClick={onClose}>
              完成
            </button>
          </div>

          <div className="cal-day-pending">
            <span className="dp-note-task">DP-055</span>
            貼圖列與貼圖選擇器在原稿就在這個位置，資料模型已完成，等 DP-055 接上 UI。
          </div>

          <div className="cal-day-section">行程</div>
          {dayEvents.length === 0 && <div className="cal-day-empty">這天沒有行程</div>}
          {dayEvents.map((row) => (
            <button
              className="cal-day-event"
              key={row.event.id}
              type="button"
              onClick={() => onOpenEvent(row.event.id)}
            >
              <span
                className="cal-day-bar"
                style={{ background: row.conflict ? '#e4002b' : 'var(--accent)' }}
              />
              <span className="cal-day-time">{row.time}</span>
              <span className="cal-day-event-title">{row.event.title}</span>
              {row.conflict && <span className="cal-day-conflict">衝突</span>}
            </button>
          ))}
          <button className="cal-day-new" type="button" onClick={onNewEvent}>
            ＋ 新增事件
          </button>

          <div className="cal-day-section">待辦清單</div>
          {dayTodos.map((row) => (
            <div className="cal-day-todo" key={row.todo.id}>
              <button
                className="cal-day-check"
                type="button"
                aria-pressed={row.todo.completedAt !== null}
                aria-label={`完成 ${row.todo.title}`}
                onClick={() => onToggleTodo(row.todo.id)}
                style={{ background: row.todo.completedAt ? 'var(--accent)' : 'transparent' }}
              >
                {row.todo.completedAt ? '✓' : ''}
              </button>
              <span
                className="cal-day-todo-title"
                style={{
                  color: row.todo.completedAt ? 'var(--faint)' : 'var(--fg)',
                  textDecoration: row.todo.completedAt ? 'line-through' : 'none',
                }}
              >
                {row.todo.title}
              </span>
              {row.overdue && (
                <span className="cal-day-overdue">
                  逾期・原{date.getMonth() + 1}/{date.getDate()}
                </span>
              )}
              <button
                className="cal-day-delete"
                type="button"
                aria-label={`刪除 ${row.todo.title}`}
                onClick={() => onDeleteTodo(row.todo.id)}
              >
                ×
              </button>
            </div>
          ))}

          <form className="cal-day-todo-add" onSubmit={submitTodo}>
            <input
              value={todoDraft}
              onChange={(event) => setTodoDraft(event.target.value)}
              placeholder="新增清單項目…"
              aria-label="新增清單項目"
            />
            <button type="submit" aria-label="新增待辦">
              ＋
            </button>
          </form>

          <div className="cal-day-pending">
            <span className="dp-note-task">DP-014</span>
            待辦子項、拖曳排序與優先度已可保存，後續依原稿補上操作介面。
          </div>
        </div>
      </div>
    </ViewportLayer>
  );
}

/** Ids of timed events that overlap another timed event on the same day. */
function overlappingIds(events: CalendarEvent[]): Set<string> {
  const result = new Set<string>();
  const timed = events.filter((event) => !event.allDay);
  for (let i = 0; i < timed.length; i += 1) {
    for (let j = i + 1; j < timed.length; j += 1) {
      const a = timed[i]!;
      const b = timed[j]!;
      if (
        minutesFromTime(eventStartTime(a)) < minutesFromTime(eventEndTime(b)) &&
        minutesFromTime(eventStartTime(b)) < minutesFromTime(eventEndTime(a))
      ) {
        result.add(a.id);
        result.add(b.id);
      }
    }
  }
  return result;
}
