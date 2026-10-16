import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page } from '@playwright/test';
import { calendarViewButton, monitorBrowser, openApp, tabButton } from './support';

/**
 * Automated accessibility smoke — DP-162.
 *
 * axe-core checks the WCAG 2.x A/AA rules it can decide from the DOM: names,
 * roles, ARIA, labels, target size and text contrast. It cannot follow focus,
 * so it does not replace the focus-trap specs (DP-154), and a clean run is not
 * a screen-reader or real-device result (DP-032).
 *
 * Two things this file has to do for the results to mean anything:
 *
 * - **Hide `.dp-texture` while auditing.** It is the theme texture layer
 *   (`aria-hidden`, `pointer-events: none`, z-index 38) laid over the whole
 *   App. With it present axe cannot tell what is behind any text and files
 *   every contrast check under "incomplete" — the first run here reported no
 *   violations because it had measured nothing. Five themes draw nothing in
 *   it (`--scanline: none`); 像素 draws a 5–7% scanline every 3px, which this
 *   leaves out of the measurement.
 * - **Require contrast to have been measured.** Each audit must count at least
 *   `MIN_MEASURED_TEXT` passing contrast checks, so another overlay that blinds
 *   axe fails here instead of turning the smoke silently green. The fewest
 *   measured in the first run was 6, in 新增日曆: the page behind a dialog sits
 *   under its 50% backdrop, which axe rightly leaves undecided.
 */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const MIN_MEASURED_TEXT = 5;
const TEXTURE_OFF = '.dp-texture { display: none !important; }';

const THEMES = ['漫畫', '極簡', '暖陽', '商務', '鮮活', '像素'] as const;
const MODES = ['☀ 淺色', '☾ 深色'] as const;

const test = base.extend<{ browserHealth: void }>({
  browserHealth: [async ({ page }, provide) => {
    const assertCleanBrowser = monitorBrowser(page);
    await provide();
    assertCleanBrowser();
  }, { auto: true }],
});

/** Lets one-off animations finish, so contrast is read at rest rather than mid-fade. */
async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

async function audit(page: Page, label: string) {
  await settle(page);
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const violations = results.violations.flatMap((violation) =>
    violation.nodes.map((node) => `${violation.id}: ${node.target.join(' ')} — ${node.failureSummary ?? ''}`),
  );
  expect(violations, `${label}: axe violations`).toEqual([]);
  const measured = results.passes.find((rule) => rule.id === 'color-contrast')?.nodes.length ?? 0;
  expect(measured, `${label}: axe has to have measured text contrast`).toBeGreaterThanOrEqual(MIN_MEASURED_TEXT);
}

async function addEntry(page: Page, title: string, kind: '行程' | '待辦', allDay = false) {
  await page.getByRole('button', { name: '新增', exact: true }).click();
  if (kind === '待辦') {
    await page.getByRole('group', { name: '新增類型' }).getByRole('button', { name: '待辦', exact: true }).click();
  }
  const sheet = page.getByRole('dialog', { name: `新增${kind}` });
  await sheet.getByLabel('標題').fill(title);
  if (allDay) await sheet.getByRole('button', { name: '全天', exact: true }).click();
  await sheet.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

async function selectLook(page: Page, theme: (typeof THEMES)[number], mode: (typeof MODES)[number]) {
  await tabButton(page, '設定').click();
  await page.locator('.dp-theme-card', { hasText: theme }).click();
  await page.getByRole('button', { name: mode, exact: true }).click();
  await expect(page.getByRole('button', { name: mode, exact: true })).toHaveAttribute('aria-pressed', 'true');
}

async function openDayDetail(page: Page) {
  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '月').click();
  await page.locator('[data-date-key="2026-10-14"]').first().click();
  await expect(page.locator('.cal-day-layer')).toBeVisible();
}

async function closeDayDetail(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('.cal-day-layer')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  // Wednesday 10:00 in the configured Asia/Taipei, so the week and the day
  // detail hold the entries below whatever day CI runs on.
  await page.clock.setFixedTime(new Date('2026-10-14T02:00:00.000Z'));
  await openApp(page);
  console.log('Accessibility browser timezone:', await page.evaluate(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  ));
  await page.addStyleTag({ content: TEXTURE_OFF });
  await addEntry(page, '牙醫回診', '行程');
  await addEntry(page, '連假', '行程', true);
  await addEntry(page, '買牛奶', '待辦');
});

for (const mode of MODES) {
  test(`預設主題${mode}：四個分頁、三種檢視與主要 sheet 沒有 axe 違規`, async ({ page }) => {
    await selectLook(page, '漫畫', mode);
    await audit(page, '設定');
    await page.getByRole('button', { name: '＋ 新增日曆', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '新增日曆' })).toBeVisible();
    await audit(page, '新增日曆');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '新增日曆' })).toHaveCount(0);

    await tabButton(page, '日曆').click();
    for (const view of ['月', '週', '列表'] as const) {
      await calendarViewButton(page, view).click();
      await audit(page, `日曆 ${view}`);
    }
    await page.getByRole('button', { name: '新增', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '新增行程' })).toBeVisible();
    await audit(page, '新增行程');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '新增行程' })).toHaveCount(0);

    await openDayDetail(page);
    await audit(page, '日詳情');
    await closeDayDetail(page);

    await tabButton(page, '搜尋').click();
    await audit(page, '搜尋');
    await page.getByRole('textbox', { name: '搜尋' }).fill('牙醫');
    await audit(page, '搜尋結果');
    await tabButton(page, '綜覽').click();
    await audit(page, '綜覽');
  });
}

test('六套主題的淺色與深色：月曆、日詳情、新增行程與設定沒有 axe 違規', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome', '主題色只看手機版面；桌面版面由上面兩個案例涵蓋');
  test.slow();
  for (const theme of THEMES) {
    for (const mode of MODES) {
      const look = `${theme} ${mode}`;
      await selectLook(page, theme, mode);
      await audit(page, `${look} 設定`);
      await tabButton(page, '日曆').click();
      await calendarViewButton(page, '月').click();
      await audit(page, `${look} 月`);
      await openDayDetail(page);
      await audit(page, `${look} 日詳情`);
      await closeDayDetail(page);
      await page.getByRole('button', { name: '新增', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '新增行程' })).toBeVisible();
      await audit(page, `${look} 新增行程`);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: '新增行程' })).toHaveCount(0);
    }
  }
});
