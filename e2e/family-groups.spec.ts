import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, monitorBrowser, openApp, tabButton } from './support';

const USER = '00000000-0000-4000-8000-000000000030';
type FamilyHarnessWindow = Window & { __daypopFamilyServices?: Map<string, { loseNextResponse: boolean; calls: unknown[] }> };
async function login(page: Page) {
  const dialog = page.getByRole('dialog', { name: '保存你的日蹦資料' });
  await dialog.getByLabel('Email').fill(E2E_EMAIL);
  await dialog.getByLabel('密碼', { exact: true }).fill(E2E_PASSWORD);
  await dialog.getByRole('button', { name: '登入', exact: true }).click();
  await expect(dialog).toBeHidden();
}
async function audit(page: Page) {
  await page.locator('.dp-texture').evaluateAll(elements => elements.forEach(element => (element as HTMLElement).style.visibility = 'hidden'));
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations).toEqual([]);
  const contrasts = result.passes.find(item => item.id === 'color-contrast')?.nodes.length ?? 0;
  expect(contrasts).toBeGreaterThanOrEqual(5);
  await page.locator('.dp-texture').evaluateAll(elements => elements.forEach(element => (element as HTMLElement).style.visibility = ''));
}

test('家庭 owner 管理、失敗保留草稿、重發撤銷與解散，不改日曆資料', async ({ page }) => {
  const clean = monitorBrowser(page);
  await openApp(page, '/e2e/auth.html');
  console.log('family browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  await tabButton(page, '設定').click();
  await page.getByRole('button', { name: '登入使用家庭', exact: true }).click();
  await login(page);
  await tabButton(page, '設定').click();
  const before = await page.evaluate(() => ({ guest: localStorage.getItem('daypop.user-data'), account: localStorage.getItem('daypop.account-cache.00000000-0000-4000-8000-000000000030') }));
  await page.getByRole('button', { name: '管理家庭', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '家庭群組', exact: true });
  await dialog.getByLabel('群組名稱').fill('我們的家');
  await page.evaluate(userId => {
    (window as FamilyHarnessWindow).__daypopFamilyServices!.get(userId)!.loseNextResponse = true;
  }, USER);
  await dialog.getByRole('button', { name: '建立家庭', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('輸入內容已保留');
  await expect(dialog.getByLabel('群組名稱')).toHaveValue('我們的家');
  await dialog.getByRole('button', { name: '建立家庭', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '家庭成員（1／6）' })).toBeVisible();
  await dialog.getByLabel('受邀 Email').fill('family-e2e@example.test');
  await dialog.getByRole('button', { name: '產生邀請連結' }).click();
  const link = dialog.getByLabel('邀請連結（只限受邀 Email 接受）');
  const firstLink = await link.inputValue();
  expect(new URL(firstLink).hash).toMatch(/^#family-invite=[0-9a-f]{64}$/);
  const invitation = dialog.getByRole('list', { name: '最近邀請' }).getByRole('listitem').filter({ hasText: 'family-e2e@example.test' });
  await invitation.getByRole('button', { name: '重發連結' }).click();
  await expect(link).not.toHaveValue(firstLink);
  await expect(invitation).toHaveCount(1);
  await audit(page);
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  }
  await invitation.getByRole('button', { name: '撤銷邀請' }).click();
  await page.getByRole('dialog', { name: '撤銷邀請', exact: true }).getByRole('button', { name: '確認撤銷' }).click();
  await expect(invitation).toHaveCount(0);
  await dialog.getByRole('button', { name: '解散家庭', exact: true }).click();
  await page.getByRole('dialog', { name: '解散家庭', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  await dialog.getByRole('button', { name: '解散家庭', exact: true }).click();
  await page.getByRole('dialog', { name: '解散家庭', exact: true }).getByRole('button', { name: '確認解散' }).click();
  await expect(dialog.getByRole('button', { name: '建立家庭', exact: true })).toBeVisible();
  const after = await page.evaluate(() => ({ guest: localStorage.getItem('daypop.user-data'), account: localStorage.getItem('daypop.account-cache.00000000-0000-4000-8000-000000000030') }));
  expect(after).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '管理家庭', exact: true })).toBeFocused();
  clean();
});

test('取消登入會回到同一份家庭邀請，可再次登入後明確接受', async ({ page }) => {
  const clean = monitorBrowser(page);
  await openApp(page, `/e2e/auth.html#family-invite=${'c'.repeat(64)}`);
  console.log('invitation return browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  const invitation = page.getByRole('dialog', { name: '家庭邀請', exact: true });
  const authDialog = page.getByRole('dialog', { name: '保存你的日蹦資料', exact: true });
  await expect(invitation).toBeVisible();
  const before = await page.evaluate(() => ({ guest: localStorage.getItem('daypop.user-data'), pending: sessionStorage.getItem('daypop.pending-family-invitation') }));
  expect(before.pending).not.toBeNull();
  for (const close of ['button', 'escape'] as const) {
    await invitation.getByRole('button', { name: '登入以查看邀請' }).click();
    await expect(authDialog).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await authDialog.getByLabel('Email').fill(E2E_EMAIL);
    if (close === 'button') await authDialog.getByRole('button', { name: '關閉登入視窗' }).click();
    else await page.keyboard.press('Escape');
    await expect(invitation).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    expect(await invitation.evaluate(element => element.contains(document.activeElement))).toBe(true);
    expect(await page.evaluate(() => ({ guest: localStorage.getItem('daypop.user-data'), pending: sessionStorage.getItem('daypop.pending-family-invitation') }))).toEqual(before);
    expect(await page.evaluate(() => (window as FamilyHarnessWindow).__daypopFamilyServices!.size)).toBe(0);
  }
  await invitation.getByRole('button', { name: '登入以查看邀請' }).click();
  await login(page);
  const confirmation = page.getByRole('dialog', { name: '確認家庭邀請', exact: true });
  await expect(confirmation.getByRole('button', { name: '接受邀請' })).toBeVisible();
  expect(await page.evaluate(userId => (window as FamilyHarnessWindow).__daypopFamilyServices!.get(userId)!.calls, USER)).toEqual([]);
  await confirmation.getByRole('button', { name: '接受邀請' }).click();
  await expect(page.getByRole('status')).toContainText('已加入「家人的家庭」');
  expect(await page.evaluate(() => sessionStorage.getItem('daypop.pending-family-invitation'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(before.guest);
  clean();
});

test('邀請連結先登入再明確接受，成員只提供退出，不自動上傳遊客資料', async ({ page }) => {
  const clean = monitorBrowser(page);
  await openApp(page, `/e2e/auth.html#family-invite=${'c'.repeat(64)}`);
  const before = await page.evaluate(() => localStorage.getItem('daypop.user-data'));
  await page.getByRole('button', { name: '登入以查看邀請' }).click();
  await login(page);
  const invitation = page.getByRole('dialog', { name: '確認家庭邀請' });
  await expect(invitation.getByText('家人甲 邀請你加入「家人的家庭」。')).toBeVisible();
  expect(await page.evaluate(userId => {
    return (window as FamilyHarnessWindow).__daypopFamilyServices!.get(userId)!.calls.length;
  }, USER)).toBe(0);
  await audit(page);
  await invitation.getByRole('button', { name: '接受邀請' }).click();
  await expect(page.getByRole('status')).toContainText('已加入「家人的家庭」');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  expect(await page.evaluate(() => sessionStorage.getItem('daypop.pending-family-invitation'))).toBeNull();
  expect(await page.evaluate(() => location.hash)).toBe('');
  expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(before);
  await tabButton(page, '設定').click();
  await page.getByRole('button', { name: '管理家庭', exact: true }).click();
  const manager = page.getByRole('dialog', { name: '家庭群組', exact: true });
  await expect(manager.getByRole('button', { name: '退出家庭', exact: true })).toBeVisible();
  await expect(manager.getByRole('button', { name: '解散家庭', exact: true })).toHaveCount(0);
  await expect(manager.getByLabel('受邀 Email')).toHaveCount(0);
  await manager.getByRole('button', { name: '退出家庭', exact: true }).click();
  await page.getByRole('dialog', { name: '退出家庭', exact: true }).getByRole('button', { name: '確認退出' }).click();
  await expect(manager.getByRole('button', { name: '建立家庭', exact: true })).toBeVisible();
  clean();
});
