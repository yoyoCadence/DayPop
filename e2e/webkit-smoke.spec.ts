import { expect, test, type Page } from '@playwright/test';
import { checkPetSleep } from './fixtures/petSleep';
import {
  agendaRow,
  calendarViewButton,
  localTodayKey,
  monitorBrowser,
  openApp,
  reloadApp,
  tabButton,
} from './support';

// DP-159: deliberately small WebKit gate, not the full Chromium matrix or an
// iOS device claim. Every test uses a fresh guest context and the real adapter.
test.beforeEach(async ({ browserName }) => {
  expect(browserName).toBe('webkit');
});

test('前景閒置睡眠與輸入喚醒保留既有圖片、焦點與資料契約', async ({ page }) => {
  // Mobile WebKit has no native mouse wheel; Chromium exercises that input.
  await checkPetSleep(page, false);
});

async function openWebKit(page: Page) {
  await openApp(page);
  const timezone = await page.evaluate(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  console.log('WebKit smoke environment:', JSON.stringify({
    timezone,
    viewport: page.viewportSize(),
  }));
  expect(timezone).toBe('Asia/Taipei');
}

test('夥伴鍵盤移動保存，收起與展開交接焦點，重載保留側籤', async ({ page }) => {
  const clean = monitorBrowser(page);
  await openWebKit(page);
  const pet = page.locator('button.cal-pet');
  await pet.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '移動夥伴', exact: true }).click();
  await expect(pet).toBeFocused();
  const initial = (await pet.boundingBox())!;
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  expect((await pet.boundingBox())!.y).toBe(initial.y - 10);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '收起夥伴', exact: true }).click();
  const tab = page.getByRole('button', { name: /^展開夥伴/ });
  await expect(tab).toBeFocused();
  await reloadApp(page);
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(pet).toBeFocused();
  clean();
});

test('啟動後四分頁可用且沒有瀏覽器錯誤', async ({ page }) => {
  const assertCleanBrowser = monitorBrowser(page);
  await openWebKit(page);
  await expect(page).toHaveTitle(/日蹦/);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  for (const name of ['搜尋', '綜覽', '設定', '日曆'] as const) {
    await tabButton(page, name).click();
    await expect(tabButton(page, name)).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('main.dp-appbody')).not.toBeEmpty();
  }
  assertCleanBrowser();
});

test('建立行程後重載仍可讀回，刪除後重載保持刪除', async ({ page }) => {
  const assertCleanBrowser = monitorBrowser(page);
  await openWebKit(page);
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新增行程' });
  await create.getByLabel('標題', { exact: true }).fill('WebKit 保存行程');
  await create.getByLabel('日期', { exact: true }).fill(await localTodayKey(page));
  await create.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(create).toBeHidden();
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, 'WebKit 保存行程')).toHaveCount(1);

  await reloadApp(page);
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, 'WebKit 保存行程')).toHaveCount(1);
  await agendaRow(page, 'WebKit 保存行程').click();
  await page.getByRole('dialog', { name: '編輯行程' })
    .getByRole('button', { name: '刪除事件', exact: true }).click();
  await expect(agendaRow(page, 'WebKit 保存行程')).toHaveCount(0);
  await reloadApp(page);
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, 'WebKit 保存行程')).toHaveCount(0);
  assertCleanBrowser();
});

test('新增 sheet 限制焦點，Escape 關閉後回到新增按鈕且可再開', async ({ page }) => {
  const assertCleanBrowser = monitorBrowser(page);
  await openWebKit(page);
  const add = page.getByRole('button', { name: '新增', exact: true });
  // WebKit does not focus a button on pointer click. Give this keyboard flow
  // a focused trigger so restoring focus has a defined target.
  await add.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: '新增行程' });
  await expect(sheet.getByLabel('標題', { exact: true })).toBeFocused();
  await expect(page.locator('nav.dp-tabbar')).toHaveAttribute('inert', '');
  const stops = await sheet.locator('input, button, select, textarea').count();
  for (let press = 0; press < stops + 2; press += 1) {
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => sheet.evaluate(
      (element) => element.contains(document.activeElement),
    )).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(add).toBeFocused();
  await expect(page.locator('nav.dp-tabbar')).not.toHaveAttribute('inert');
  await add.click();
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: '取消', exact: true }).click();
  await expect(sheet).toBeHidden();
  assertCleanBrowser();
});

test('原生 WebP 貓可解碼，泡泡／reduce 切成 PNG 且關閉後 look 回 idle', async ({ page }) => {
  const clean = monitorBrowser(page);
  await openWebKit(page);
  const pet = page.locator('button.cal-pet');
  const image = pet.locator('img');
  await expect(image).toHaveAttribute('src', /moon-cat-idle.*webp/);
  await expect(image).toBeVisible();
  expect(await image.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(120);
  await pet.click(); await expect(image).toHaveAttribute('src', /idle.*png/);
  await page.getByRole('button', { name: '關閉', exact: true }).click();
  await expect(image).toHaveAttribute('src', /look.*webp/);
  await expect(image).toHaveAttribute('src', /idle.*webp/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(image).toHaveAttribute('src', /idle.*png/);
  await expect(image).toBeVisible(); clean();
});

test('設定的寵物名字與每週起始日重載後維持', async ({ page }) => {
  const assertCleanBrowser = monitorBrowser(page);
  await openWebKit(page);
  await tabButton(page, '設定').click();
  await page.getByLabel('寵物名字', { exact: true }).fill('WebKit 夥伴');
  const monday = page.getByRole('group', { name: '每週起始日', exact: true })
    .getByRole('button', { name: '一', exact: true });
  await monday.click();
  await expect.poll(() => page.evaluate(() => {
    const value = window.localStorage.getItem('daypop.user-data');
    return value ? JSON.parse(value).data.preferences.petName : null;
  })).toBe('WebKit 夥伴');
  await reloadApp(page);
  await tabButton(page, '設定').click();
  await expect(page.getByLabel('寵物名字', { exact: true })).toHaveValue('WebKit 夥伴');
  await expect(monday).toHaveAttribute('aria-pressed', 'true');
  assertCleanBrowser();
});
