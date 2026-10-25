import { expect, test } from '@playwright/test';
import { checkPetJump, jumpImage, jumpReady, openJumpFixture, storedJumpTodo } from './fixtures/petJump';
import { agendaRow, monitorBrowser } from './support';

test('待辦確認完成才單次 jump，取消／重載不播，焦點／60px 幾何與資料保存不變', async ({ page }) => {
  await checkPetJump(page);
});

test('減少動態只用 PNG，完成計時後恢復動態不補播 jump', async ({ page }) => {
  const clean = monitorBrowser(page);
  const requests: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'image' && /jump.*webp/.test(request.url())) requests.push(request.url()); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openJumpFixture(page); await jumpReady(page, /idle.*png/);
  await agendaRow(page, '完成回饋').click(); await jumpReady(page, /idle.*png/);
  expect((await storedJumpTodo(page)).completedAt).not.toBeNull();
  await page.clock.fastForward(1000);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await jumpReady(page, /idle.*webp/);
  expect(requests).toEqual([]);
  clean();
});

test('jump 解碼前暫藏會丟棄，不在恢復或舊圖片完成時補播', async ({ page }) => {
  const clean = monitorBrowser(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let requested = 0;
  await page.route(/moon-cat-jump.*webp/, async route => {
    if (route.request().resourceType() !== 'image') return route.continue();
    requested++;
    await pending; await route.continue();
  });
  try {
    await openJumpFixture(page); await jumpReady(page, /idle.*webp/);
    await agendaRow(page, '完成回饋').click();
    await expect.poll(() => requested).toBe(1);
    const quick = page.getByRole('textbox', { name: '快速新增', exact: true });
    await quick.focus(); await expect(jumpImage(page)).toHaveCount(0);
    await quick.blur(); await jumpReady(page, /idle.*webp/);
    release(); await jumpReady(page, /idle.*webp/);
    expect(requested).toBe(1);
    expect((await storedJumpTodo(page)).completedAt).not.toBeNull();
  } finally { release(); }
  clean();
});

test('首次 jump 圖片損壞會回健康 idle，完成資料不回滾', async ({ page }) => {
  const clean = monitorBrowser(page);
  let requested = 0;
  await page.route(/moon-cat-jump.*webp/, async route => {
    if (route.request().resourceType() !== 'image') return route.continue();
    requested++;
    await route.fulfill({ status: 200, contentType: 'image/webp', body: 'invalid jump' });
  });
  await openJumpFixture(page); await jumpReady(page, /idle.*webp/);
  await agendaRow(page, '完成回饋').click();
  await expect.poll(() => requested).toBe(1); await jumpReady(page, /idle.*webp/);
  expect((await storedJumpTodo(page)).completedAt).not.toBeNull();
  clean();
});
