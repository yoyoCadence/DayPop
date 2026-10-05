import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { expect, test as base, type Page, type TestInfo } from '@playwright/test';
import type { DayPopUserData } from '../src/domain/types';
import { backupData } from './fixtures/backupData';
import { expectedExportComponents, expectedExternalEvents, externalIcs } from './fixtures/icsTransfer';
import { agendaRow, calendarViewButton, monitorBrowser, openApp, reloadApp, tabButton } from './support';

const test = base.extend<{ browserHealth: void }>({
  browserHealth: [async ({ page }, provide) => {
    const assertCleanBrowser = monitorBrowser(page);
    await provide();
    assertCleanBrowser();
  }, { auto: true }],
});

// Make device time differ from preferences: floating ICS times must use the
// saved display timezone, while an explicit TZID or UTC instant keeps its zone.
test.use({ timezoneId: 'America/New_York' });
const now = '2026-09-30T04:00:00.000Z';
const storageKey = 'daypop.user-data';
const defaultCalendarId = backupData.calendars[0].id;
// The default is deliberately not the first row. Import must find isDefault.
const sourceData: DayPopUserData = { ...backupData, calendars: [...backupData.calendars].reverse() };

async function storedBytes(page: Page) {
  const raw = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  expect(raw).not.toBeNull();
  return raw!;
}

async function storedEnvelope(page: Page): Promise<{ revision: number; data: DayPopUserData }> {
  return JSON.parse(await storedBytes(page));
}

async function downloadIcs(page: Page, testInfo: TestInfo) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '⬇ 匯出 .ics', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('daypop-2026-09-30.ics');
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

function expectAppendPreservesSource(data: DayPopUserData, addedEvents: number, addedExceptions: number) {
  expect(data).toEqual({
    ...sourceData,
    events: [...sourceData.events, ...data.events.slice(sourceData.events.length)],
    eventExceptions: [...sourceData.eventExceptions, ...data.eventExceptions.slice(sourceData.eventExceptions.length)],
  });
  expect(data.events).toHaveLength(sourceData.events.length + addedEvents);
  expect(data.eventExceptions).toHaveLength(sourceData.eventExceptions.length + addedExceptions);
  const ids = [...data.events, ...data.eventExceptions].map((row) => row.id);
  expect(new Set(ids).size).toBe(ids.length);
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(now));
  await openApp(page);
  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  console.log('ICS browser timezone:', zone);
  expect(zone).toBe('America/New_York');
  // Seed once. A reload must read the actual result rather than a reset fixture.
  await page.evaluate(({ key, data }) => {
    const envelope = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...envelope, revision: 7, data }));
  }, { key: storageKey, data: sourceData });
  await reloadApp(page);
  await tabButton(page, '設定').click();
  await expect(page.getByLabel('寵物名字')).toHaveValue('備份夥伴');
});

test('ICS 真實下載與取消不寫入，確認附加會重新命名碰撞 UID 並保留重複例外', async ({ page }, testInfo) => {
  const beforeBytes = await storedBytes(page);
  const { path, text } = await downloadIcs(page, testInfo);
  expect(await storedBytes(page)).toBe(beforeBytes);
  expect(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
  expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
  // RFC line unfolding here is test-only text inspection, not production parsing.
  const unfolded = text.replace(/\r\n[ \t]/g, '');
  const components = [...unfolded.matchAll(/BEGIN:VEVENT\r\n([\s\S]*?)END:VEVENT/g)]
    .map((match) => match[1].trimEnd().split('\r\n'));
  expect(components).toEqual(expectedExportComponents);
  for (const omitted of ['備份待辦', '備份子項', '備份夥伴', 'VALARM', 'VTODO']) {
    expect(text).not.toContain(omitted);
  }

  await chooseIcs(page, path);
  const preview = page.getByRole('dialog', { name: '匯入預覽' });
  await expect(preview).toContainText('共 4 筆行程');
  await expect(preview).toContainText('例外 2');
  await expect(preview).toContainText('3 個重複識別碼會在匯入時重新命名');
  await expect(preview).not.toContainText('將取代目前');
  const confirm = preview.getByRole('button', { name: '匯入 6 筆', exact: true });
  await expect(confirm).toBeFocused();
  expect(await storedBytes(page)).toBe(beforeBytes);
  await preview.getByRole('button', { name: '取消', exact: true }).click();
  await expect(preview).toBeHidden();
  expect(await storedBytes(page)).toBe(beforeBytes);
  // Same file and same input, before reload: cancelling must reset the picker.
  await chooseIcs(page, path);
  await expect(preview).toBeVisible();
  await preview.press('Escape');
  await expect(preview).toBeHidden();
  expect(await storedBytes(page)).toBe(beforeBytes);
  await reloadApp(page);
  expect(await storedBytes(page)).toBe(beforeBytes);
  await tabButton(page, '設定').click();
  await chooseIcs(page, path);
  await confirm.click();
  await expect(preview).toBeHidden();
  await expect(page.getByRole('status')).toContainText('匯入 6 筆資料');
  const restored = await storedEnvelope(page);
  expect(restored.revision).toBe(8);
  expectAppendPreservesSource(restored.data, 4, 2);

  const incoming = restored.data.events.slice(sourceData.events.length);
  for (const source of sourceData.events) {
    const event = incoming.find((candidate) => candidate.title === source.title)!;
    expect(event).toEqual({
      ...source, id: expect.any(String), calendarId: defaultCalendarId,
      reminderMinutes: [], createdAt: now, updatedAt: now,
    });
    expect(event.id).not.toBe(source.id);
  }
  const series = incoming.find((event) => event.title === '備份晨會')!;
  const replacement = incoming.find((event) => event.title === '備份改期晨會')!;
  expect(restored.data.eventExceptions.slice(sourceData.eventExceptions.length)).toEqual([
    {
      id: expect.any(String), eventId: series.id,
      occurrence: { kind: 'timed', startsAt: '2026-10-01T01:00:00.000Z' },
      isCancelled: true, replacementEventId: null, createdAt: now, updatedAt: now,
    },
    {
      id: expect.any(String), eventId: series.id,
      occurrence: { kind: 'timed', startsAt: '2026-10-02T01:00:00.000Z' },
      isCancelled: false, replacementEventId: replacement.id, createdAt: now, updatedAt: now,
    },
  ]);

  const savedBytes = await storedBytes(page);
  await reloadApp(page);
  expect(await storedBytes(page)).toBe(savedBytes);
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, '備份晨會')).toHaveCount(2);
  await expect(agendaRow(page, '備份改期晨會')).toHaveCount(2);
  await expect(agendaRow(page, '備份夜班')).toHaveCount(4); // Two events × two display segments.
  await expect(agendaRow(page, '備份假期')).toHaveCount(6); // Two events × three inclusive all-day dates.
  await expect(agendaRow(page, '備份待辦')).toHaveCount(1);
});

test('外部 ICS 的浮動時間使用偏好時區，TZID／UTC／全天與文字轉義可在 reload 後讀回', async ({ page }) => {
  const beforeBytes = await storedBytes(page);
  await chooseIcs(page, icsFile(externalIcs));
  const preview = page.getByRole('dialog', { name: '匯入預覽' });
  await expect(preview).toContainText('共 4 筆行程');
  await expect(preview).toContainText('13:00–14:00 · 2026-09-30');
  await expect(preview).toContainText('23:00–01:00 · 2026-09-30');
  await expect(preview).toContainText('14:30–15:30 · 2026-09-30');
  await expect(preview).toContainText('全天 · 2026-09-30');
  expect(await storedBytes(page)).toBe(beforeBytes);
  await preview.getByRole('button', { name: '匯入 4 筆', exact: true }).click();
  await expect(preview).toBeHidden();
  await expect(page.getByRole('status')).toContainText('匯入 4 筆資料');
  const result = await storedEnvelope(page);
  expect(result.revision).toBe(8);
  expectAppendPreservesSource(result.data, 4, 0);
  expect(result.data.events.slice(sourceData.events.length)).toEqual(expectedExternalEvents.map((event) => ({
    ...event, id: expect.any(String), calendarId: defaultCalendarId, recurrence: null,
    reminderMinutes: [], createdAt: now, updatedAt: now,
  })));

  const savedBytes = await storedBytes(page);
  await reloadApp(page);
  expect(await storedBytes(page)).toBe(savedBytes);
  await calendarViewButton(page, '列表').click();
  for (const event of expectedExternalEvents) {
    await expect(agendaRow(page, event.title)).toHaveCount(event.allDay ? 3 : 1); // The imported holiday is September 30 through October 2.
  }
  await expect(agendaRow(page, '外部,浮動會議')).toContainText('13:00');
  await expect(agendaRow(page, '外部紐約夜班')).toContainText('11:00');
  await expect(agendaRow(page, '外部 UTC 會議')).toContainText('22:30');
  await agendaRow(page, '外部,浮動會議').click();
  const eventDialog = page.getByRole('dialog', { name: '編輯行程' });
  await expect(eventDialog.getByLabel('地點')).toHaveValue('北區,會議室;A');
  await expect(eventDialog.getByLabel('備註')).toHaveValue('第一行\n第二行;保留換行與中文');
});

for (const invalid of [
  { name: '沒有行程', text: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n', error: '無法從此檔案辨識出行程' },
  // The first component is valid. A later invalid one must reject the whole file.
  { name: '後續行程時區無效', text: externalIcs.replace('TZID=America/New_York', 'TZID=Unknown/Nowhere'), error: '無法從這個檔案讀出行程' },
]) {
  test(`ICS 拒絕${invalid.name}，不部分匯入且仍可重新選擇有效檔`, async ({ page }) => {
    const beforeBytes = await storedBytes(page);
    await chooseIcs(page, icsFile(invalid.text));
    await expect(page.getByRole('alert')).toContainText(invalid.error);
    await expect(page.getByRole('dialog', { name: '匯入預覽' })).toHaveCount(0);
    expect(await storedBytes(page)).toBe(beforeBytes);
    await reloadApp(page);
    expect(await storedBytes(page)).toBe(beforeBytes);
    await tabButton(page, '設定').click();
    await chooseIcs(page, icsFile(externalIcs));
    const preview = page.getByRole('dialog', { name: '匯入預覽' });
    await expect(preview).toContainText('共 4 筆行程');
    await preview.getByRole('button', { name: '匯入 4 筆', exact: true }).click();
    await expect(preview).toBeHidden();
    await expect(page.getByRole('status')).toContainText('匯入 4 筆資料');
    const result = await storedEnvelope(page);
    expect(result.revision).toBe(8);
    expectAppendPreservesSource(result.data, 4, 0);
    const savedBytes = await storedBytes(page);
    await reloadApp(page);
    expect(await storedBytes(page)).toBe(savedBytes);
  });
}
