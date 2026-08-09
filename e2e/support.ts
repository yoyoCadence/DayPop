import { expect, type Page } from '@playwright/test';

export const E2E_EMAIL = 'daypop-e2e@example.test';
export const E2E_PASSWORD = 'daypop-e2e-password';

/** Collects browser errors without hiding them behind a successful UI assertion. */
export function monitorBrowser(page: Page) {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(message.type() + ': ' + message.text());
    }
  });
  page.on('pageerror', (error) => problems.push('pageerror: ' + error.message));
  return () => expect(problems, 'browser console must stay clean').toEqual([]);
}

export function tabButton(page: Page, name: '日曆' | '搜尋' | '綜覽' | '設定') {
  return page
    .getByRole('navigation', { name: '主導覽' })
    .getByRole('button', { name, exact: true });
}

export function calendarViewButton(page: Page, name: '月' | '週' | '列表') {
  return page
    .getByRole('group', { name: '檢視方式' })
    .getByRole('button', { name, exact: true });
}

export function agendaRow(page: Page, title: string) {
  return page.locator('.cal-agenda-item').filter({ hasText: title });
}

export async function openApp(page: Page, path = '/') {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.dp-viewport')).toBeVisible();
}

export async function reloadApp(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.dp-viewport')).toBeVisible();
}

export async function localTodayKey(page: Page): Promise<string> {
  return page.evaluate(() => {
    const now = new Date();
    const year = String(now.getFullYear()).padStart(4, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  });
}
