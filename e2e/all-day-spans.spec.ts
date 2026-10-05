import { expect, test, type Page } from '@playwright/test';
import { createEmptyUserData } from '../src/domain/types';
import { calendarViewButton, monitorBrowser, openApp, reloadApp, tabButton } from './support';

test.use({ timezoneId: 'America/New_York' });
const NOW = new Date('2026-08-12T04:00:00.000Z');

async function setup(page: Page, recurring = false) {
  await page.clock.install({ time: NOW });
  const data = createEmptyUserData({ now: NOW.toISOString() });
  data.preferences.petEnabled = false;
  data.preferences.timezone = 'Asia/Taipei';
  data.events = [{
    id: '12600000-0000-4000-8000-000000000001', calendarId: data.calendars[0]!.id,
    title: recurring ? '重複三天假期' : '三天旅行', location: '宜蘭', notes: null,
    reminderMinutes: [], sharingScope: 'inherit',
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), allDay: true,
    startDate: recurring ? '2026-08-07' : '2026-08-10',
    endDate: recurring ? '2026-08-09' : '2026-08-12',
    recurrence: recurring ? { rule: 'FREQ=DAILY;INTERVAL=3;COUNT=3' } : null,
  }];
  await page.addInitScript((data) => {
    if (!localStorage.getItem('daypop.user-data')) localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 4, revision: 0, updatedAt: data.events[0]!.createdAt, data }));
  }, data);
  await openApp(page);
  console.log('DP-126 browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
}

const raw = (page: Page) => page.evaluate(() => localStorage.getItem('daypop.user-data')!);
const cell = (page: Page, date: string) => page.locator(`[data-date-key="${date}"]`);

test('多日全天在月／週／列表／日詳情／綜覽一致，續日修改保留完整日期跨度', async ({ page }) => {
  const clean = monitorBrowser(page);
  await setup(page);
  const before = await raw(page);
  await expect(cell(page, '2026-08-10')).toContainText('三天旅行');
  await expect(cell(page, '2026-08-11')).toContainText('續 三天旅行');
  await expect(cell(page, '2026-08-12')).toContainText('續 三天旅行');
  await expect(cell(page, '2026-08-13')).not.toContainText('三天旅行');

  await calendarViewButton(page, '週').click();
  await expect(page.getByRole('region', { name: '本週全天事件' }).getByRole('button')).toHaveCount(3);
  await calendarViewButton(page, '列表').click();
  await expect(page.locator('.cal-agenda-item').filter({ hasText: '三天旅行' })).toHaveCount(1);
  await expect(page.locator('.cal-agenda-item').filter({ hasText: '三天旅行' })).toContainText('續 全天');
  await tabButton(page, '綜覽').click();
  await expect(page.locator('.overview-item').filter({ hasText: '三天旅行' })).toHaveCount(3);
  await expect(page.getByText('共 1 筆', { exact: true })).toBeVisible();
  expect(await raw(page)).toBe(before);

  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '月').click();
  await cell(page, '2026-08-12').focus();
  await page.keyboard.press('Enter');
  const day = page.getByRole('dialog', { name: '8月12日 週三', exact: true });
  const row = day.getByRole('button', { name: '續 全天 三天旅行 宜蘭', exact: true });
  await expect(row).toBeVisible();
  await row.focus();
  await page.keyboard.press('Space');
  const sheet = page.getByRole('dialog', { name: '編輯行程' });
  await expect(sheet.getByLabel('日期', { exact: true })).toHaveValue('2026-08-10');
  await sheet.getByLabel('標題', { exact: true }).fill('旅行已確認');
  await sheet.getByRole('button', { name: '儲存', exact: true }).click();
  const saved = JSON.parse(await raw(page)).data;
  expect(saved.events).toHaveLength(1);
  expect(saved.events[0]).toMatchObject({ title: '旅行已確認', startDate: '2026-08-10', endDate: '2026-08-12', allDay: true });
  await reloadApp(page);
  await expect(cell(page, '2026-08-12')).toContainText('續 旅行已確認');
  await cell(page, '2026-08-12').click();
  await expect(day.getByRole('button', { name: '續 全天 旅行已確認 宜蘭', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  clean();
});

test('從重複全天的續日取消／替換只影響整個指定 occurrence，reload 保留其他日期', async ({ page }) => {
  const clean = monitorBrowser(page);
  await setup(page, true);
  await cell(page, '2026-08-12').click();
  await page.getByRole('dialog', { name: '8月12日 週三', exact: true }).getByRole('button', { name: '續 全天 重複三天假期 宜蘭', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '編輯行程' });
  await expect(sheet.getByLabel('日期', { exact: true })).toHaveValue('2026-08-10');
  await sheet.getByRole('button', { name: '刪除事件', exact: true }).click();
  await page.getByRole('dialog', { name: '刪除重複事件' }).getByRole('button', { name: '只刪這一次', exact: true }).click();
  await page.getByRole('dialog', { name: '8月12日 週三', exact: true }).getByRole('button', { name: '完成', exact: true }).click();
  for (const date of ['2026-08-10', '2026-08-11', '2026-08-12']) await expect(cell(page, date)).not.toContainText('重複三天假期');
  await expect(cell(page, '2026-08-07')).toContainText('重複三天假期');
  await expect(cell(page, '2026-08-14')).toContainText('續 重複三天假期');

  await cell(page, '2026-08-14').click();
  await page.getByRole('dialog', { name: '8月14日 週五', exact: true }).getByRole('button', { name: '續 全天 重複三天假期 宜蘭', exact: true }).click();
  await expect(sheet.getByLabel('日期', { exact: true })).toHaveValue('2026-08-13');
  await sheet.getByLabel('標題', { exact: true }).fill('改名的三天假期');
  await sheet.getByRole('button', { name: '儲存', exact: true }).click();
  await page.getByRole('dialog', { name: '修改重複事件' }).getByRole('button', { name: '只改這一次', exact: true }).click();
  await reloadApp(page);
  for (const date of ['2026-08-13', '2026-08-14', '2026-08-15']) await expect(cell(page, date)).toContainText('改名的三天假期');
  await expect(cell(page, '2026-08-07')).toContainText('重複三天假期');
  await expect(cell(page, '2026-08-12')).not.toContainText('重複三天假期');
  const saved = JSON.parse(await raw(page)).data;
  expect(saved.events).toHaveLength(2);
  expect(saved.events[0]).toMatchObject({ startDate: '2026-08-07', endDate: '2026-08-09' });
  expect(saved.events[1]).toMatchObject({ title: '改名的三天假期', startDate: '2026-08-13', endDate: '2026-08-15' });
  expect(saved.eventExceptions.map((item: { occurrence: { date: string } }) => item.occurrence.date).sort()).toEqual(['2026-08-10', '2026-08-13']);
  clean();
});
