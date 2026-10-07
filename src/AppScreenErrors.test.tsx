import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { DataProvider } from './data/DataProvider';
import { LegacyImportProvider } from './legacy/LegacyImportProvider';
import { AppUpdateProvider } from './pwa/AppUpdateProvider';
import { ThemeProvider } from './theme/ThemeProvider';

/**
 * DP-139, through the real App: one screen that throws while rendering must
 * not take the tab bar, the other tabs or the stored data with it.
 *
 * 搜尋 is the one replaced with a failing component. It lives in its own file
 * because `vi.mock` is hoisted and would break every other App test.
 */
vi.mock('./screens/SearchScreen', () => ({
  SearchScreen: () => {
    throw new Error('搜尋畫面壞了');
  },
}));
vi.mock('./auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./auth/authContext', () => ({
  useAuth: () => ({ user: null, configurationError: null, signOut: () => Promise.resolve() }),
}));
vi.mock('./auth/AuthDialog', () => ({ AuthDialog: () => null }));
vi.mock('./pwa/useAppUpdate', () => ({
  useAppUpdate: () => ({
    currentVersion: '0.0.0-test',
    currentRelease: null,
    availableRelease: null,
    checking: false,
    preparing: false,
    error: null,
    updateError: null,
    checkForUpdate: () => Promise.resolve(),
    updateNow: () => Promise.resolve(),
    dismissUpdate: () => {},
    whatsNew: null,
    checkResult: null,
    acknowledgeWhatsNew: () => {},
    clearCheckResult: () => {},
  }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  // React reports the caught error through console.error; expected here.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function openTab(name: string) {
  const button = [...container.querySelectorAll('.dp-tabbar button')].find((element) =>
    element.textContent?.includes(name),
  );
  if (!button) throw new Error(`missing tab ${name}`);
  await act(async () => {
    (button as HTMLButtonElement).click();
  });
}

describe('App when one screen fails to render', () => {
  it('keeps the tab bar and the other tabs usable, and leaves the stored data alone', async () => {
    await act(async () => {
      root.render(
        <AppUpdateProvider>
          <DataProvider>
            <LegacyImportProvider accountId={null}>
              <ThemeProvider>
                <App />
              </ThemeProvider>
            </LegacyImportProvider>
          </DataProvider>
        </AppUpdateProvider>,
      );
    });
    const stored = localStorage.getItem('daypop.user-data');
    expect(stored).not.toBeNull();

    await openTab('搜尋');
    expect(container.querySelector('.dp-tabbar')).not.toBeNull();
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect([...container.querySelectorAll('h1')].map((heading) => heading.textContent)).toEqual([
      '這個畫面暫時無法顯示',
    ]);
    expect(container.querySelector('main [role="alert"]')?.textContent).toContain('你的資料沒有被刪除');
    expect(container.querySelector('details')?.textContent).toContain('搜尋畫面壞了');

    // The way out the fallback points at really is there.
    await openTab('設定');
    expect([...container.querySelectorAll('h1')].map((heading) => heading.textContent)).toEqual(['設定']);
    expect(container.textContent).toContain('匯出');
    expect(container.querySelector('[role="alert"]')).toBeNull();

    await openTab('日曆');
    expect(container.textContent).toContain('今天');
    expect(container.querySelector('[role="alert"]')).toBeNull();

    // Coming back to the broken tab shows the fallback again, not a blank page.
    await openTab('搜尋');
    expect(container.querySelector('h1')?.textContent).toBe('這個畫面暫時無法顯示');
    expect(localStorage.getItem('daypop.user-data')).toBe(stored);
  });
});
