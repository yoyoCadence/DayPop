import { expect, type Page } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, openApp, tabButton } from './support';

export const REMINDER_ACCOUNT = '00000000-0000-4000-8000-000000000030';
export const REMINDER_CALENDAR = '00000000-0000-4000-8000-000000000031';
export interface ReminderHarnessState {
  capabilities: { enabled: boolean }; permission: NotificationPermission;
  installRequired: boolean; workerReady: boolean; loseNextRegistrationResponse: boolean; loseNextRuleResponse: boolean;
  holdRegistration: boolean; failLocalRemoval: boolean; failServerRemoval: boolean;
  stats: { consents: number; activation: boolean[]; registrations: number };
  devices: Map<string, Map<string, unknown>>;
  releaseRegistrations(): void;
  dropNativeSubscription(): void;
  deleteServerDevices(userId: string): void;
  changeRuleElsewhere(userId: string, calendarId: string, minutes: number[]): void;
}
export type ReminderHarnessWindow = Window & { __daypopReminderHarness?: ReminderHarnessState };
export const reminderToggle = (page: Page) => page.getByRole('button', { name: '這台裝置的通知', exact: true });
export const reminderDialog = (page: Page) => page.getByRole('dialog', { name: '日曆提醒', exact: true });
export async function reminderLogin(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-02T03:00:00Z'));
  await openApp(page, '/e2e/auth.html');
  console.log('reminder UI actual timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  await tabButton(page, '設定').click(); await page.getByRole('button', { name: '登入／註冊', exact: true }).click();
  const auth = page.getByRole('dialog', { name: '保存你的日蹦資料' });
  await auth.getByLabel('Email').fill(E2E_EMAIL); await auth.getByLabel('密碼', { exact: true }).fill(E2E_PASSWORD);
  await auth.getByRole('button', { name: '登入', exact: true }).click(); await tabButton(page, '設定').click();
  await expect(page.getByText('帳號已登入', { exact: true })).toBeVisible(); await expect(reminderToggle(page)).toBeEnabled();
}
export async function reminderReceipts(page: Page) {
  return page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('daypop.reminder-device.')).map(key => JSON.parse(localStorage.getItem(key)!) as { phase: string; deviceId: string | null; fingerprint: string | null }));
}
export async function enableReminder(page: Page) {
  await reminderToggle(page).click(); await expect(reminderToggle(page)).toHaveAttribute('aria-pressed', 'true');
}
