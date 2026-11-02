import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { AuthContext, type AuthContextValue } from '../auth/authContext';
import type { Calendar } from '../domain/types';
import type { AppUpdateState } from '../pwa/useAppUpdate';
import { ReminderContext, type ReminderContextValue } from './reminderContext';
import { ReminderSettings } from './ReminderSettings';
import { ReminderWarning } from './ReminderWarning';
import { ReminderError, type ReminderRule } from './reminderService';

const A = '00000000-0000-4000-8000-000000000231', B = '00000000-0000-4000-8000-000000000232';
const KEY = 'B' + 'A'.repeat(86), NOW = '2026-11-01T01:00:00.123456+00:00', LATER = '2026-11-01T01:05:00.654321+00:00';
const calendar: Calendar = { id: A, name: '工作', color: '#666666', isVisible: true, isDefault: true, sortOrder: 0, createdAt: NOW, updatedAt: NOW };
const saved: ReminderRule = { calendarId: A, minutesBefore: [15], timezone: 'America/New_York', dateTime: '08:30', includeTodos: true, updatedAt: NOW };
let root: Root, container: HTMLDivElement;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
async function click(element: Element) { await act(async () => (element as HTMLElement).click()); }
async function change(input: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(row => row.textContent === name)!;
const dialog = () => container.querySelector<HTMLElement>('[role="dialog"]');
const field = (id: string) => container.querySelector<HTMLInputElement>('#' + id)!;
function fixture() {
  const auth: AuthContextValue = { user: { id: A } as Session['user'], session: null, initializing: false, isPasswordRecovery: false, googleAuthStatus: 'disabled', configurationError: null,
    signIn: vi.fn(), signUp: vi.fn(), signInWithGoogle: vi.fn(), requestPasswordReset: vi.fn(), updatePassword: vi.fn(), dismissPasswordRecovery: vi.fn(), signOut: vi.fn() };
  const reminders = {
    view: { userId: A, phase: 'ready' as ReminderContextValue['view']['phase'], canEnable: true as boolean, deviceId: null as string | null, pendingCount: 0, error: null as string | null,
      snapshot: { capabilities: { enabled: true as boolean, publicKey: KEY, lastTick: NOW }, rules: [] as ReminderRule[], devices: [] } },
    savingRule: false, refresh: vi.fn(async () => {}), enable: vi.fn(async () => true), disable: vi.fn(async () => true),
    saveRule: vi.fn<ReminderContextValue['saveRule']>(async input => ({ ...input, updatedAt: NOW })), reloadRule: vi.fn<ReminderContextValue['reloadRule']>(async () => saved),
  } satisfies ReminderContextValue;
  const updater: AppUpdateState = { currentVersion: '0.4.6', currentRelease: null, availableRelease: null, whatsNew: null, checkResult: null, checking: false, preparing: false, error: null, updateError: null,
    checkForUpdate: vi.fn(), updateNow: vi.fn(), dismissUpdate: vi.fn(), acknowledgeWhatsNew: vi.fn(), clearCheckResult: vi.fn() };
  const onOpenAuth = vi.fn(), onOpenSettings = vi.fn(); let calendars = [calendar];
  const render = async () => { await act(async () => root.render(<AuthContext.Provider value={auth}><ReminderContext.Provider value={reminders}>
    <ReminderWarning onOpenSettings={onOpenSettings} /><ReminderSettings calendars={calendars} timezone="Asia/Taipei" onOpenAuth={onOpenAuth} updater={updater} />
  </ReminderContext.Provider></AuthContext.Provider>)); };
  return { auth, reminders, updater, onOpenAuth, onOpenSettings, render, setCalendars: (value: Calendar[]) => { calendars = value; } };
}
describe('calendar reminder settings (DP-231)', () => {
  it('explains guest and unconfirmed Auth without prompting or exposing rule controls', async () => {
    const h = fixture(); h.auth.user = null; await h.render();
    expect(container.querySelector('.reminder-calendar-row')).toBeNull(); expect(container.querySelector<HTMLButtonElement>('.set-pref-toggle')!.disabled).toBe(true);
    await click(button('登入後設定提醒')); expect(h.onOpenAuth).toHaveBeenCalledTimes(1); expect(h.reminders.enable).not.toHaveBeenCalled();
    h.auth.user = { id: A } as Session['user']; h.auth.sessionUnconfirmed = true; await h.render();
    expect(container.textContent).toContain('確認登入狀態'); expect(container.querySelector('.reminder-calendar-row')).toBeNull();
  });
  it('keeps disabled backend actions unavailable and never presents a fake successful state', async () => {
    const h = fixture(); h.reminders.view.phase = 'unavailable'; h.reminders.view.canEnable = false; h.reminders.view.error = '背景提醒尚未啟用'; h.reminders.view.snapshot.capabilities.enabled = false;
    await h.render(); expect(container.querySelector<HTMLButtonElement>('.set-pref-toggle')!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('.reminder-calendar-row')!.disabled).toBe(true); expect(container.textContent).not.toContain('已開啟提醒');
    await click(button('重新確認提醒')); expect(h.reminders.refresh).toHaveBeenCalledTimes(1);
  });
  it('calls enable synchronously from the trusted action; active toggle calls disable', async () => {
    const h = fixture(); await h.render(); let called = false;
    h.reminders.enable.mockImplementation(() => { called = true; return Promise.resolve(true); });
    act(() => container.querySelector<HTMLButtonElement>('.set-pref-toggle')!.click()); expect(called).toBe(true);
    h.reminders.view.phase = 'active'; h.reminders.view.deviceId = A; await h.render(); await click(container.querySelector('.set-pref-toggle')!);
    expect(h.reminders.disable).toHaveBeenCalledTimes(1);
  });
  it('retains a warning after logout and provides settings navigation and explicit retry', async () => {
    const h = fixture(); h.auth.user = null; h.reminders.view.phase = 'unconfirmed'; h.reminders.view.pendingCount = 1;
    await h.render(); expect(container.textContent).toContain('重新登入原帳號'); await click(button('通知設定')); expect(h.onOpenSettings).toHaveBeenCalledTimes(1);
    h.auth.user = { id: A } as Session['user']; await h.render(); await click(button('停用這台裝置並確認')); expect(h.reminders.disable).toHaveBeenCalledTimes(1);
  });
  it('focuses and restores the calendar opener when Escape or backdrop cancels', async () => {
    const h = fixture(); await h.render(); const opener = container.querySelector<HTMLButtonElement>('.reminder-calendar-row')!;
    await click(opener); expect(dialog()).not.toBeNull(); expect(dialog()!.contains(document.activeElement)).toBe(true);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(dialog()).toBeNull(); expect(document.activeElement).toBe(opener);
    await click(opener); await click(container.querySelector('.cal-manage-backdrop')!); expect(dialog()).toBeNull(); expect(document.activeElement).toBe(opener);
    expect(h.reminders.saveRule).not.toHaveBeenCalled();
  });
  it.each(['-1', '10081', '1.5', '10,,20', '10 20', '0,1,2,3,4,5,6,7,8,9,10'])('preserves invalid minutes %s and does not send a rule', async text => {
    const h = fixture(); await h.render(); await click(container.querySelector('.reminder-calendar-row')!);
    await click(container.querySelector<HTMLInputElement>('.reminder-checkbox input')!); await change(field('reminder-minutes'), text); await click(button('儲存'));
    expect(h.reminders.saveRule).not.toHaveBeenCalled(); expect(field('reminder-minutes').value).toBe(text); expect(container.querySelector('[role="alert"]')?.textContent).toContain('0–10080');
  });
  it('sends explicit normalized offsets, exact saved CAS and date/todo settings; new rules start off', async () => {
    const h = fixture(); h.reminders.view.snapshot.rules = [saved]; await h.render(); await click(container.querySelector('.reminder-calendar-row')!);
    expect(field('reminder-date-time').value).toBe('08:30'); expect(container.querySelector<HTMLSelectElement>('#reminder-timezone')!.value).toBe('America/New_York');
    await change(field('reminder-minutes'), '30，0, 30,10'); await click(button('儲存'));
    expect(h.reminders.saveRule).toHaveBeenCalledWith({ calendarId: A, minutesBefore: [0, 10, 30], timezone: 'America/New_York', dateTime: '08:30', includeTodos: true }, NOW); expect(dialog()).toBeNull();
    h.reminders.view.snapshot.rules = []; await h.render(); await click(container.querySelector('.reminder-calendar-row')!);
    expect(container.querySelector<HTMLInputElement>('.reminder-checkbox input')!.checked).toBe(false); expect(h.reminders.saveRule).toHaveBeenCalledTimes(1);
  });
  it('turns a calendar off with an empty offset list without modifying the native device', async () => {
    const h = fixture(); h.reminders.view.snapshot.rules = [saved]; await h.render(); await click(container.querySelector('.reminder-calendar-row')!);
    await click(container.querySelector('.reminder-checkbox input')!); await click(button('儲存'));
    expect(h.reminders.saveRule).toHaveBeenCalledWith({ calendarId: A, minutesBefore: [], timezone: 'America/New_York', dateTime: '08:30', includeTodos: true }, NOW);
    expect(h.reminders.disable).not.toHaveBeenCalled();
  });
  it('preserves the draft and dialog on conflict, then explicitly reloads saved values and CAS before retry', async () => {
    const h = fixture(); h.reminders.view.snapshot.rules = [saved]; h.reminders.saveRule.mockRejectedValueOnce(new ReminderError('conflict', '設定已變更，請重新確認。'));
    h.reminders.reloadRule.mockResolvedValue({ ...saved, minutesBefore: [20], updatedAt: LATER }); await h.render(); await click(container.querySelector('.reminder-calendar-row')!);
    await change(field('reminder-minutes'), '60'); await click(button('儲存')); expect(field('reminder-minutes').value).toBe('60'); expect(dialog()).not.toBeNull();
    await click(button('重新載入已保存設定')); expect(field('reminder-minutes').value).toBe('20'); await click(button('儲存'));
    expect(h.reminders.saveRule).toHaveBeenLastCalledWith({ calendarId: A, minutesBefore: [20], timezone: 'America/New_York', dateTime: '08:30', includeTodos: true }, LATER);
  });
  it('keeps drafts on failed reload and sanitizes unexpected errors', async () => {
    const h = fixture(); h.reminders.saveRule.mockRejectedValue(new Error('PRIVATE endpoint token')); h.reminders.reloadRule.mockRejectedValue(new Error('PRIVATE response'));
    await h.render(); await click(container.querySelector('.reminder-calendar-row')!); await click(container.querySelector('.reminder-checkbox input')!);
    await change(field('reminder-minutes'), '45'); await click(button('儲存')); await click(button('重新載入已保存設定'));
    expect(field('reminder-minutes').value).toBe('45'); expect(container.textContent).not.toContain('PRIVATE'); expect(dialog()).not.toBeNull();
  });
  it('keeps the pending form mounted and input disabled until save rejects, then preserves the draft', async () => {
    const h = fixture(); let reject!: (cause: unknown) => void;
    h.reminders.saveRule.mockReturnValueOnce(new Promise((_resolve, no) => { reject = no; }));
    await h.render(); await click(container.querySelector('.reminder-calendar-row')!); await click(container.querySelector('.reminder-checkbox input')!);
    await change(field('reminder-minutes'), '60'); await click(button('儲存'));
    expect(dialog()?.getAttribute('aria-busy')).toBe('true'); expect(container.querySelector<HTMLFieldSetElement>('fieldset')?.disabled).toBe(true);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await click(container.querySelector('.cal-manage-backdrop')!); expect(dialog()).not.toBeNull();
    await act(async () => { reject(new ReminderError('failed', '尚未確認保存')); });
    expect(field('reminder-minutes').value).toBe('60'); expect(button('儲存').disabled).toBe(false);
  });
  it('immediately hides an open A dialog after account change or calendar revocation', async () => {
    const h = fixture(); await h.render(); await click(container.querySelector('.reminder-calendar-row')!); expect(dialog()).not.toBeNull();
    h.auth.user = { id: B } as Session['user']; await h.render(); expect(dialog()).toBeNull();
    h.auth.user = { id: A } as Session['user']; h.setCalendars([]); await h.render(); expect(dialog()).toBeNull(); expect(h.reminders.saveRule).not.toHaveBeenCalled();
  });
  it('offers the existing explicit App updater when the worker lacks reminder capability', async () => {
    const h = fixture(); h.reminders.view.error = '請先完成 App 更新，再重新確認通知設定。'; h.reminders.view.canEnable = false;
    await h.render(); await click(button('完成 App 更新')); expect(h.updater.updateNow).toHaveBeenCalledTimes(1); expect(h.reminders.enable).not.toHaveBeenCalled();
  });
});
