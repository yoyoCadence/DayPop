import { test } from '@playwright/test';
import { checkInstalledPageGestures, checkMobileDialogs } from './fixtures/mobileDialogs';

test('手機提醒與新增行程視窗適應寬度，只需上下捲動', async ({ page }) => {
  await checkMobileDialogs(page);
});

test('主畫面模式固定縮放且保留月曆手勢', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-chrome', 'Touch gesture coverage uses the mobile context');
  await checkInstalledPageGestures(page, true);
});
