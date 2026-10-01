import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { expect, test as base, type Page, type TestInfo } from '@playwright/test';
import type { DayPopUserData } from '../src/domain/types';
import { expectedExternalEvents, externalIcs } from './fixtures/icsTransfer';
import {
  E2E_EMAIL, E2E_PASSWORD, agendaRow, calendarViewButton,
  monitorBrowser, openApp, tabButton,
} from './support';

// Only the synthetic account in the dev-only auth harness, never a real user.
const accountCacheKey = 'daypop.account-cache.00000000-0000-4000-8000-000000000030';
const guestKey = 'daypop.user-data';
const testDate = '2026-09-30';
const serverTime = '2026-08-09T00:00:00.000Z';

const test = base.extend<{ browserHealth: void; guestBytes: string }>({
  browserHealth: [async ({ page }, provide) => {
    const assertCleanBrowser = monitorBrowser(page);
    await provide();
    assertCleanBrowser();
  }, { auto: true }],
  guestBytes: async ({ page }, provide) => {
    await page.clock.setFixedTime(new Date('2026-09-30T04:00:00.000Z'));
    await openApp(page, '/e2e/auth.html');
    const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    console.log('Account ICS browser timezone:', zone);
    expect(zone).toBe('Asia/Taipei');
    await addEntry(page, '遊客專用行程');
    const bytes = await storageBytes(page, guestKey);
    await signIn(page);
    await provide(bytes);
  },
});

async function storageBytes(page: Page, key: string) {
  const raw = await page.evaluate((key) => localStorage.getItem(key), key);
  expect(raw).not.toBeNull();
  return raw!;
}

async function accountData(page: Page): Promise<DayPopUserData> {
  return JSON.parse(await storageBytes(page, accountCacheKey)).data;
}

async function signIn(page: Page) {
  await tabButton(page, '設定').click();
  await page.getByRole('button', { name: '登入／註冊', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '保存你的日蹦資料' });
  await dialog.getByLabel('Email').fill(E2E_EMAIL);
  await dialog.getByLabel('密碼').fill(E2E_PASSWORD);
  await dialog.getByRole('button', { name: '登入', exact: true }).click();
  await tabButton(page, '設定').click();
  await expect(page.getByText('帳號已登入', { exact: true })).toBeVisible();
  await expect(page.getByText('● 已同步', { exact: true })).toBeVisible();
}

async function addEntry(page: Page, title: string, kind: '行程' | '待辦' = '行程', daily = false) {
  await tabButton(page, '日曆').click();
  await page.getByRole('button', { name: '新增', exact: true }).click();
  if (kind === '待辦') {
    await page.getByRole('group', { name: '新增類型' })
      .getByRole('button', { name: '待辦', exact: true }).click();
  }
  const dialog = page.getByRole('dialog', { name: `新增${kind}` });
  await dialog.getByLabel('標題').fill(title);
  await dialog.getByLabel('日期').fill(testDate);
  if (kind === '行程') {
    await dialog.getByLabel('開始', { exact: true }).fill('09:00');
    await dialog.getByLabel('結束', { exact: true }).fill('10:00');
    if (daily) await dialog.getByLabel('重複').selectOption('daily');
  }
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, title)).toHaveCount(daily ? 16 : 1);
}

async function createAccountSource(page: Page) {
  await addEntry(page, '帳號附件行程');
  await agendaRow(page, '帳號附件行程').click();
  const dialog = page.getByRole('dialog', { name: '編輯行程' });
  await dialog.locator('input[type="file"]').setInputFiles('e2e/fixtures/e2e-note.txt');
  await expect(dialog.getByRole('status')).toContainText('附件已安全保存');
  await expect(dialog.locator('.cal-attachment-list li')).toContainText('e2e-note.txt');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await addEntry(page, '帳號保留待辦', '待辦');
  await tabButton(page, '設定').click();
  await page.getByLabel('寵物名字').fill('帳號 ICS 夥伴');
  await page.getByLabel('寵物名字').press('Tab');
  await expect.poll(async () => (await accountData(page)).preferences.petName).toBe('帳號 ICS 夥伴');
  await expect(page.getByText('● 已同步', { exact: true })).toBeVisible();
  expect((await accountData(page)).eventAttachments).toHaveLength(1);
}

async function createSeriesExceptions(page: Page) {
  await addEntry(page, '帳號每日行程', '行程', true);
  // The agenda is ordered by date. Verify the tapped date before each write.
  await agendaRow(page, '帳號每日行程').nth(1).click();
  const dialog = page.getByRole('dialog', { name: '編輯行程' });
  await expect(dialog.getByLabel('日期')).toHaveValue('2026-10-01');
  await dialog.getByRole('button', { name: '刪除事件', exact: true }).click();
  await page.getByRole('dialog', { name: '刪除重複事件' })
    .getByRole('button', { name: '只刪這一次', exact: true }).click();
  await expect(agendaRow(page, '帳號每日行程')).toHaveCount(15);
  await agendaRow(page, '帳號每日行程').nth(1).click();
  await expect(dialog.getByLabel('日期')).toHaveValue('2026-10-02');
  await dialog.getByLabel('標題').fill('帳號改期行程');
  await dialog.getByLabel('開始', { exact: true }).fill('11:00');
  await dialog.getByLabel('結束', { exact: true }).fill('12:00');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await page.getByRole('dialog', { name: '修改重複事件' })
    .getByRole('button', { name: '只改這一次', exact: true }).click();
  await expect(agendaRow(page, '帳號每日行程')).toHaveCount(14);
  await expect(agendaRow(page, '帳號改期行程')).toHaveCount(1);
  await tabButton(page, '設定').click();
  await expect(page.getByText('● 已同步', { exact: true })).toBeVisible();
}

async function downloadIcs(page: Page, testInfo: TestInfo) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '⬇ 匯出 .ics', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(`daypop-${testDate}.ics`);
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  expect(await download.failure()).toBeNull();
  return { path, text: await readFile(path, 'utf8') };
}

async function chooseIcs(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  const pending = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '⬆ 匯入 .ics', exact: true }).click();
  await (await pending).setFiles(file);
}

function icsFile(text: string) {
  return { name: 'external-calendar.ics', mimeType: 'text/calendar', buffer: Buffer.from(text) };
}

function expectSourcePreserved(data: DayPopUserData, source: DayPopUserData, events: number, exceptions: number) {
  const sourceEventIds = new Set(source.events.map((event) => event.id));
  const sourceExceptionIds = new Set(source.eventExceptions.map((exception) => exception.id));
  const incoming = data.events.filter((event) => !sourceEventIds.has(event.id));
  const incomingExceptions = data.eventExceptions.filter((exception) => !sourceExceptionIds.has(exception.id));
  // Do not depend on database row ordering; compare originals by their IDs.
  expect({
    ...data,
    events: source.events.map((event) => data.events.find((row) => row.id === event.id)),
    eventExceptions: source.eventExceptions.map((exception) => data.eventExceptions.find((row) => row.id === exception.id)),
  }).toEqual(source);
  expect(data.events).toHaveLength(source.events.length + events);
  expect(data.eventExceptions).toHaveLength(source.eventExceptions.length + exceptions);
  expect(incoming).toHaveLength(events);
  expect(incomingExceptions).toHaveLength(exceptions);
  const ids = [...data.events, ...data.eventExceptions].map((row) => row.id);
  expect(new Set(ids).size).toBe(ids.length);
  return { incoming, incomingExceptions };
}

/** Full page reload would recreate the fake DB. Remount the adapter instead,
 * after removing only the synthetic account cache, to force a remote read.
 * This cannot prove real Supabase durability, RLS or Auth session restore. */
async function reloadAccountWithoutCache(page: Page, guestBytes: string) {
  await tabButton(page, '設定').click();
  await page.getByRole('button', { name: '登出', exact: true }).click();
  await tabButton(page, '設定').click();
  await expect(page.getByText('目前是遊客模式', { exact: true })).toBeVisible();
  expect(await storageBytes(page, guestKey)).toBe(guestBytes);
  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, '遊客專用行程')).toHaveCount(1);
  await expect(page.locator('.cal-agenda-item')).toHaveCount(1);
  await page.evaluate((key) => localStorage.removeItem(key), accountCacheKey);
  expect(await page.evaluate((key) => localStorage.getItem(key), accountCacheKey)).toBeNull();
  await signIn(page);
  expect(await storageBytes(page, guestKey)).toBe(guestBytes);
}

test('帳號 ICS 真實下載再附加會保留附件、重新命名碰撞 UID 與例外，重登重新讀回', async ({ page, guestBytes }, testInfo) => {
  await createAccountSource(page);
  await createSeriesExceptions(page);
  const source = await accountData(page);
  const beforeBytes = await storageBytes(page, accountCacheKey);
  const attachmentEvent = source.events.find((event) => event.title === '帳號附件行程')!;
  const series = source.events.find((event) => event.title === '帳號每日行程')!;
  expect(source.events).toHaveLength(3);
  expect(source.eventExceptions).toHaveLength(2);
  const { path, text } = await downloadIcs(page, testInfo);
  expect(await storageBytes(page, accountCacheKey)).toBe(beforeBytes);
  const components = [...text.replace(/\r\n[ \t]/g, '').matchAll(/BEGIN:VEVENT\r\n([\s\S]*?)END:VEVENT/g)]
    .map((match) => match[1].trimEnd().split('\r\n'));
  // Literal expectations from the UI input; no production ICS helper used.
  expect(components).toEqual([
    [
      `UID:${attachmentEvent.id}@daypop.local`, 'DTSTAMP:20260809T000000Z',
      'DTSTART;TZID=Asia/Taipei:20260930T090000', 'DTEND;TZID=Asia/Taipei:20260930T100000',
      'SUMMARY:帳號附件行程',
    ],
    [
      `UID:${series.id}@daypop.local`, 'DTSTAMP:20260809T000000Z',
      'DTSTART;TZID=Asia/Taipei:20260930T090000', 'DTEND;TZID=Asia/Taipei:20260930T100000',
      'SUMMARY:帳號每日行程', 'RRULE:FREQ=DAILY', 'EXDATE;TZID=Asia/Taipei:20261001T090000',
    ],
    [
      `UID:${series.id}@daypop.local`, 'DTSTAMP:20260809T000000Z',
      'RECURRENCE-ID;TZID=Asia/Taipei:20261002T090000',
      'DTSTART;TZID=Asia/Taipei:20261002T110000', 'DTEND;TZID=Asia/Taipei:20261002T120000',
      'SUMMARY:帳號改期行程',
    ],
  ]);
  for (const omitted of ['遊客專用行程', '帳號保留待辦', '帳號 ICS 夥伴', 'VALARM', 'ATTACH',
    source.eventAttachments[0]!.objectPath, source.eventAttachments[0]!.fileName]) {
    expect(text).not.toContain(omitted);
  }

  await chooseIcs(page, path);
  const preview = page.getByRole('dialog', { name: '匯入預覽' });
  await expect(preview).toContainText('共 3 筆行程');
  await expect(preview).toContainText('例外 2');
  await expect(preview).toContainText('2 個重複識別碼會在匯入時重新命名');
  const confirm = preview.getByRole('button', { name: '匯入 5 筆', exact: true });
  await expect(confirm).toBeFocused();
  expect(await storageBytes(page, accountCacheKey)).toBe(beforeBytes);
  await preview.getByRole('button', { name: '取消', exact: true }).click();
  await expect(preview).toBeHidden();
  expect(await storageBytes(page, accountCacheKey)).toBe(beforeBytes);
  await chooseIcs(page, path);
  await expect(preview).toBeVisible();
  await preview.press('Escape');
  await expect(preview).toBeHidden();
  expect(await storageBytes(page, accountCacheKey)).toBe(beforeBytes);
  await chooseIcs(page, path);
  await confirm.click();
  await expect(preview).toBeHidden();
  await expect(page.getByRole('status')).toContainText('匯入 5 筆資料');
  await expect(page.getByText('● 已同步', { exact: true })).toBeVisible();
  const result = await accountData(page);
  const { incoming, incomingExceptions } = expectSourcePreserved(result, source, 3, 2);
  for (const original of source.events) {
    const event = incoming.find((event) => event.title === original.title)!;
    expect(event).toEqual({
      ...original, id: expect.any(String), reminderMinutes: [],
      createdAt: serverTime, updatedAt: serverTime,
    });
    expect(event.id).not.toBe(original.id);
  }
  const newSeries = incoming.find((event) => event.title === '帳號每日行程')!;
  const replacement = incoming.find((event) => event.title === '帳號改期行程')!;
  expect(incomingExceptions).toEqual(expect.arrayContaining([
    {
      id: expect.any(String), eventId: newSeries.id,
      occurrence: { kind: 'timed', startsAt: '2026-10-01T01:00:00.000Z' },
      isCancelled: true, replacementEventId: null, createdAt: serverTime, updatedAt: serverTime,
    },
    {
      id: expect.any(String), eventId: newSeries.id,
      occurrence: { kind: 'timed', startsAt: '2026-10-02T01:00:00.000Z' },
      isCancelled: false, replacementEventId: replacement.id, createdAt: serverTime, updatedAt: serverTime,
    },
  ]));
  expect(await storageBytes(page, guestKey)).toBe(guestBytes);
  await reloadAccountWithoutCache(page, guestBytes);
  expect(await accountData(page)).toEqual(result);
  await expect(page.getByLabel('寵物名字')).toHaveValue('帳號 ICS 夥伴');
  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, '帳號每日行程')).toHaveCount(28);
  await expect(agendaRow(page, '帳號改期行程')).toHaveCount(2);
  await expect(agendaRow(page, '帳號附件行程')).toHaveCount(2);
  await expect(agendaRow(page, '帳號保留待辦')).toHaveCount(1);
  // Equal-title/time rows have no stable order. Exactly one is the original
  // with its attachment; the ICS copy must not inherit attachment metadata.
  const attachmentCounts: number[] = [];
  for (let index = 0; index < 2; index += 1) {
    await agendaRow(page, '帳號附件行程').nth(index).click();
    const dialog = page.getByRole('dialog', { name: '編輯行程' });
    await expect(dialog).toBeVisible();
    const attachments = dialog.locator('.cal-attachment-list li');
    const count = await attachments.count();
    attachmentCounts.push(count);
    if (count > 0) await expect(attachments).toContainText('e2e-note.txt');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
  }
  expect(attachmentCounts.sort()).toEqual([0, 1]);
});

test('帳號 ICS 後續非法時區整份拒絕，重新選有效檔可附加並保留原資料與附件', async ({ page, guestBytes }) => {
  await createAccountSource(page);
  const source = await accountData(page);
  const beforeBytes = await storageBytes(page, accountCacheKey);
  // First component is valid: a later malformed component must prevent all writes.
  await chooseIcs(page, icsFile(externalIcs.replace('TZID=America/New_York', 'TZID=Unknown/Nowhere')));
  await expect(page.getByRole('alert')).toContainText('無法從這個檔案讀出行程');
  await expect(page.getByRole('dialog', { name: '匯入預覽' })).toHaveCount(0);
  expect(await storageBytes(page, accountCacheKey)).toBe(beforeBytes);
  expect(await storageBytes(page, guestKey)).toBe(guestBytes);
  // Reuse the same file input immediately after refusal, before remounting.
  await chooseIcs(page, icsFile(externalIcs));
  const preview = page.getByRole('dialog', { name: '匯入預覽' });
  await expect(preview).toContainText('共 4 筆行程');
  expect(await storageBytes(page, accountCacheKey)).toBe(beforeBytes);
  await preview.getByRole('button', { name: '取消', exact: true }).click();
  await expect(preview).toBeHidden();
  expect(await storageBytes(page, accountCacheKey)).toBe(beforeBytes);
  await reloadAccountWithoutCache(page, guestBytes);
  expect(await accountData(page)).toEqual(source);

  const beforeValid = await storageBytes(page, accountCacheKey);
  await chooseIcs(page, icsFile(externalIcs));
  await expect(preview).toContainText('共 4 筆行程');
  expect(await storageBytes(page, accountCacheKey)).toBe(beforeValid);
  expect(await accountData(page)).toEqual(source);
  await preview.getByRole('button', { name: '匯入 4 筆', exact: true }).click();
  await expect(preview).toBeHidden();
  await expect(page.getByRole('status')).toContainText('匯入 4 筆資料');
  await expect(page.getByText('● 已同步', { exact: true })).toBeVisible();
  expect(await storageBytes(page, accountCacheKey)).not.toBe(beforeValid);
  const result = await accountData(page);
  const { incoming } = expectSourcePreserved(result, source, 4, 0);
  expect(incoming).toEqual(expect.arrayContaining(expectedExternalEvents.map((event) => ({
    ...event, id: expect.any(String), calendarId: source.calendars[0]!.id, recurrence: null,
    reminderMinutes: [], createdAt: serverTime, updatedAt: serverTime,
  }))));
  await reloadAccountWithoutCache(page, guestBytes);
  expect(await accountData(page)).toEqual(result);
  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '列表').click();
  for (const title of expectedExternalEvents.map((event) => event.title)) {
    await expect(agendaRow(page, title)).toHaveCount(1);
  }
  await expect(agendaRow(page, '帳號保留待辦')).toHaveCount(1);
  await agendaRow(page, '帳號附件行程').click();
  await expect(page.getByRole('dialog', { name: '編輯行程' }).locator('.cal-attachment-list li'))
    .toContainText('e2e-note.txt');
});
