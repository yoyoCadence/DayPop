import { useState, type ChangeEvent, type FormEvent } from 'react';
import {
  EVENT_ATTACHMENT_MIME_TYPES,
  eventAttachmentFileIssue,
  formatAttachmentBytes,
} from '../../domain/attachments';
import { sortedCalendars } from '../../domain/calendars';
import { eventWallTime } from '../../domain/eventTime';
import {
  recurrencePresetForRule,
  recurrenceRuleForPreset,
  type RecurrencePreset,
} from '../../domain/recurrence';
import type { Calendar, CalendarEvent, EventAttachment } from '../../domain/types';
import { ViewportLayer } from '../../shell/ViewportLayer';
import type { EventPatch, NewEventInput, NewTodoInput } from '../../domain/mutations';

/**
 * What the原檔 names an event with no title, in `commitEvent()` and
 * `scopeApply()` alike — DP-076.
 *
 * Deliberately not exported: `EventSheet.test.tsx` asserts the literal
 * 新事件 instead. A test that imported this would re-derive its expectation
 * from the code under test and stay green if the string were ever changed,
 * which is the one thing it exists to catch.
 */
const DEFAULT_EVENT_TITLE = '新事件';

/** 原稿 :599 的六個選項，逐字照原順序。 */
const REPEAT_OPTIONS: { value: RecurrencePreset; label: string }[] = [
  { value: 'none', label: '不重複' },
  { value: 'daily', label: '每日' },
  { value: 'weekday', label: '每個工作日' },
  { value: 'weekly', label: '每週' },
  { value: 'monthly', label: '每月' },
  { value: 'yearly', label: '每年' },
];

/**
 * The select value standing for “this event's rule is not one of the six”.
 *
 * Not a repeat choice and never written anywhere: picking anything else
 * replaces the rule, and leaving this selected omits `recurrenceRule` from the
 * patch entirely, so `applyEventPatch()` keeps what is stored. See
 * `recurrencePresetForRule()` for why DayPop can hold such a rule at all.
 */
const CUSTOM_RULE_VALUE = 'custom';

/** A parsed quick-add line waiting for the user to confirm it. */
export interface EventDraft {
  title: string;
  date: string;
  allDay: boolean;
  start: string;
  end: string;
  location: string;
  repeat: RecurrencePreset;
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
  attachments: EventAttachment[];
  attachmentsAvailable: boolean;
  onClose(): void;
  onAddEvent(input: NewEventInput): void;
  onUpdateEvent(id: string, patch: EventPatch): void;
  onDeleteEvent(id: string): void;
  onAddTodo(input: NewTodoInput): void;
  onUploadAttachment(eventId: string, file: File): Promise<void>;
  onDeleteAttachment(id: string): Promise<void>;
  onOpenAttachment(id: string): Promise<string>;
}

type SheetMode = 'event' | 'todo';

/**
 * The bottom sheet for creating and editing an event.
 *
 * Carries the原檔's fields that DayPop can actually store today: 標題, 日曆,
 * 全天, 日期, 開始／結束, 地點 and 備註.
 *
 * DP-082 adds 重複 on top: the原檔's six presets, writing the RRULE that DP-027
 * already knew how to expand and DP-081 already draws in all four views.
 *
 * The rest stay listed but unbuilt on purpose. DP-027 completed recurrence,
 * exception, timezone and DST domain behaviour; the timezone control and the
 * single/all scope dialog remain canonical UI work. 提醒 needs a
 * delivery mechanism (DP-042) or it is a reminder that never fires, and
 * 邀請對象 has no domain type at all yet. DP-028 supplies real private
 * attachment upload/download/delete only after the event exists.
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
  attachments,
  attachmentsAvailable,
  onClose,
  onAddEvent,
  onUpdateEvent,
  onDeleteEvent,
  onAddTodo,
  onUploadAttachment,
  onDeleteAttachment,
  onOpenAttachment,
}: Omit<EventSheetProps, 'open'>) {
  const editingWallTime = editing ? eventWallTime(editing) : null;
  // Editing always wins over a quick-add draft; they never apply together.
  const seed = editing ? null : draft;
  const options = sortedCalendars(calendars);
  const [mode, setMode] = useState<SheetMode>('event');
  const [title, setTitle] = useState(editing?.title ?? seed?.title ?? '');
  const [date, setDate] = useState(editingWallTime?.date ?? seed?.date ?? defaultDate);
  const [allDay, setAllDay] = useState(editing?.allDay ?? seed?.allDay ?? false);
  /** Deleting a whole series asks once before it goes through — DP-081. */
  const [confirmSeriesDelete, setConfirmSeriesDelete] = useState(false);
  const [start, setStart] = useState(editingWallTime?.start || seed?.start || '09:00');
  const [end, setEnd] = useState(editingWallTime?.end || seed?.end || '10:00');
  const [location, setLocation] = useState(editing?.location ?? seed?.location ?? '');
  // `null` while editing an event whose stored rule is none of the six presets;
  // the select then shows CUSTOM_RULE_VALUE and the rule is left alone on save.
  const editingPreset = editing?.recurrence
    ? recurrencePresetForRule(editing.recurrence.rule, editing.allDay)
    : 'none';
  const [repeat, setRepeat] = useState<RecurrencePreset | null>(
    editing ? editingPreset : (seed?.repeat ?? 'none'),
  );
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [calendarId, setCalendarId] = useState(
    editing?.calendarId ??
      options.find((calendar) => calendar.isDefault)?.id ??
      options[0]?.id ??
      '',
  );
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentMessage, setAttachmentMessage] = useState<string | null>(null);

  async function uploadAttachment(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !editing) return;
    const issue = eventAttachmentFileIssue(file);
    if (issue) {
      setAttachmentMessage(issue);
      return;
    }
    setAttachmentBusy(true);
    setAttachmentMessage(null);
    try {
      await onUploadAttachment(editing.id, file);
      setAttachmentMessage('附件已安全保存。');
    } catch (cause) {
      setAttachmentMessage(cause instanceof Error ? cause.message : '附件上傳失敗。');
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function openAttachment(id: string) {
    setAttachmentBusy(true);
    setAttachmentMessage(null);
    try {
      const url = await onOpenAttachment(id);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.rel = 'noopener noreferrer';
      anchor.click();
    } catch (cause) {
      setAttachmentMessage(cause instanceof Error ? cause.message : '附件連結建立失敗。');
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function deleteAttachment(id: string) {
    setAttachmentBusy(true);
    setAttachmentMessage(null);
    try {
      await onDeleteAttachment(id);
      setAttachmentMessage('附件已刪除；雲端檔案清理若暫時失敗會在下次連線重試。');
    } catch (cause) {
      setAttachmentMessage(cause instanceof Error ? cause.message : '附件刪除失敗。');
    } finally {
      setAttachmentBusy(false);
    }
  }

  // Escape is handled by `CalendarScreen` so that, when this sheet is stacked on
  // top of 日詳情, one keypress closes only the topmost sheet.

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Events and todos diverge here, and both halves are the原檔's behaviour —
    // DP-076.
    //
    // An event never fails to save: `commitEvent()` and `scopeApply()` both
    // commit `title:(dr.title||'').trim()||'新事件'`, so an empty field becomes
    // a named event rather than a button that does nothing. DayPop had dropped
    // the fallback and kept a silent `return`, which is how "只給時間" quick
    // adds — `明天下午3點` parses a time and leaves no title — ended up opening
    // a sheet whose 儲存 was inert and unexplained.
    //
    // A todo with no title is still discarded, because `addTodo()` guards with
    // `if(!v) return;` and has no fallback of its own. Naming it 新事件 would
    // be wrong twice over: it is not an event, and the原檔 never invents a
    // title for a todo.
    const trimmed = title.trim();
    if (mode !== 'event' && !editing && !trimmed) return;
    const named = trimmed || DEFAULT_EVENT_TITLE;
    const times = { start: allDay ? '09:00' : start, end: allDay ? '10:00' : end };
    // Never send an empty id: `calendarId ?? default` would keep `''`, which is
    // not a UUID and would fail domain validation instead of falling back.
    const chosen = calendarId || undefined;
    // Omitting the field is what keeps a non-preset rule: `applyEventPatch()`
    // reads `undefined` as “leave the recurrence alone”, and only `null` clears
    // it. `NewEventInput` never needs the custom branch — a new event has no
    // rule to preserve.
    const recurrence =
      repeat === null ? {} : { recurrenceRule: recurrenceRuleForPreset(repeat) };
    if (editing) {
      onUpdateEvent(editing.id, {
        title: named,
        date,
        allDay,
        ...times,
        ...(chosen ? { calendarId: chosen } : {}),
        location,
        notes,
        ...recurrence,
      });
    } else if (mode === 'event') {
      onAddEvent({
        title: named,
        date,
        allDay,
        ...times,
        calendarId: chosen,
        location,
        notes,
        recurrenceRule: repeat === null ? null : recurrenceRuleForPreset(repeat),
      });
    } else {
      onAddTodo({ title: trimmed, date, calendarId: chosen });
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

            {/* The原檔 puts 全天 above 日期; 待辦 mode has no 全天 at all.
                原稿 :586 用的是 44×25 開關，不是 checkbox。 */}
            {mode === 'event' && (
              <div className="cal-allday">
                <span className="cal-allday-label" id="event-allday-label">
                  全天
                </span>
                <button
                  className="cal-allday-toggle"
                  type="button"
                  aria-pressed={allDay}
                  aria-labelledby="event-allday-label"
                  onClick={() => setAllDay(!allDay)}
                >
                  <span className="cal-allday-knob" aria-hidden="true" />
                </button>
              </div>
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

                {/* 原稿 :598 把 重複 與 提醒 並排成兩欄。提醒 要等 DP-042 才送得出
                    通知，所以這裡先只放 重複；DP-042 接回時它會補回右半欄。 */}
                <div className="cal-field" style={{ marginTop: 11 }}>
                  <div className="cal-field-label">重複</div>
                  <select
                    value={repeat ?? CUSTOM_RULE_VALUE}
                    onChange={(event) =>
                      setRepeat(
                        event.target.value === CUSTOM_RULE_VALUE
                          ? null
                          : (event.target.value as RecurrencePreset),
                      )
                    }
                    aria-label="重複"
                  >
                    {REPEAT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                    {editingPreset === null && (
                      <option value={CUSTOM_RULE_VALUE}>自訂規則（維持原樣）</option>
                    )}
                  </select>
                  {editingPreset === null && (
                    <small className="cal-field-note">
                      {repeat === null
                        ? `這個行程的重複規則（${editing?.recurrence?.rule}）不是上面六個選項，維持原樣不會被動到。`
                        : '改成上面的選項後，原本的自訂重複規則會被取代。'}
                    </small>
                  )}
                </div>

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

                <section className="cal-attachments" aria-label="附件">
                  <div className="cal-field-label">附件</div>
                  {!editing ? (
                    <p>先儲存行程，再回來加入附件。</p>
                  ) : !attachmentsAvailable ? (
                    <p>登入帳號後，附件才會保存到私人雲端空間。</p>
                  ) : (
                    <>
                      <label className="cal-attachment-picker" aria-disabled={attachmentBusy}>
                        {attachmentBusy ? '處理中…' : '選擇附件'}
                        <input
                          type="file"
                          accept={EVENT_ATTACHMENT_MIME_TYPES.join(',')}
                          disabled={attachmentBusy}
                          onChange={uploadAttachment}
                        />
                      </label>
                      <small>單檔上限 10 MiB；支援圖片、PDF、純文字與 iCalendar。</small>
                    </>
                  )}

                  {attachments.length > 0 && (
                    <ul className="cal-attachment-list">
                      {attachments.map((attachment) => (
                        <li key={attachment.id}>
                          <span>
                            <strong>{attachment.fileName}</strong>
                            <small>{formatAttachmentBytes(attachment.sizeBytes)}</small>
                          </span>
                          <button
                            type="button"
                            disabled={attachmentBusy || !attachmentsAvailable}
                            onClick={() => void openAttachment(attachment.id)}
                          >
                            下載
                          </button>
                          <button
                            type="button"
                            disabled={attachmentBusy || !attachmentsAvailable}
                            onClick={() => void deleteAttachment(attachment.id)}
                          >
                            刪除
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {attachmentMessage && <p role="status">{attachmentMessage}</p>}
                </section>

                {/*
                  DP-081 draws every occurrence of a series, but this sheet still
                  edits the base event, so every change here applies to the whole
                  series. Saying so is the DP-081 half of the promise; the
                  單次／全部 choice that makes it selectable is DP-082.
                */}
                {editing?.recurrence !== null && editing !== null && (
                  <p className="cal-series-notice" role="note">
                    <strong>這是重複事件</strong>
                    在這裡的修改與刪除都會套用到<strong>整個系列</strong>，不只你點開的那一次。
                    只改其中一次的選項還沒有做好（DP-082）。
                  </p>
                )}

                {editing && (
                  <button
                    className="cal-delete-button"
                    type="button"
                    // A recurring delete removes every occurrence, so it asks
                    // first. A single event keeps the原檔's one-tap delete.
                    onClick={() => {
                      if (editing.recurrence !== null && !confirmSeriesDelete) {
                        setConfirmSeriesDelete(true);
                        return;
                      }
                      onDeleteEvent(editing.id);
                      onClose();
                    }}
                  >
                    {editing.recurrence === null
                      ? '刪除事件'
                      : confirmSeriesDelete
                        ? '確定刪除整個系列？再按一次'
                        : '刪除整個系列'}
                  </button>
                )}

                <div className="cal-sheet-pending">
                  <strong>原稿還有這些欄位，但接上會是空頭支票</strong>
                  單次／全部範圍（DP-082 剩下的一半）與時區的底層行為已由 DP-027 完成，
                  控制項仍待依原稿接回；提醒要等 DP-042 真的送得出通知，否則只是一個不會響的提醒；
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
