import { test } from '@playwright/test';
import { checkPetChoice } from './fixtures/petChoice';

test('設定切換五款夥伴、重載保留，v4 其他資料不變', async ({ page }) => { await checkPetChoice(page); });
