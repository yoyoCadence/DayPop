import { useMemo, useRef, useState, type FormEvent } from 'react';
import { fromDateKey } from '../../domain/date';
import {
  allDayDisplaySegments,
  conflictingOccurrenceKeys,
  eventDisplaySegments,
  segmentTimeRange,
} from '../../domain/displaySegments';
import { todoGroupsOn } from '../../domain/todos';
import { isTitleTooLong, MAX_TITLE_INPUT_LENGTH, TITLE_LENGTH_MESSAGE } from '../../domain/titles';
import { DayTodoCard } from './DayTodoCard';
import { useConfirmedTodoAdd } from './useConfirmedTodoAdd';

/** Marks the second and later days of a cross-midnight event — DP-064. */
const CONTINUATION_LABEL = '續';
import { calendarColor } from '../../domain/calendars';
import { STICKER_GLYPHS } from '../../domain/stickerGlyphs';
import type { OccurrenceWindow, ResolvedEventOccurrence } from '../../domain/recurrence';
import type { Calendar, CalendarEvent, Sticker, TodoItem, TodoPriority } from '../../domain/types';
import { ViewportLayer } from '../../shell/ViewportLayer';
import type { NewStickerInput, NewTodoInput } from '../../domain/mutations';
import { occurrenceTarget, type OccurrenceTarget } from './occurrenceTarget';

const WEEKDAY_NAMES = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

export interface DayDetailSheetProps {
  /** `YYYY-MM-DD`, or null when the sheet is closed. */
  dateKey: string | null;
  /**
   * Expands the visible calendars into occurrences for one window — DP-081.
   * This sheet asks for the single day it shows.
   */
  resolveOccurrences(window: OccurrenceWindow): ResolvedEventOccurrence[];
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
  onOpenEvent(target: OccurrenceTarget): void;
  onNewEvent(): void;
  /** A synchronous callback has already confirmed; production awaits the queue (DP-137). */
  onAddTodo(input: NewTodoInput): Promise<void> | void;
  onToggleTodo(id: string): void;
  onDeleteTodo(id: string): void;
  onRenameTodo(id: string, title: string): Promise<void>;
  onSetTodoPriority(id: string, priority: TodoPriority): Promise<void>;
  onRescheduleTodo(id: string, date: string): Promise<void>;
  onAddSticker(input: NewStickerInput): void;
  onDeleteSticker(id: string): void;
}

/**
 * 日詳情 sheet, ported from the `dayOpen` block of
 * `日曆桌寵 Calendar Pet.dc.html`. Opened by tapping a month cell.
 *
 * DP-116 connects the original subtask cards; DP-128/130 add priority/date.
 * Drag ordering remains DP-014.
 */
export function DayDetailSheet({ dateKey, ...rest }: DayDetailSheetProps) {
  if (!dateKey) return null;
  // Keyed by date so the picker closes when another day is opened, matching
  // the原檔's `openDay()`, which resets `stickerPick`.
  return <DayDetailSheetBody key={dateKey} dateKey={dateKey} {...rest} />;
}

function DayDetailSheetBody({
  dateKey,
  resolveOccurrences,
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
  onRenameTodo,
  onSetTodoPriority,
  onRescheduleTodo,
  onAddSticker,
  onDeleteSticker,
}: DayDetailSheetProps & { dateKey: string }) {
  const todoAdd = useConfirmedTodoAdd();
  const { draft: todoDraft, setDraft: setTodoDraft } = todoAdd;
  const [pickerOpen, setPickerOpen] = useState(false);
  const done = useRef<HTMLButtonElement>(null);
  const pendingDate = useRef(false);
  const [datePending, setDatePending] = useState(false);

  async function rescheduleTodo(id: string, nextDate: string) {
    // Moving a parent re-groups its children. Keep a pending child editor from
    // being re-mounted by another date write; other mutations keep their queue.
    if (pendingDate.current) throw new Error('請等待目前的日期保存完成。');
    pendingDate.current = true;
    setDatePending(true);
    try {
      await onRescheduleTodo(id, nextDate);
    } finally {
      pendingDate.current = false;
      setDatePending(false);
    }
  }

  // Escape is handled by `CalendarScreen`, not here: the event sheet can be open
  // on top of this one, and two window listeners would close both at once.
  const date = fromDateKey(dateKey);
  const dayLabel = `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAY_NAMES[date.getDay()]}`;

  const dayEvents = useMemo(() => {
    // Display segments, not just the starting day — DP-064. The month cell for
    // the second day of an overnight event says 「續」; opening it used to show
    // 「這天沒有行程」.
    const window = { startDateKey: dateKey, endDateKey: dateKey };
    const rows: {
      event: CalendarEvent;
      /** Which drawn occurrence this row is — DP-082. */
      target: OccurrenceTarget;
      key: string;
      time: string;
      isContinuation: boolean;
    }[] = [];
    // One day is the whole window — DP-081.
    const occurrences = resolveOccurrences({ startDate: dateKey, endDate: dateKey });

    for (const resolved of occurrences) {
      const { key: occurrenceKey, event } = resolved;
      const target = occurrenceTarget(resolved);
      if (event.allDay) {
        for (const segment of allDayDisplaySegments(event, window)) {
          rows.push({ event, target, key: occurrenceKey, time: '全天', isContinuation: segment.isContinuation });
        }
        continue;
      }
      for (const segment of eventDisplaySegments(event, occurrenceKey, displayTimezone, window)) {
        rows.push({
          event,
          target,
          key: segment.key,
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

    // Identity is the occurrence key — DP-081. Two occurrences of one series on
    // the same day are separate rows and can genuinely conflict with each other;
    // the two halves of one cross-midnight occurrence share a key and cannot.
    const conflicting = conflictingOccurrenceKeys(
      rows.map((row) => ({ key: row.key, event: row.event })),
    );
    return rows.map((row) => ({
      event: row.event,
      target: row.target,
      key: row.key,
      time: row.isContinuation ? `${CONTINUATION_LABEL} ${row.time}` : row.time,
      conflict: conflicting.has(row.key),
    }));
  }, [dateKey, displayTimezone, resolveOccurrences]);

  const dayStickers = useMemo(
    () => stickers.filter((sticker) => sticker.date === dateKey),
    [dateKey, stickers],
  );

  const dayTodos = useMemo(
    () => todoGroupsOn(todos, dateKey),
    [dateKey, todos],
  );

  function submitTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!todoDraft.trim() || isTitleTooLong(todoDraft)) return;
    // Cleared only once the add is confirmed; a failure keeps the text (DP-137).
    void todoAdd.submit(() => onAddTodo({ title: todoDraft, date: dateKey }));
  }

  return (
    <ViewportLayer>
      <div className="cal-day-layer">
        <div className="cal-day-backdrop" onClick={onClose} />
        <div className="cal-day-sheet" role="dialog" aria-modal="true" aria-label={dayLabel}>
          <div className="cal-day-grip" aria-hidden="true" />
          <div className="cal-day-head">
            <div className="cal-day-title">{dayLabel}</div>
            <button ref={done} className="cal-day-done" type="button" onClick={onClose}>
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
              key={row.key}
              type="button"
              onClick={() => onOpenEvent(row.target)}
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
            <DayTodoCard key={row.todo.id} {...row} dateKey={dateKey} todayKey={todayKey} onAddTodo={onAddTodo} onToggleTodo={onToggleTodo} onDeleteTodo={onDeleteTodo} onRenameTodo={onRenameTodo} onSetTodoPriority={onSetTodoPriority} onRescheduleTodo={rescheduleTodo} onDateSaved={() => done.current?.focus()} datePending={datePending} />
          ))}

          <form className="cal-day-todo-add" onSubmit={submitTodo} aria-busy={todoAdd.saving}>
            <input
              value={todoDraft}
              // Not `disabled`: that would drop focus and the phone keyboard
              // between consecutive todos.
              readOnly={todoAdd.saving}
              maxLength={MAX_TITLE_INPUT_LENGTH}
              aria-invalid={isTitleTooLong(todoDraft)}
              onChange={(event) => setTodoDraft(event.target.value)}
              placeholder="新增清單項目…"
              aria-label="新增清單項目"
            />
            <button type="submit" disabled={isTitleTooLong(todoDraft)} aria-label="新增待辦">
              ＋
            </button>
          </form>

          {isTitleTooLong(todoDraft) && <div className="cal-day-title-error" role="alert">{TITLE_LENGTH_MESSAGE}</div>}
          {todoAdd.error && !isTitleTooLong(todoDraft) && <div className="cal-day-title-error" role="alert">{todoAdd.error}</div>}

          <div className="cal-day-pending">
            <span className="dp-note-task">DP-014</span>
            拖曳排序欄位已可保存，後續依原稿補上操作介面。
          </div>
        </div>
      </div>
    </ViewportLayer>
  );
}

