import { expect, test } from '@playwright/test';
import { createEmptyUserData } from '../src/domain/types';
import { agendaRow, calendarViewButton, monitorBrowser, openApp, tabButton } from './support';

// DP-121: the原檔 keeps subtasks inside their parent (`t.subs`), so its list
// view, pet badge and overview only count top-level todos. DayPop stores them
// as rows; outside the day sheet they must not show up as todos of their own.
const NOW = '2026-09-30T04:00:00.000Z';
const DAY = '2026-09-30';

test('子項只在日詳情的父待辦下出現，列表、寵物徽章與綜覽只計最上層', async ({ page }) => {
  const clean = monitorBrowser(page);
  await page.clock.setFixedTime(new Date(NOW));
  const data = createEmptyUserData({ now: NOW });
  data.preferences.timezone = 'Asia/Taipei';
  const id = (n: number) => `12100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const common = {
    calendarId: data.calendars[0]!.id, dueDate: DAY, priority: 'none' as const, completedAt: null,
    sharingScope: 'inherit' as const, createdAt: NOW, updatedAt: NOW,
  };
  data.todos = [
    { ...common, id: id(1), parentId: null, title: '準備旅行', sortOrder: 0 },
    { ...common, id: id(2), parentId: id(1), title: '訂房', completedAt: NOW, sortOrder: 0 },
    { ...common, id: id(3), parentId: id(1), title: '打包', sortOrder: 1 },
    { ...common, id: id(4), parentId: null, title: '買牛奶', sortOrder: 1 },
  ];
  await page.addInitScript((data) => {
    if (!localStorage.getItem('daypop.user-data')) {
      localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 4, revision: 0, updatedAt: data.todos[0]!.updatedAt, data }));
    }
  }, data);
  await openApp(page);
  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  console.log('DP-121 browser timezone:', zone, 'display: Asia/Taipei');
  expect(zone).toBe('Asia/Taipei');

  // Two open top-level todos; the open subtask 打包 is not a third.
  await expect(page.locator('.cal-pet-badge')).toHaveText('2');

  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, '準備旅行')).toHaveCount(1);
  await expect(agendaRow(page, '買牛奶')).toHaveCount(1);
  await expect(agendaRow(page, '訂房')).toHaveCount(0);
  await expect(agendaRow(page, '打包')).toHaveCount(0);

  await tabButton(page, '綜覽').click();
  await page.getByRole('group', { name: '資料類型' }).getByRole('button', { name: '待辦', exact: true }).click();
  await expect(page.locator('.overview-total')).toHaveText('共 2 筆');
  await expect(page.locator('.overview-item-title')).toHaveText(['準備旅行', '買牛奶']);

  // The subtasks are still there, inside their parent's card.
  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '月').click();
  await page.getByRole('button', { name: `${DAY}，0 個行程`, exact: true }).click();
  const day = page.getByRole('dialog', { name: '9月30日 週三', exact: true });
  await expect(day.locator('.cal-day-sub-count')).toHaveText('▸ 1/2');
  await day.getByRole('button', { name: '展開 準備旅行 的子項', exact: true }).click();
  await expect(day.getByRole('button', { name: '完成 訂房', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(day.getByRole('button', { name: '完成 打包', exact: true })).toHaveAttribute('aria-pressed', 'false');
  clean();
});
