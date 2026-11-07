import { test } from '@playwright/test';
import { checkPetCollection } from './fixtures/petCollection';

test('三款 Blender 七態可解碼，真正 walk 動畫有不同影格', async ({ page }) => {
  await checkPetCollection(page);
});
