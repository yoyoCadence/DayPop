import { readFile } from 'node:fs/promises';
import { expect, test as base, type Page } from '@playwright/test';
import type { DayPopBackup } from '../src/domain/dataTransfer';
import { buildProductionUpdates, startProductionUpdateSite, type ProductionUpdateSite } from './fixtures/productionUpdateSite';
import { agendaRow, calendarViewButton, monitorBrowser, tabButton } from './support';

const test = base.extend<{ site: ProductionUpdateSite }, {
  artifacts: Awaited<ReturnType<typeof buildProductionUpdates>>;
}>({
  artifacts: [async ({ browserName }, provide) => { await provide(await buildProductionUpdates(browserName)); }, { scope: 'worker', timeout: 120_000 }],
  site: async ({ artifacts }, provide) => {
    const site = await startProductionUpdateSite(artifacts);
    try { await provide(site); } finally { await site.close(); }
  },
});

// Native Chromium capability, scoped to this spec's workers. Do not replace
// Storage/getters or seed through openApp's localStorage init script.
test.use({ launchOptions: { args: ['--disable-local-storage'] } });

const fixedInstant = '2026-10-02T04:00:00.000Z';
const dateKey = '2026-10-02';
const eventTitle = '記憶體模式行程';
const todoTitle = '記憶體模式待辦';

async function dismissReleaseNotice(page: Page) {
  const notice = page.getByRole('dialog').filter({ hasText: '已更新 · v' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: '知道了', exact: true }).click();
  await expect(notice).toHaveCount(0);
}

async function assertWarningsOnAllTabs(page: Page) {
  const warning = page.locator('.dp-storage-warning');
  for (const tab of ['日曆', '搜尋', '綜覽', '設定'] as const) {
    await tabButton(page, tab).click();
    await expect(warning).toBeVisible();
    await expect(warning).toHaveAttribute('role', 'status');
    await expect(warning).toContainText('這次的變更不會被保存');
    await expect(warning).toContainText('這個瀏覽器沒有提供本機儲存空間。');
    await expect(warning).toContainText('重新整理或關掉之後就會消失');
    await expect(warning.getByRole('button')).toHaveCount(0);
  }
}

async function downloadBackup(page: Page): Promise<DayPopBackup> {
  const ready = page.waitForEvent('download');
  await page.getByRole('button', { name: '⬇ 匯出資料', exact: true }).click();
  const download = await ready;
  expect(await download.failure()).toBeNull();
  return JSON.parse(await readFile((await download.path())!, 'utf8'));
}

test('Production 開機原生 localStorage 不可用：持續警告、分頁編輯與真實匯出，reload 回預設', async ({ page, context, site }) => {
  const assertCleanBrowser = monitorBrowser(page);
  const unexpectedRequests: string[] = [];
  context.on('request', (request) => {
    if (new URL(request.url()).origin !== site.origin) unexpectedRequests.push(request.url());
  });
  page.on('requestfailed', (request) => unexpectedRequests.push(`failed: ${request.url()}`));
  await page.clock.setFixedTime(new Date(fixedInstant));
  await page.goto(`${site.origin}/setup.html`);
  expect(await page.evaluate(() => window.localStorage === null)).toBe(true);
  console.log('Production unavailable storage native evidence: localStorage === null before App startup');
  await page.goto(`${site.origin}/DayPop/`);
  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  console.log('Production unavailable storage browser timezone:', zone);
  expect(zone).toBe('Asia/Taipei');
  await dismissReleaseNotice(page);
  await assertWarningsOnAllTabs(page);
  await expect(page.getByLabel('寵物名字')).toHaveValue('摩卡');
  await expect(page.getByRole('button', { name: /漫畫/ })).toHaveAttribute('aria-pressed', 'true');
  const initial = await downloadBackup(page);
  expect(initial).toMatchObject({
    format: 'daypop.backup', formatVersion: 1, appVersion: site.currentVersion,
    omitted: { eventAttachments: 0 },
  });
  expect(initial.data).toEqual({
    calendars: [{
      id: expect.any(String), name: '我的日曆', color: '#F06C5C', isVisible: true,
      isDefault: true, sortOrder: 0, createdAt: fixedInstant, updatedAt: fixedInstant,
    }],
    events: [], eventExceptions: [], todos: [], stickers: [],
    preferences: {
      timezone: 'Asia/Taipei', weekStartsOn: 0, theme: 'light', themeId: 'manga',
      calendarGridMode: 'adaptive', defaultReminderMinutes: [], petName: '摩卡', petEnabled: true,
    },
  });

  await tabButton(page, '日曆').click();
  await page.getByRole('button', { name: '新增', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '新增行程' });
  await dialog.getByLabel('標題').fill(eventTitle);
  await dialog.getByLabel('日期').fill(dateKey);
  await dialog.getByRole('button', { name: '全天', exact: true }).click();
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await page.getByRole('button', { name: '新增', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '新增行程' });
  await dialog.getByRole('group', { name: '新增類型' }).getByRole('button', { name: '待辦', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '新增待辦' });
  await dialog.getByLabel('標題').fill(todoTitle);
  await dialog.getByLabel('日期').fill(dateKey);
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, eventTitle)).toHaveCount(1);
  await agendaRow(page, todoTitle).click();
  await expect(agendaRow(page, todoTitle).locator('.cal-agenda-title')).toHaveCSS('text-decoration-line', 'line-through');
  await tabButton(page, '設定').click();
  await page.getByLabel('寵物名字').fill('本分頁的夥伴');
  await page.getByLabel('寵物名字').blur();
  await assertWarningsOnAllTabs(page);
  await expect(page.getByLabel('寵物名字')).toHaveValue('本分頁的夥伴');
  const edited = await downloadBackup(page);
  expect(edited.data.events).toHaveLength(1);
  expect(edited.data.events[0]).toMatchObject({
    calendarId: initial.data.calendars[0]!.id, title: eventTitle, allDay: true,
    startDate: dateKey, endDate: dateKey,
  });
  expect(edited.data.todos).toHaveLength(1);
  expect(edited.data.todos[0]).toMatchObject({
    calendarId: initial.data.calendars[0]!.id, title: todoTitle, dueDate: dateKey, completedAt: fixedInstant,
  });
  expect(edited.data.preferences).toEqual({ ...initial.data.preferences, petName: '本分頁的夥伴' });
  expect(edited.data.calendars).toEqual(initial.data.calendars);
  expect(edited.omitted).toEqual({ eventAttachments: 0 });
  expect(await page.evaluate(() => window.localStorage === null)).toBe(true);
  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, eventTitle)).toHaveCount(1);
  await expect(agendaRow(page, todoTitle)).toHaveCount(1);

  // A new document creates a new memory store, including the seen-notes key.
  await page.reload();
  await dismissReleaseNotice(page);
  expect(await page.evaluate(() => window.localStorage === null)).toBe(true);
  await assertWarningsOnAllTabs(page);
  await expect(page.getByLabel('寵物名字')).toHaveValue('摩卡');
  const reloaded = await downloadBackup(page);
  expect(reloaded.data).toEqual({
    ...initial.data, calendars: [{ ...initial.data.calendars[0]!, id: expect.any(String) }],
  });
  expect(reloaded.data.calendars[0]!.id).not.toBe(initial.data.calendars[0]!.id);
  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, eventTitle)).toHaveCount(0);
  await expect(agendaRow(page, todoTitle)).toHaveCount(0);
  assertCleanBrowser();
  expect(unexpectedRequests).toEqual([]);
});
