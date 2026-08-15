import { useMemo, useState, type FormEvent } from 'react';
import { fromDateKey } from '../../domain/date';
import {
  conflictingOccurrenceKeys,
  eventDisplaySegments,
  segmentTimeRange,
} from '../../domain/displaySegments';
import { eventDateInZone } from '../../domain/eventTime';

/** Marks the second and later days of a cross-midnight event — DP-064. */
const CONTINUATION_LABEL = '續';
import { calendarColor } from '../../domain/calendars';
import { STICKER_GLYPHS } from '../../domain/stickerGlyphs';
import type { Calendar, CalendarEvent, Sticker, TodoItem } from '../../domain/types';
import { ViewportLayer } from '../../shell/ViewportLayer';
import type { NewStickerInput, NewTodoInput } from '../../domain/mutations';

const WEEKDAY_NAMES = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

export interface DayDetailSheetProps {
  /** `YYYY-MM-DD`, or null when the sheet is closed. */
  dateKey: string | null;
  events: CalendarEvent[];
  /** The one timezone this sheet is drawn in — DP-064. */
  displayTimezone: string;
  /**
   * Today in that zone, computed once by the screen. The overdue marker below
   * compares against it: read from the device clock instead, this sheet and
   * 綜覽 disagreed about whether the same todo was late.
   */
  todayKey: string;
  todos: TodoItem[];
  stickers: Sticker[];
  calendars: Calendar[];
  onClose(): void;
  onOpenEvent(id: string): void;
  onNewEvent(): void;
  onAddTodo(input: NewTodoInput): void;
  onToggleTodo(id: string): void;
  onDeleteTodo(id: string): void;
  onAddSticker(input: NewStickerInput): void;
  onDeleteSticker(id: string): void;
}

/**
 * 日詳情 sheet, ported from the `dayOpen` block of
 * `日曆桌寵 Calendar Pet.dc.html`. Opened by tapping a month cell.
 *
 * Todo subtasks and drag ordering exist in the domain but still have no visual
 * controls — that remains DP-014.
 */
export function DayDetailSheet({ dateKey, ...rest }: DayDetailSheetProps) {
  if (!dateKey) return null;
  // Keyed by date so the picker closes when another day is opened, matching
  // the原檔's `openDay()`, which resets `stickerPick`.
  return <DayDetailSheetBody key={dateKey} dateKey={dateKey} {...rest} />;
}

function DayDetailSheetBody({
  dateKey,
  events,
  displayTimezone,
  todayKey,
  todos,
  stickers,
  calendars,
  onClose,
  onOpenEvent,
  onNewEvent,
  onAddTodo,
  onToggleTodo,
  onDeleteTodo,
  onAddSticker,
  onDeleteSticker,
}: DayDetailSheetProps & { dateKey: string }) {
  const [todoDraft, setTodoDraft] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  // Escape is handled by `CalendarScreen`, not here: the event sheet can be open
  // on top of this one, and two window listeners would close both at once.
  const date = fromDateKey(dateKey);
  const dayLabel = `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAY_NAMES[date.getDay()]}`;

  const dayEvents = useMemo(() => {
    // Display segments, not just the starting day — DP-064. The month cell for
    // the second day of an overnight event says 「續」; opening it used to show
    // 「這天沒有行程」.
    const window = { startDateKey: dateKey, endDateKey: dateKey };
    const rows: { event: CalendarEvent; time: string; isContinuation: boolean }[] = [];

    for (const event of events) {
      if (event.allDay) {
        if (eventDateInZone(event, displayTimezone) === dateKey) {
          rows.push({ event, time: '全天', isContinuation: false });
        }
        continue;
      }
      for (const segment of eventDisplaySegments(event, event.id, displayTimezone, window)) {
        rows.push({
          event,
          // The segment's own span: 23:00–24:00 on the first day, 00:00–00:30
          // on the second, rather than the whole event's clock on both.
          time: segmentTimeRange(segment),
          isContinuation: segment.isContinuation,
        });
      }
    }

    rows.sort((left, right) => {
      if (left.event.allDay !== right.event.allDay) return left.event.allDay ? -1 : 1;
      if (left.isContinuation !== right.isContinuation) return left.isContinuation ? -1 : 1;
      return left.time.localeCompare(right.time);
    });

    // Identity is the event id here: this list is one day of single events, so
    // there is no recurring occurrence to tell apart yet (DP-014 wires those).
    const conflicting = conflictingOccurrenceKeys(
      rows.map((row) => ({ key: row.event.id, event: row.event })),
    );
    return rows.map((row) => ({
      event: row.event,
      time: row.isContinuation ? `${CONTINUATION_LABEL} ${row.time}` : row.time,
      conflict: conflicting.has(row.event.id),
    }));
  }, [dateKey, displayTimezone, events]);

  const dayStickers = useMemo(
    () => stickers.filter((sticker) => sticker.date === dateKey),
    [dateKey, stickers],
  );

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

          <div className="cal-day-stickers">
            {dayStickers.map((sticker) => (
              // Tapping an existing sticker removes it, as in the原檔 — there
              // is no separate delete affordance.
              <button
                className="cal-day-sticker"
                key={sticker.id}
                type="button"
                aria-label={`移除貼圖 ${sticker.glyph ?? ''}`}
                onClick={() => onDeleteSticker(sticker.id)}
              >
                {sticker.glyph}
              </button>
            ))}
            <button
              className="cal-day-sticker-add"
              type="button"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((open) => !open)}
            >
              ＋ 貼圖
            </button>
          </div>

          {pickerOpen && (
            <div className="cal-day-sticker-pick" role="group" aria-label="選擇貼圖">
              {STICKER_GLYPHS.map((glyph) => (
                <button
                  className="cal-day-sticker-option"
                  key={glyph}
                  type="button"
                  aria-label={`加入貼圖 ${glyph}`}
                  onClick={() => {
                    onAddSticker({ date: dateKey, glyph });
                    // The原檔 closes the picker after one pick.
                    setPickerOpen(false);
                  }}
                >
                  {glyph}
                </button>
              ))}
            </div>
          )}

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
                style={{
                  background: row.conflict
                    ? '#e4002b'
                    : calendarColor(calendars, row.event.calendarId),
                }}
              />
              <span className="cal-day-time">{row.time}</span>
              <span className="cal-day-event-body">
                <span className="cal-day-event-title">{row.event.title}</span>
                {/* The原檔 puts the location on a second line under the title
                    whenever the event has one — its `e.hasLoc` branch. */}
                {row.event.location && (
                  <span className="cal-day-event-loc">{row.event.location}</span>
                )}
              </span>
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

