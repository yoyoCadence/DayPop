import { expect, test, type Page } from '@playwright/test';
import { calendarViewButton, monitorBrowser, openApp, reloadApp, tabButton } from './support';

const ART = '**/src/assets/themes/manga-journal/**';

async function decodeBackgrounds(page: Page, selectors: string[]) {
  return page.evaluate(async (targets) => {
    const results = [];
    for (const selector of targets) {
      const element = document.querySelector(selector);
      if (!element) throw new Error('Missing surface: ' + selector);
      const css = getComputedStyle(element).backgroundImage;
      const urls = [...css.matchAll(/url\(["']?(.*?)["']?\)/g)].map(match => match[1]);
      const images = await Promise.all(urls.map(async (url) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        return { url, width: image.naturalWidth, height: image.naturalHeight };
      }));
      results.push({ selector, images });
    }
    return results;
  }, selectors);
}

for (const mode of ['light', 'dark'] as const) {
  test('漫畫手帳 ' + mode + ' 真實圖片解碼、延遲載入不移動版面，原生行程／搜尋正常', async ({ page }) => {
    const clean = monitorBrowser(page);
    await page.clock.setFixedTime(new Date('2026-10-29T02:00:00.000Z'));
    const requested: string[] = [];
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    await page.route(ART, async route => {
      if (route.request().resourceType() === 'image') {
        requested.push(route.request().url());
        await ready;
      }
      await route.continue();
    });
    await openApp(page);
    console.log('DP-218 browser timezone:', await page.evaluate(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    ));
    if (mode === 'dark') {
      await tabButton(page, '設定').click();
      await page.getByRole('button', { name: '☾ 深色', exact: true }).click();
      await tabButton(page, '日曆').click();
    }
    await expect(page.locator('.dp-preview')).toHaveAttribute('data-theme', 'manga');
    await expect(page.locator('.dp-preview')).toHaveAttribute('data-color-mode', mode);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const before = await Promise.all(['.cal-header', '.cal-month-scroll', '.dp-tabbar'].map(
      selector => page.locator(selector).boundingBox(),
    ));
    release();
    const decoded = await decodeBackgrounds(page, ['.cal-header', '.cal-month-scroll', '.dp-tabbar']);
    expect(decoded.every(surface => surface.images.length >= 2)).toBe(true);
    expect(decoded.flatMap(surface => surface.images).every(image => image.width > 0 && image.height > 0)).toBe(true);
    const after = await Promise.all(['.cal-header', '.cal-month-scroll', '.dp-tabbar'].map(
      selector => page.locator(selector).boundingBox(),
    ));
    expect(after).toEqual(before);

    const desktop = await page.evaluate(() => matchMedia(
      '(display-mode: browser) and (min-width: 900px) and (hover: hover) and (pointer: fine)',
    ).matches);
    const desk = await decodeBackgrounds(page, ['.dp-preview']);
    if (desktop) {
      expect(desk[0].images).toHaveLength(1);
      expect(desk[0].images[0].url.includes('desk-dark')).toBe(mode === 'dark');
    } else {
      expect(desk[0].images).toHaveLength(0);
      expect(requested.filter(url => /\/desk(?:-dark)?\.webp/.test(url))).toEqual([]);
    }

    const title = '手帳驗證：很長的共用行程標題仍保留原生編輯、時區與資料保存';
    await page.getByRole('button', { name: '新增', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: '新增行程', exact: true });
    await sheet.getByLabel('標題', { exact: true }).fill(title);
    await expect(sheet.getByLabel('時區', { exact: true })).toHaveValue('Asia/Taipei');
    const paper = await decodeBackgrounds(page, ['.cal-sheet']);
    expect(paper[0].images.length).toBeGreaterThan(0);
    await sheet.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    const stored = await page.evaluate(() => localStorage.getItem('daypop.user-data'));
    await tabButton(page, '搜尋').click();
    await page.getByRole('textbox', { name: '搜尋', exact: true }).fill('手帳驗證');
    await expect(page.locator('.search-result')).toContainText(title);
    await page.locator('.search-result').click();
    const edit = page.getByRole('dialog', { name: '編輯行程', exact: true });
    await expect(edit.getByLabel('標題', { exact: true })).toHaveValue(title);
    await edit.getByRole('button', { name: '取消', exact: true }).click();
    await reloadApp(page);
    expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(stored);
    await calendarViewButton(page, '列表').click();
    await expect(page.locator('.cal-agenda-item')).toContainText(title);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    clean();
  });
}

test('圖片損壞仍能保存行程；其他主題重載不請求手帳素材，偏好與原圖保留', async ({ page }) => {
  const clean = monitorBrowser(page);
  const requested: string[] = [];
  await page.route(ART, route => {
    if (route.request().resourceType() !== 'image') return route.continue();
    requested.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'image/webp', body: 'not an image' });
  });
  await openApp(page);
  console.log('DP-218 fallback timezone:', await page.evaluate(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  ));
  await expect.poll(() => requested.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增行程' });
  await dialog.getByLabel('標題', { exact: true }).fill('缺圖也保存');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const events = await page.evaluate(() => JSON.parse(localStorage.getItem('daypop.user-data')!).data.events);
  await tabButton(page, '設定').click();
  await page.locator('.dp-theme-card', { hasText: '極簡' }).click();
  await expect(page.locator('.dp-preview')).toHaveAttribute('data-theme', 'minimal');
  requested.length = 0;
  await reloadApp(page);
  await expect(page.locator('.dp-preview')).toHaveAttribute('data-theme', 'minimal');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  expect(requested).toEqual([]);
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('daypop.user-data')!).data);
  expect(restored.events).toEqual(events);
  expect(restored.preferences.themeId).toBe('minimal');
  await tabButton(page, '設定').click();
  await page.locator('.dp-theme-card', { hasText: '漫畫' }).click();
  await tabButton(page, '日曆').click();
  const pet = page.locator('button.cal-pet img');
  await expect(pet).toBeVisible();
  await expect(pet).toHaveAttribute('src', /moon-cat-idle.*\.(webp|png)/);
  expect(await pet.evaluate(image => ({
    filter: getComputedStyle(image).filter,
    opacity: getComputedStyle(image).opacity,
    blend: getComputedStyle(image).mixBlendMode,
  }))).toEqual({ filter: 'none', opacity: '1', blend: 'normal' });
  await calendarViewButton(page, '列表').click();
  await expect(page.locator('.cal-agenda-item')).toContainText('缺圖也保存');
  clean();
});
