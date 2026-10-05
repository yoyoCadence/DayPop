import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { isTitleTooLong, MAX_TITLE_INPUT_LENGTH, TITLE_LENGTH_MESSAGE } from '../../domain/titles';
import {
  EVENT_ATTACHMENT_MIME_TYPES,
  eventAttachmentFileIssue,
  formatAttachmentBytes,
} from '../../domain/attachments';
import { sortedCalendars } from '../../domain/calendars';
import { addDays, daysBetween, fromDateKey, toDateKey } from '../../domain/date';
import { eventWallTime } from '../../domain/eventTime';
import { allDayDateIssue, dateKeyDaysBetween, shiftDateKey } from '../../domain/allDayDates';
import {
  recurrencePresetForRule,
  recurrenceRuleForPreset,
  type RecurrencePreset,
} from '../../domain/recurrence';
import type {
  Calendar,
  CalendarEvent,
  EventAttachment,
  EventOccurrence,
} from '../../domain/types';
import { ViewportLayer } from '../../shell/ViewportLayer';
import { eventTimezoneOptions } from '../timezoneOptions';
import { ScopeDialog, type ScopeMode } from './ScopeDialog';
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
  /** Canonical preferences timezone, used only when no timed event is edited. */
  defaultTimezone: string;
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
  /**
   * Which occurrence was tapped, when one was — DP-082.
   *
   * Null when the sheet was opened without pointing at a drawn occurrence (the
   * FAB, or arriving from 搜尋／綜覽). The range dialog then has nothing to
   * scope 只改這一次 to, so a recurring edit stays a whole-series edit.
   */
  occurrence?: EventOccurrence | null;
  /** The series row an occurrence-scoped write targets — DP-082. */
  seriesEventId?: string | null;
  /**
   * The series row's own wall date — DP-082 review fix.
   *
   * 套用全部 needs it so the patch can shift the anchor rather than replace it
   * with the tapped occurrence's date. See `seriesPatch()`.
   */
  seriesDate?: string | null;
  onCancelOccurrence(eventId: string, occurrence: EventOccurrence): void;
  onReplaceOccurrence(
    eventId: string,
    occurrence: EventOccurrence,
    patch: EventPatch,
  ): void;
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
 * 全天, 日期, 開始／結束, 地點, 時區 and 備註.
 *
 * DP-082 adds 重複 on top: the原檔's six presets, writing the RRULE that DP-027
 * already knew how to expand and DP-081 already draws in all four views.
 *
 * DP-082 also brings the原檔's 單次／全部 range dialog: editing or deleting a
 * recurring event asks which occurrences it is for, instead of silently
 * rewriting the whole series.
 *
 * DP-111 connects the timezone control to DP-027's existing domain behaviour.
 * The rest stay listed but unbuilt on purpose. 提醒 needs a
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
  defaultTimezone,
  editing,
  draft,
  calendars,
  attachments,
  attachmentsAvailable,
  onClose,
  onAddEvent,
  onUpdateEvent,
  onDeleteEvent,
  occurrence = null,
  seriesEventId = null,
  seriesDate = null,
  onCancelOccurrence,
  onReplaceOccurrence,
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
  const [endDate, setEndDate] = useState(editing?.allDay ? editing.endDate : seed?.date ?? editingWallTime?.date ?? defaultDate);
  const [allDay, setAllDay] = useState(editing?.allDay ?? seed?.allDay ?? false);
  const [scopeDateError, setScopeDateError] = useState<string | null>(null);
  const dateIssue = mode === 'event' && allDay ? allDayDateIssue(date, endDate) ?? scopeDateError : null;

  function changeDate(next: string) {
    setScopeDateError(null);
    // A valid start-date move carries the whole all-day span. Invalid drafts
    // stay visible and are never silently shortened or committed.
    if (!allDayDateIssue(date, endDate)) {
      setEndDate(shiftDateKey(next, dateKeyDaysBetween(date, endDate)) ?? '');
    }
    setDate(next);
  }
  /**
   * The原檔's `scopeAsk` — which question the range dialog is asking, or null
   * when it is closed (DP-082).
   */
  const [scopeMode, setScopeMode] = useState<ScopeMode | null>(null);
  /** Held while the dialog is open, so 套用全部／只改這一次 commit the same edit. */
  const [pendingPatch, setPendingPatch] = useState<EventPatch | null>(null);
  const [start, setStart] = useState(editingWallTime?.start || seed?.start || '09:00');
  const [end, setEnd] = useState(editingWallTime?.end || seed?.end || '10:00');
  const initialTimezone = editing && !editing.allDay ? editing.timezone : defaultTimezone;
  const originalStartsAt = editing && !editing.allDay ? editing.startsAt : undefined;
  const [timezone, setTimezone] = useState(initialTimezone);
  const timezoneOptionsForDraft = useMemo(
    () => eventTimezoneOptions(initialTimezone, date, start, originalStartsAt),
    [initialTimezone, date, start, originalStartsAt],
  );
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
  /** The date the form was seeded with, i.e. the tapped occurrence's own day. */
  const occurrenceDate = editingWallTime?.date ?? null;
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentMessage, setAttachmentMessage] = useState<string | null>(null);

  /**
   * True when saving or deleting has to ask 單次還是全部 — DP-082.
   *
   * All three conditions are needed. `editing.recurrence` is what the原檔
   * tests (`base.repeat && base.repeat!=='none'`). The other two are DayPop's:
   * an occurrence-scoped write needs the occurrence that was tapped and the
   * series id to write the exception against, and without either there is no
   * 這一次 to offer. A replacement row is already detached — its `recurrence`
   * is null — so opening one edits it directly, as in the原檔.
   */
  const seriesScope =
    editing != null &&
    editing.recurrence !== null &&
    occurrence !== null &&
    seriesEventId !== null;

  /**
   * Re-aims a patch built from one occurrence at the series itself — DP-082
   * review fix.
   *
   * The form is seeded from the occurrence that was tapped, which is what makes
   * 只改這一次 correct. 套用全部 sends the same patch to the *base* row, and
   * `date` there means the series anchor — so a patch carrying the occurrence's
   * own date moved the whole series onto it. Opening 8/31 of a daily series
   * that starts 8/29 and pressing 儲存 → 套用全部 without editing anything
   * re-anchored it to 8/31 and destroyed the 8/29 and 8/30 occurrences.
   *
   * The date is therefore translated, not copied: the series moves by however
   * far the user moved *this* occurrence. An untouched date is a zero shift, so
   * the anchor stays put; dragging Tuesday's occurrence to Wednesday and
   * choosing 套用全部 moves the whole series to Wednesdays, which is what a
   * weekly rule anchored on DTSTART's weekday should do.
   *
   * Times need no such treatment: every occurrence of a series shares one wall
   * clock, so `start`/`end` are already the series' own values.
   */
  function seriesPatch(patch: EventPatch): EventPatch {
    if (!seriesDate || !occurrenceDate || patch.date === undefined) return patch;
    if (patch.allDay) {
      const anchor = shiftDateKey(seriesDate, dateKeyDaysBetween(occurrenceDate, patch.date));
      return {
        ...patch,
        date: anchor ?? '',
        ...(patch.endDate === undefined ? {} : {
          endDate: anchor ? shiftDateKey(anchor, dateKeyDaysBetween(patch.date, patch.endDate)) ?? '' : '',
        }),
      };
    }
    const shift = daysBetween(fromDateKey(occurrenceDate), fromDateKey(patch.date));
    return { ...patch, date: toDateKey(addDays(fromDateKey(seriesDate), shift)) };
  }

  function applyScope(kind: 'this' | 'all') {
    const mode = scopeMode;
    setScopeMode(null);
    if (!editing || !occurrence || !seriesEventId) return;
    if (mode === 'delete') {
      if (kind === 'all') onDeleteEvent(seriesEventId);
      else onCancelOccurrence(seriesEventId, occurrence);
    } else {
      if (!pendingPatch) return;
      const patch = kind === 'all' ? seriesPatch(pendingPatch) : pendingPatch;
      if (patch.allDay && allDayDateIssue(patch.date ?? '', patch.endDate ?? '')) {
        setScopeDateError('套用全部後的日期超出可保存範圍，請調整日期。');
        setPendingPatch(null);
        return;
      }
      if (kind === 'all') onUpdateEvent(seriesEventId, patch);
      else onReplaceOccurrence(seriesEventId, occurrence, pendingPatch);
    }
    setPendingPatch(null);
    onClose();
  }

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
    if (dateIssue) return;
    if (isTitleTooLong(trimmed)) return;
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
      const patch: EventPatch = {
        title: named,
        date,
        allDay,
        ...(allDay ? { endDate } : {}),
        ...times,
        ...(chosen ? { calendarId: chosen } : {}),
        location,
        notes,
        ...(!allDay && (editing.allDay || editing.timezone !== timezone) ? { timezone } : {}),
        ...recurrence,
      };
      // The原檔's `saveEvent()` (`:912`): a repeating event asks which
      // occurrences the change is for instead of committing straight away.
      if (seriesScope) {
        setPendingPatch(patch);
        setScopeMode('save');
        return;
      }
      onUpdateEvent(editing.id, patch);
    } else if (mode === 'event') {
      onAddEvent({
        title: named,
        date,
        allDay,
        ...(allDay ? { endDate } : {}),
        ...times,
        calendarId: chosen,
        location,
        notes,
        recurrenceRule: repeat === null ? null : recurrenceRuleForPreset(repeat),
        ...(!allDay ? { timezone } : {}),
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
            <button type="submit" disabled={isTitleTooLong(title) || dateIssue !== null}>儲存</button>
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
              maxLength={MAX_TITLE_INPUT_LENGTH}
              aria-invalid={isTitleTooLong(title)}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="標題"
              aria-label="標題"
              autoFocus
            />
            {isTitleTooLong(title) && <div className="cal-day-title-error" role="alert">{TITLE_LENGTH_MESSAGE}</div>}

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
                  onClick={() => { setScopeDateError(null); setAllDay(!allDay); }}
                >
                  <span className="cal-allday-knob" aria-hidden="true" />
                </button>
              </div>
            )}

            <div className="cal-field" style={{ marginTop: 11 }}>
              <div className="cal-field-label">{mode === 'event' && allDay ? '開始日期' : '日期'}</div>
              <input
                type="date"
                value={date}
                onChange={(event) => changeDate(event.target.value)}
                aria-label="日期"
                aria-invalid={dateIssue !== null}
              />
            </div>

            {mode === 'event' && allDay && (
              <div className="cal-field" style={{ marginTop: 11 }}>
                <div className="cal-field-label">結束日期</div>
                <input type="date" aria-label="結束日期" value={endDate} min={date} max="9999-12-31"
                  aria-invalid={dateIssue !== null} onChange={(event) => { setScopeDateError(null); setEndDate(event.target.value); }} />
                <small className="cal-field-note">包含結束當天；修改開始日期會一起移動整段行程。</small>
                {dateIssue && <div className="cal-day-title-error" role="alert">{dateIssue}</div>}
              </div>
            )}

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

                {!allDay && (
                  <div className="cal-field" style={{ marginTop: 11 }}>
                    <div className="cal-field-label">時區</div>
                    <select value={timezone} onChange={(event) => setTimezone(event.target.value)} aria-label="時區">
                      {/* Retain a saved non-menu zone even after picking another,
                          so the user can undo the choice before saving. */}
                      {timezoneOptionsForDraft.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <small className="cal-field-note">更換時區會保留日期與時間，並改變實際開始時刻。</small>
                  </div>
                )}

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

                {editing && (
                  <button
                    className="cal-delete-button"
                    type="button"
                    // 原稿 `:913`: a repeating event asks which occurrences to
                    // delete; a single event keeps the原檔's one-tap delete.
                    onClick={() => {
                      if (seriesScope) {
                        setScopeMode('delete');
                        return;
                      }
                      onDeleteEvent(editing.id);
                      onClose();
                    }}
                  >
                    刪除事件
                  </button>
                )}

                <div className="cal-sheet-pending">
                  <strong>原稿還有這些欄位，但接上會是空頭支票</strong>
                  提醒要等 DP-042 真的送得出通知，否則只是一個不會響的提醒；
                  邀請對象目前連 domain 型別都還沒有。
                </div>
              </>
            )}

            {!editing && mode === 'todo' && (
              <div className="cal-sheet-pending">
                <strong>待辦之後會搬回原稿的位置</strong>
                原稿是從寵物對話泡泡新增待辦（DP-040）；子項與優先度可在日詳情操作，排序仍待 DP-014。這裡先保留一個可用的入口，不讓現有能力消失。
              </div>
            )}
          </div>
        </form>
      </div>
      {/* 原稿 :430 puts this at z-index 92, above the sheet it was opened from. */}
      <ScopeDialog
        mode={scopeMode}
        onThis={() => applyScope('this')}
        onAll={() => applyScope('all')}
        onCancel={() => {
          setScopeMode(null);
          setPendingPatch(null);
        }}
      />
    </ViewportLayer>
  );
}
