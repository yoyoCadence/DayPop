import { readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { localTodayKey, monitorBrowser, openApp, tabButton } from './support';

/**
 * DP-173 — the real path a todo without a date takes: it only arrives through
 * an import, and 綜覽's 未排日期 is where it can then be managed.
 */
test('匯入沒有日期的待辦後，可在綜覽的「未排日期」排上日期，排好後移到那一天', async ({ page }, testInfo) => {
  const assertCleanBrowser = monitorBrowser(page);
  await openApp(page);
  await tabButton(page, '設定').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '⬇ 匯出資料', exact: true }).click();
  const backup = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  const stamp = new Date().toISOString();
  backup.data.todos.push({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    calendarId: backup.data.calendars[0].id,
    parentId: null,
    title: '整理收據',
    dueDate: null,
    priority: 'none',
    completedAt: null,
    sortOrder: 0,
    sharingScope: 'inherit',
    createdAt: stamp,
    updatedAt: stamp,
  });
  const file = testInfo.outputPath('with-undated-todo.json');
  await writeFile(file, JSON.stringify(backup));
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '⬆ 匯入資料', exact: true }).click();
  await (await chooser).setFiles(file);
  const preview = page.getByRole('dialog', { name: '匯入預覽' });
  await preview.getByRole('button', { name: '取代資料', exact: true }).click();
  await expect(preview).toBeHidden();

  await tabButton(page, '綜覽').click();
  await page.getByRole('group', { name: '資料類型' }).getByRole('button', { name: '待辦', exact: true }).click();
  const undated = page.locator('.overview-undated');
  await expect(undated).toContainText('未排日期');
  await expect(undated).toContainText('整理收據');

  await undated.getByRole('button', { name: '修改 整理收據 的日期', exact: true }).click();
  await undated.getByLabel('整理收據 的日期', { exact: true }).fill(await localTodayKey(page));
  await undated.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(undated).toHaveCount(0);
  await expect(page.locator('.overview-item-title', { hasText: '整理收據' })).toBeVisible();

  assertCleanBrowser();
});
