import { test } from '@playwright/test';
import { checkPetAutonomy } from './fixtures/petAutonomy';

test('新夥伴散步避開控制項，拖移交接、暫停、睡眠與資料保持正確', async ({ page }) => {
  await checkPetAutonomy(page);
});
for (const kind of ['marshmallow_cat', 'peach_bunny'] as const) {
  test(`${kind} 會真正散步且不寫入位置`, async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-chrome', 'Same renderer/asset contract already covers desktop');
    await checkPetAutonomy(page, kind, false);
  });
}
