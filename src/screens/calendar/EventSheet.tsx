import { useEffect, useState, type FormEvent } from 'react';
import type { CalendarEvent } from '../../domain/types';
import { ViewportLayer } from '../../shell/ViewportLayer';
import type { EventPatch, NewEventInput, NewTodoInput } from '../../storage/localRepository';

export interface EventSheetProps {
  open: boolean;
  /** Day the calendar currently has selected; the default for a new entry. */
  defaultDate: string;
  /** Set to edit an existing event instead of creating one. */
  editing?: CalendarEvent | null;
  onClose(): void;
  onAddEvent(input: NewEventInput): void;
  onUpdateEvent(id: string, patch: EventPatch): void;
  onDeleteEvent(id: string): void;
  onAddTodo(input: NewTodoInput): void;
}

type SheetMode = 'event' | 'todo';

/**
 * The bottom sheet for creating and editing an event.
 *
 * The原檔's 新增／編輯事件 sheet also carries 日曆, 重複, 提醒, 地點, 時區,
 * 邀請對象 and 附件. Those need the Calendar, Recurrence and Reminder models
 * that DP-012 defines, so this sheet ships the原檔's chrome (backdrop, rounded
 * top, grip, fixed title bar, scrollable form) with only the fields today's
 * domain can actually store, and names the rest instead of pretending to save
 * them.
 *
 * 待辦 is a mode here rather than its own screen because the原檔 adds todos
 * through the pet bubble, which is DP-040. Keeping it reachable avoids losing a
 * capability the app already had; DP-014 moves it to its canonical home.
 */
export function EventSheet({ open, ...rest }: EventSheetProps) {
  // Mounting the form only while open means the draft resets itself on every
  // open, without an effect that writes state during render.
  if (!open) return null;
  return <EventSheetForm {...rest} />;
}

function EventSheetForm({
  defaultDate,
  editing,
  onClose,
  onAddEvent,
  onUpdateEvent,
  onDeleteEvent,
  onAddTodo,
}: Omit<EventSheetProps, 'open'>) {
  const [mode, setMode] = useState<SheetMode>('event');
  const [title, setTitle] = useState(editing?.title ?? '');
  const [date, setDate] = useState(editing?.date ?? defaultDate);
  const [allDay, setAllDay] = useState(editing?.allDay ?? false);
  const [start, setStart] = useState(editing?.start ?? '09:00');
  const [end, setEnd] = useState(editing?.end ?? '10:00');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    const times = { start: allDay ? '09:00' : start, end: allDay ? '10:00' : end };
    if (editing) {
      onUpdateEvent(editing.id, { title, date, allDay, ...times });
    } else if (mode === 'event') {
      onAddEvent({ title, date, allDay, ...times });
    } else {
      onAddTodo({ title, date });
    }
    onClose();
  }

  const heading = editing ? '編輯行程' : mode === 'event' ? '新增行程' : '新增待辦';

  return (
    <ViewportLayer>
      <div
        className="cal-sheet-backdrop"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <form className="cal-sheet" onSubmit={submit} role="dialog" aria-modal="true" aria-label={heading}>
          <div className="cal-sheet-grip" aria-hidden="true" />
          <div className="cal-sheet-bar">
            <button type="button" onClick={onClose}>
              取消
            </button>
            <strong>{heading}</strong>
            <button type="submit">儲存</button>
          </div>

          <div className="cal-sheet-body">
            {!editing && (
              <div className="cal-segmented" style={{ marginBottom: 12 }} role="group" aria-label="新增類型">
                <button type="button" aria-pressed={mode === 'event'} onClick={() => setMode('event')}>
                  行程
                </button>
                <button type="button" aria-pressed={mode === 'todo'} onClick={() => setMode('todo')}>
                  待辦
                </button>
              </div>
            )}

            <input
              className="cal-title-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="標題"
              aria-label="標題"
              autoFocus
            />

            <div className="cal-field" style={{ marginTop: 11 }}>
              <div className="cal-field-label">日期</div>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                aria-label="日期"
              />
            </div>

            {mode === 'event' && (
              <>
                <label className="cal-allday">
                  全天
                  <input
                    type="checkbox"
                    checked={allDay}
                    onChange={(event) => setAllDay(event.target.checked)}
                  />
                </label>

                {!allDay && (
                  <div className="cal-field-row" style={{ marginTop: 11 }}>
                    <div className="cal-field">
                      <div className="cal-field-label">開始</div>
                      <input
                        type="time"
                        value={start}
                        onChange={(event) => setStart(event.target.value)}
                        aria-label="開始"
                      />
                    </div>
                    <div className="cal-field">
                      <div className="cal-field-label">結束</div>
                      <input
                        type="time"
                        value={end}
                        onChange={(event) => setEnd(event.target.value)}
                        aria-label="結束"
                      />
                    </div>
                  </div>
                )}

                {editing && (
                  <button
                    className="cal-delete-button"
                    type="button"
                    onClick={() => {
                      onDeleteEvent(editing.id);
                      onClose();
                    }}
                  >
                    刪除事件
                  </button>
                )}

                <div className="cal-sheet-pending">
                  <strong>原稿還有這些欄位（DP-014）</strong>
                  日曆、重複、提醒、地點、時區、邀請對象與附件。它們需要 DP-012 的 Calendar
                  與 Recurrence 模型，現在填了也存不下來，所以先不放假的欄位。
                </div>
              </>
            )}

            {!editing && mode === 'todo' && (
              <div className="cal-sheet-pending">
                <strong>待辦之後會搬回原稿的位置</strong>
                原稿是從寵物對話泡泡新增待辦（DP-040），子項、排序與優先度則屬 DP-014。這裡先保留一個可用的入口，不讓現有能力消失。
              </div>
            )}
          </div>
        </form>
      </div>
    </ViewportLayer>
  );
}
