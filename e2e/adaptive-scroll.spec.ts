import { test } from '@playwright/test';
import { checkAdaptiveScroll } from './fixtures/adaptiveScroll';
import { monitorBrowser } from './support';

test('自動列數滑動中固定幾何，停穩後換列不回跳且資料不變', async ({ page }) => {
  const clean = monitorBrowser(page);
  await checkAdaptiveScroll(page);
  clean();
});
