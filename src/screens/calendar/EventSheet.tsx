import { useState, type FormEvent } from 'react';
import { sortedCalendars } from '../../domain/calendars';
import { eventWallTime } from '../../domain/eventTime';
import type { Calendar, CalendarEvent } from '../../domain/types';
import { ViewportLayer } from '../../shell/ViewportLayer';
import type { EventPatch, NewEventInput, NewTodoInput } from '../../domain/mutations';

/** A parsed quick-add line waiting for the user to confirm it. */
export interface EventDraft {
  title: string;
  date: string;
  allDay: boolean;
  start: string;
  end: string;
  location: string;
}

export interface EventSheetProps {
  open: boolean;
  /** Day the calendar currently has selected; the default for a new entry. */
  defaultDate: string;
  /** Set to edit an existing event instead of creating one. */
  editing?: CalendarEvent | null;
  /** Pre-filled values from quick add; ignored while editing. */
  draft?: EventDraft | null;
  calendars: Calendar[];
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
 * Carries the原檔's fields that DayPop can actually store today: 標題, 日曆,
 * 全天, 日期, 開始／結束, 地點 and 備註.
 *
 * The rest stay listed but unbuilt on purpose, because storing them would
 * promise behaviour that does not exist yet: 重複 needs occurrence expansion
 * (DP-027), 提醒 needs a delivery mechanism (DP-042) or it is a reminder that
 * never fires, 時區 needs the DST work in DP-027, 附件 needs Storage (DP-028),
 * and 邀請對象 has no domain type at all yet.
 *
 * 待辦 is a mode here rather than its own screen because the原檔 adds todos
 * through the pet bubble, which is DP-040. Keeping it reachable avoids losing a
 * capability the app already had.
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
  draft,
  calendars,
  onClose,
  onAddEvent,
  onUpdateEvent,
  onDeleteEvent,
  onAddTodo,
}: Omit<EventSheetProps, 'open'>) {
  const editingWallTime = editing ? eventWallTime(editing) : null;
  // Editing always wins over a quick-add draft; they never apply together.
  const seed = editing ? null : draft;
  const options = sortedCalendars(calendars);
  const [mode, setMode] = useState<SheetMode>('event');
  const [title, setTitle] = useState(editing?.title ?? seed?.title ?? '');
  const [date, setDate] = useState(editingWallTime?.date ?? seed?.date ?? defaultDate);
  const [allDay, setAllDay] = useState(editing?.allDay ?? seed?.allDay ?? false);
  const [start, setStart] = useState(editingWallTime?.start || seed?.start || '09:00');
  const [end, setEnd] = useState(editingWallTime?.end || seed?.end || '10:00');
  const [location, setLocation] = useState(editing?.location ?? seed?.location ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [calendarId, setCalendarId] = useState(
    editing?.calendarId ??
      options.find((calendar) => calendar.isDefault)?.id ??
      options[0]?.id ??
      '',
  );

  // Escape is handled by `CalendarScreen` so that, when this sheet is stacked on
  // top of 日詳情, one keypress closes only the topmost sheet.

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    const times = { start: allDay ? '09:00' : start, end: allDay ? '10:00' : end };
    // Never send an empty id: `calendarId ?? default` would keep `''`, which is
    // not a UUID and would fail domain validation instead of falling back.
    const chosen = calendarId || undefined;
    if (editing) {
      onUpdateEvent(editing.id, {
        title,
        date,
        allDay,
        ...times,
        ...(chosen ? { calendarId: chosen } : {}),
        location,
        notes,
      });
    } else if (mode === 'event') {
      onAddEvent({ title, date, allDay, ...times, calendarId: chosen, location, notes });
    } else {
      onAddTodo({ title, date, calendarId: chosen });
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

            {options.length > 0 && (
              <>
                <div className="cal-field-label" style={{ marginTop: 11 }}>
                  日曆
                </div>
                <div className="cal-cal-chips" role="group" aria-label="日曆">
                  {options.map((calendar) => {
                    const active = calendar.id === calendarId;
                    return (
                      <button
                        key={calendar.id}
                        className="cal-cal-chip"
                        type="button"
                        aria-pressed={active}
                        onClick={() => setCalendarId(calendar.id)}
                        style={
                          active
                            ? {
                                borderColor: calendar.color,
                                background: calendar.color,
                                color: '#ffffff',
                              }
                            : { borderColor: 'var(--border)' }
                        }
                      >
                        <span
                          className="cal-cal-chip-dot"
                          style={{ background: active ? '#ffffff' : calendar.color }}
                        />
                        {calendar.name}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* The原檔 puts 全天 above 日期; 待辦 mode has no 全天 at all. */}
            {mode === 'event' && (
              <label className="cal-allday">
                全天
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(event) => setAllDay(event.target.checked)}
                />
              </label>
            )}

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

                <div className="cal-field" style={{ marginTop: 11 }}>
                  <div className="cal-field-label">地點</div>
                  <input
                    // Explicit, or the `.cal-field input[type="text"]` rule
                    // would not match — attribute selectors ignore the default.
                    type="text"
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                    placeholder="加入地點或會議連結"
                    aria-label="地點"
                  />
                </div>

                <div className="cal-field" style={{ marginTop: 11 }}>
                  <div className="cal-field-label">備註</div>
                  <textarea
                    className="cal-textarea"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="加入備註…"
                    rows={3}
                    aria-label="備註"
                  />
                </div>

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
                  <strong>原稿還有這些欄位，但接上會是空頭支票</strong>
                  重複與時區要等 DP-027 的 occurrence 展開與 DST 處理；提醒要等 DP-042
                  真的送得出通知，否則只是一個不會響的提醒；附件等 DP-028 的 Storage；
                  邀請對象目前連 domain 型別都還沒有。
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
