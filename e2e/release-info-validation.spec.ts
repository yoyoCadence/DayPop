import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { monitorBrowser, openApp, tabButton } from './support';

/**
 * DP-153 — a `version.json` that arrives but is not a release note to show.
 *
 * A 200 whose `changes` was missing, or not a list of strings, used to throw
 * while the release notice or the update prompt rendered it. Both live in the
 * shell's dialogs, outside the per-tab error boundary, so the root fallback in
 * `main.tsx` replaced the whole App. Only a browser test runs that composition.
 */
const RUNNING_VERSION: string = JSON.parse(readFileSync('package.json', 'utf8')).version;

const answers = [
  {
    name: '這一版的更新內容缺少 changes',
    // Not marked as seen, so the notes for the running version would be shown.
    seen: false,
    body: { version: RUNNING_VERSION, releasedAt: '2026-10-14', title: '這一版' },
  },
  {
    name: '較新版本的 changes 是字串',
    seen: true,
    body: { version: '99.0.0', releasedAt: '2026-10-14', title: '下一版', changes: '改了一件事' },
  },
] as const;

async function answerVersionCheck(page: Page, body: unknown) {
  await page.route('**/version.json*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

for (const answer of answers) {
  test(`${answer.name}：App 照常可用，檢查更新說明失敗原因`, async ({ page }) => {
    const assertCleanBrowser = monitorBrowser(page);
    await answerVersionCheck(page, answer.body);
    await openApp(page, '/', { releaseNotesSeen: answer.seen });
    await tabButton(page, '設定').click();

    // Only shown once the automatic check has been handled, so the two
    // absences below are checked after the answer arrived, not before.
    await expect(page.getByText('本次檢查失敗：更新資訊格式不正確')).toBeVisible();
    await expect(page.getByText('日蹦暫時無法啟動')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeVisible();

    await page.getByRole('button', { name: '檢查更新', exact: true }).click();
    const result = page.getByRole('dialog', { name: '暫時無法檢查更新' });
    await expect(result).toBeVisible();
    await expect(result).toContainText('更新資訊格式不正確');
    await result.getByRole('button', { name: '知道了' }).click();
    await expect(result).toBeHidden();

    assertCleanBrowser();
  });
}
