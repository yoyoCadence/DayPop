import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/authContext';
import type { Calendar } from '../domain/types';
import { MAX_REMINDER_COUNT, MAX_REMINDER_MINUTES } from '../domain/validation';
import type { AppUpdateState } from '../pwa/useAppUpdate';
import { timezoneOptions } from '../screens/timezoneOptions';
import { useModalFocus } from '../shell/useModalFocus';
import { ViewportLayer } from '../shell/ViewportLayer';
import { BrowserReminderError } from './browserPush';
import { DeviceRecordsError } from './deviceRecords';
import { useReminders, type ReminderContextValue } from './reminderContext';
import { ReminderError, type ReminderRule } from './reminderService';
import './reminderSettings.css';

const describe = (cause: unknown) => cause instanceof ReminderError || cause instanceof BrowserReminderError || cause instanceof DeviceRecordsError
  ? cause.message : '尚無法完成提醒設定，請確認連線後再試。';

/** Original notification row and settings card geometry, with explicit calendar-level rules from ADR §10. */
export function ReminderSettings({ calendars, timezone, onOpenAuth, updater }: {
  calendars: readonly Calendar[]; timezone: string; onOpenAuth(): void; updater: AppUpdateState;
}) {
  const reminders = useReminders(), auth = useAuth();
  const [editing, setEditing] = useState<{ userId: string; calendar: Calendar } | null>(null), [actionError, setActionError] = useState<string | null>(null);
  const view = reminders?.view, confirmed = Boolean(auth.user && !auth.initializing && !auth.sessionUnconfirmed);
  const busy = view?.phase === 'busy' || view?.phase === 'loading' || Boolean(reminders?.savingRule);
  const subscribed = view?.phase === 'active' || (view?.phase === 'unavailable' && Boolean(view.deviceId));
  const rules = view?.snapshot?.rules ?? [];
  const status = !auth.user ? '登入後可在這台裝置開啟背景提醒。' : !confirmed ? '請先連上網路確認登入狀態。' :
    !view ? '尚無法確認提醒服務，請重新整理後再試。' : view.error ??
      (view.phase === 'active' ? rules.length ? '這台裝置已開啟提醒。' : '這台裝置已開啟通知，請選擇下方日曆。' : busy ? '正在確認提醒狀態…' : '這台裝置尚未開啟提醒。');
  const ruleAvailable = confirmed && Boolean(view?.snapshot) && !busy;
  // This function stays synchronous up to enable(), preserving the native permission gesture.
  function toggle() {
    setActionError(null);
    const task = subscribed ? reminders!.disable() : reminders!.enable();
    void task.catch(cause => setActionError(describe(cause)));
  }
  return <>
    <div className="dp-section-label">提醒</div>
    <section className="set-pref-rows reminder-settings" aria-label="通知提醒">
      <div className="set-pref-row">
        <span className="set-pref-row-label" id="reminder-device-label">這台裝置的通知</span>
        <button className="set-pref-toggle" type="button" aria-pressed={Boolean(subscribed)} aria-labelledby="reminder-device-label"
          disabled={!confirmed || !reminders || busy || (!subscribed && !view?.canEnable)} onClick={toggle}>
          <span className="set-pref-knob" aria-hidden="true" />
        </button>
      </div>
      <div className="reminder-settings-detail">
        <p className="set-pref-help" role="status">{status}</p>
        {view?.pendingCount ? <p className="set-pref-help">有 {view.pendingCount} 筆裝置操作待確認；請保留連線，必要時重新登入原帳號確認停用。</p> : null}
        <p className="set-pref-help">逐本日曆選擇要提醒的事項。通知不顯示行程內容，關閉 App 後由背景服務排程；可能因網路或系統設定而延遲。</p>
        {!auth.user ? <button className="button secondary" type="button" onClick={onOpenAuth} disabled={Boolean(auth.configurationError)}>登入後設定提醒</button> :
          <div className="reminder-actions">
            <button className="button secondary" type="button" disabled={!reminders || busy || !confirmed} onClick={() => { setActionError(null); void reminders!.refresh().catch(cause => setActionError(describe(cause))); }}>重新確認提醒</button>
            {view && (view.pendingCount > 0 || view.phase === 'unconfirmed') ? <button className="button secondary" type="button" disabled={busy || !reminders} onClick={() => { setActionError(null); void reminders!.disable().catch(cause => setActionError(describe(cause))); }}>停用這台裝置並確認</button> : null}
            {view?.error?.includes('完成 App 更新') ? <button className="button secondary" type="button" disabled={updater.preparing} onClick={() => void updater.updateNow()}>完成 App 更新</button> : null}
          </div>}
        {actionError ? <p className="auth-action-error" role="alert">{actionError}</p> : null}
        {updater.updateError && view?.error?.includes('完成 App 更新') ? <p className="auth-action-error" role="alert">{updater.updateError}</p> : null}
      </div>
      {confirmed ? <div className="reminder-calendar-list" aria-label="日曆提醒設定">
        {calendars.map(calendar => {
          const rule = rules.find(row => row.calendarId === calendar.id);
          return <button className="reminder-calendar-row" type="button" key={calendar.id} disabled={!ruleAvailable || (!rule && !view?.snapshot?.capabilities.enabled)} onClick={event => { event.currentTarget.focus(); setEditing({ userId: auth.user!.id, calendar }); }}>
            <span>{calendar.name}</span><span>{rule ? `${rule.minutesBefore.join('、')} 分鐘前` : '未開啟'} ›</span>
          </button>;
        })}
        <p className="set-pref-help reminder-rule-note">設定套用此日曆中可讀的既有及未來事項。分享不會替你開啟通知；舊的逐筆提醒與預設提醒不會自動套用。</p>
      </div> : null}
    </section>
    {editing && editing.userId === auth.user?.id && calendars.some(row => row.id === editing.calendar.id) && reminders && confirmed ? <ReminderRuleDialog key={editing.userId + ':' + editing.calendar.id} calendar={editing.calendar} timezone={timezone}
      rule={rules.find(row => row.calendarId === editing.calendar.id) ?? null} reminders={reminders} onClose={() => setEditing(null)} /> : null}
  </>;
}

function ReminderRuleDialog({ calendar, timezone, rule, reminders, onClose }: {
  calendar: Calendar; timezone: string; rule: ReminderRule | null; reminders: ReminderContextValue; onClose(): void;
}) {
  const [enabled, setEnabled] = useState(Boolean(rule)), [minutes, setMinutes] = useState(rule?.minutesBefore.join(', ') ?? '10');
  const [dateTime, setDateTime] = useState(rule?.dateTime ?? '09:00'), [zone, setZone] = useState(rule?.timezone ?? timezone);
  const [todos, setTodos] = useState(rule?.includeTodos ?? false), [expected, setExpected] = useState(rule?.updatedAt ?? null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const pending = useRef(false), mounted = useRef(true), layer = useRef<HTMLDivElement>(null);
  useModalFocus(layer, { onEscape: () => { if (!pending.current) onClose(); } });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const canEnableRule = reminders.view.snapshot?.capabilities.enabled === true;
  function submit(event: FormEvent) {
    event.preventDefault(); if (pending.current) return;
    const text = minutes.trim();
    const values = text.split(/\s*[,，]\s*/).map(Number);
    if (enabled && (!/^\d+(?:\s*[,，]\s*\d+)*$/.test(text) || values.length > MAX_REMINDER_COUNT || values.some(n => !Number.isSafeInteger(n) || n < 0 || n > MAX_REMINDER_MINUTES))) {
      setError('請輸入 0–10080 的整數，以逗號分隔，最多十個。'); return;
    }
    if (enabled && !canEnableRule) { setError('背景提醒尚未啟用，請先重新確認服務。'); return; }
    pending.current = true; setBusy(true); setError(null);
    void reminders.saveRule({ calendarId: calendar.id, minutesBefore: enabled ? [...new Set(values)].sort((a, b) => a - b) : [], timezone: zone, dateTime, includeTodos: todos }, expected)
      .then(() => { if (mounted.current) onClose(); }, cause => { if (mounted.current) setError(describe(cause)); })
      .finally(() => { pending.current = false; if (mounted.current) setBusy(false); });
  }
  async function reload() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      const saved = await reminders.reloadRule(calendar.id);
      if (!mounted.current) return;
      setEnabled(Boolean(saved)); setMinutes(saved?.minutesBefore.join(', ') ?? '10'); setDateTime(saved?.dateTime ?? '09:00');
      setZone(saved?.timezone ?? timezone); setTodos(saved?.includeTodos ?? false); setExpected(saved?.updatedAt ?? null);
    } catch (cause) { if (mounted.current) setError(describe(cause)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <ViewportLayer><div className="cal-manage-layer" ref={layer}>
    <div className="cal-manage-backdrop" onClick={() => { if (!pending.current) onClose(); }} />
    <form className="cal-manage-dialog reminder-rule-dialog" role="dialog" aria-modal="true" aria-label="日曆提醒" aria-busy={busy} onSubmit={submit}>
      <h2 className="cal-manage-title">日曆提醒</h2><p className="set-pref-help reminder-calendar-name">{calendar.name}</p>
      <label className="reminder-checkbox"><input type="checkbox" checked={enabled} disabled={busy || (!enabled && !canEnableRule)} onChange={event => setEnabled(event.target.checked)} autoFocus />開啟這本日曆的提醒</label>
      <fieldset disabled={busy || !enabled} className="reminder-rule-fields">
        <label className="cal-manage-label" htmlFor="reminder-minutes">提前幾分鐘（0 表示開始時）</label>
        <input className="cal-manage-input" id="reminder-minutes" type="text" inputMode="text" maxLength={80} value={minutes} onChange={event => setMinutes(event.target.value)} required={enabled} aria-describedby="reminder-minutes-help" />
        <p className="set-pref-help" id="reminder-minutes-help">例如 10, 30；最多十個，最早可提前七天。</p>
        <label className="cal-manage-label" htmlFor="reminder-date-time">全天事項與待辦的時刻</label>
        <input className="cal-manage-input" id="reminder-date-time" type="time" value={dateTime} required={enabled} onChange={event => setDateTime(event.target.value)} />
        <label className="cal-manage-label" htmlFor="reminder-timezone">日期事項的時區</label>
        <select className="cal-manage-input" id="reminder-timezone" value={zone} onChange={event => setZone(event.target.value)}>
          {timezoneOptions(zone, new Date()).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <label className="reminder-checkbox"><input type="checkbox" checked={todos} onChange={event => setTodos(event.target.checked)} />同時提醒有日期且尚未完成的待辦</label>
      </fieldset>
      <p className="set-pref-help">指定時間的行程依開始時間計算；全天事項與待辦依上方時刻計算，再扣除提前分鐘。</p>
      {error ? <p className="auth-action-error" role="alert">{error}</p> : null}
      {error ? <button className="button secondary" type="button" disabled={busy} onClick={() => void reload()}>重新載入已保存設定</button> : null}
      <div className="reminder-dialog-actions">
        <button className="button secondary" type="button" disabled={busy} onClick={onClose}>取消</button>
        <button className="button primary" type="submit" disabled={busy}>{busy ? '確認中…' : '儲存'}</button>
      </div>
    </form>
  </div></ViewportLayer>;
}
