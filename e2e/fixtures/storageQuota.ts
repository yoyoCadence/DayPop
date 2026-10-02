import type { Page } from '@playwright/test';

/** Fill only synthetic, unowned keys using native Chromium Storage methods. */
export function fillLocalStorageQuota(page: Page) {
  return page.evaluate(() => {
    const keys: string[] = [];
    const failures: { name: string; native: boolean }[] = [];
    let characters = 0;
    for (const size of [256 * 1024, 16 * 1024, 1024]) {
      const chunk = 'q'.repeat(size);
      let exhausted = false;
      for (let attempt = 0; attempt < 128; attempt += 1) {
        const key = `quota-test.fill.${keys.length}`;
        try {
          localStorage.setItem(key, chunk);
          keys.push(key);
          characters += key.length + chunk.length;
        } catch (error) {
          if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error;
          failures.push({ name: error.name, native: error instanceof DOMException });
          exhausted = true;
          break;
        }
      }
      if (!exhausted) throw new Error('Chromium quota was not reached within bounded test filling');
    }
    return { keys, characters, failures };
  });
}

/**
 * Close the gap `fillLocalStorageQuota` leaves (up to one 1 Ki chunk) down to
 * less than this 14-character key plus one character, which is smaller than
 * any write the App makes. Callers still assert the size they depend on.
 * Grows one synthetic key instead of adding many, and stays bounded.
 */
export function exhaustLocalStorageQuota(page: Page) {
  return page.evaluate(() => {
    const key = 'quota-test.pad';
    const failures: { step: number; name: string; native: boolean }[] = [];
    let value = '';
    for (const step of [64, 1]) {
      let exhausted = false;
      for (let attempt = 0; attempt < 128; attempt += 1) {
        try {
          localStorage.setItem(key, value + 'p'.repeat(step));
          value += 'p'.repeat(step);
        } catch (error) {
          if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error;
          failures.push({ step, name: error.name, native: error instanceof DOMException });
          exhausted = true;
          break;
        }
      }
      if (!exhausted) throw new Error('Chromium quota was not exhausted within bounded test padding');
    }
    return { key, characters: value.length, stored: localStorage.getItem(key)?.length ?? null, failures };
  });
}
