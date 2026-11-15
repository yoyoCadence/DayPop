import { test } from '@playwright/test';
import { checkPetCollection } from './fixtures/petCollection';
import { checkPetDirections } from './fixtures/petDirections';

test('三款 Blender 七態可解碼，真正 walk 動畫有不同影格', async ({ page }) => {
  await checkPetCollection(page);
});

test('新四款七態在 84px 可解碼，走路影格實際播放', async ({ page }) => {
  await checkPetDirections(page);
});
