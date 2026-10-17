import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { DataProvider } from './data/DataProvider';
import { LegacyImportProvider } from './legacy/LegacyImportProvider';
import { AppUpdateProvider } from './pwa/AppUpdateProvider';
import { ThemeProvider } from './theme/ThemeProvider';

/**
 * One end-to-end mount of the real tree.
 *
 * Typecheck cannot catch a missing provider, and every screen now reads its
 * data through one, so this asserts the app actually boots and that the
 * fail-closed recovery gate still wins over the tabs.
 *
 * Auth and the update checker are stubbed: neither is part of this boundary,
 * and both would otherwise reach for network the test has no business making.
 */
vi.mock('./auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./auth/authContext', () => ({
  useAuth: () => ({ user: null }),
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
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount() {
  await act(async () => {
    // The same nesting as main.tsx, minus the stubbed AuthProvider.
    // `SessionDataProvider` supplies `LegacyImportProvider` in the real tree;
    // the 設定 tab reads it, so guest mode (`accountId: null`) stands in here.
    root.render(
      // `AppUpdateProvider` is outermost, as in main.tsx — DP-073 moved the
      // version check above the account-keyed subtree.
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
}

describe('App', () => {
  it('mounts the calendar tab with data from the provider', async () => {
    await mount();

    expect(container.querySelector('.dp-tabbar')).not.toBeNull();
    // The 日曆 tab renders its own header rather than a loading placeholder.
    expect(container.textContent).toContain('今天');
  });

  /**
   * DP-071. A screen reader navigates by landmark and heading before it reads
   * anything; nothing else in the suite would notice these disappearing.
   */
  it('gives every tab one main landmark and exactly one h1', async () => {
    await mount();

    for (const tab of ['日曆', '搜尋', '綜覽', '設定']) {
      const button = [...container.querySelectorAll('.dp-tabbar button')].find((element) =>
        element.textContent?.includes(tab),
      );
      await act(async () => {
        (button as HTMLButtonElement).click();
      });

      const mains = container.querySelectorAll('main');
      const headings = container.querySelectorAll('h1');

      expect({ tab, mains: mains.length, headings: headings.length }).toEqual({
        tab,
        mains: 1,
        headings: 1,
      });
      // The heading has to sit inside the landmark to be of any use.
      expect(mains[0]?.contains(headings[0]!)).toBe(true);
    }
  });

  /**
   * DP-163. Task numbers and the porting vocabulary are for the people building
   * DayPop; they had leaked into 設定, 日詳情 and the event form, where the
   * person using the App read "DP-014" and "原稿".
   */
  it('shows no task numbers or porting notes on any tab or sheet', async () => {
    await mount();
    const engineering = /DP-\d{3}|原稿|搬移|domain|scaffold/;
    const click = async (element: Element | null | undefined) => {
      await act(async () => {
        (element as HTMLElement).click();
      });
    };
    const tab = (name: string) =>
      [...container.querySelectorAll('.dp-tabbar button')].find((button) =>
        button.textContent?.includes(name),
      );
    const screens: [string, string][] = [];
    const record = (label: string) => screens.push([label, container.textContent ?? '']);

    for (const name of ['日曆', '搜尋', '綜覽', '設定']) {
      await click(tab(name));
      record(name);
    }
    await click(tab('日曆'));
    await click(container.querySelector('.cal-fab'));
    record('新增行程');
    await click(
      [...container.querySelectorAll('[aria-label="新增類型"] button')].find(
        (button) => button.textContent === '待辦',
      ),
    );
    record('新增待辦');
    await click(container.querySelector('.cal-sheet-bar button'));
    await click(container.querySelector('[data-date-key]'));
    record('日詳情');
    await click(container.querySelector('.cal-day-done'));
    await click(container.querySelector('.cal-pet'));
    record('寵物問候');
    await click(
      [...container.querySelectorAll('.cal-pet-bubble button')].find((button) => button.textContent === '看待辦'),
    );
    record('寵物待辦');

    expect(screens.map(([label]) => label)).toEqual([
      '日曆', '搜尋', '綜覽', '設定', '新增行程', '新增待辦', '日詳情', '寵物問候', '寵物待辦',
    ]);
    for (const [label, text] of screens) {
      expect({ label, found: text.match(engineering)?.[0] ?? null }).toEqual({ label, found: null });
    }
  });

  /**
   * DP-169. The原檔 greets once, then the pet opens straight on the lists. The
   * calendar screen unmounts on every tab switch, so `App` has to remember it.
   */
  it('lets the pet greet once per session, across tab switches', async () => {
    await mount();
    const click = async (element: Element | null | undefined) => {
      if (!element) throw new Error('element not found');
      await act(async () => {
        (element as HTMLElement).click();
      });
    };
    const tab = (name: string) =>
      [...container.querySelectorAll('.dp-tabbar button')].find((button) =>
        button.textContent?.includes(name),
      );

    await click(container.querySelector('.cal-pet'));
    expect(container.querySelector('.cal-pet-greeting')).not.toBeNull();
    await click(container.querySelector('.cal-pet-bubble-close'));
    await click(tab('設定'));
    await click(tab('日曆'));
    await click(container.querySelector('.cal-pet'));
    expect(container.querySelector('.cal-pet-greeting')).toBeNull();
    expect(container.querySelector('.cal-pet-heading')?.textContent).toBe('📋 今日待辦');
  });

  it('renders recovery instead of the tabs when the data cannot be read', async () => {
    localStorage.setItem('daypop.user-data', 'not-json');

    await mount();

    expect(container.textContent).toContain('備份');
    expect(container.querySelector('.dp-tabbar')).toBeNull();
    expect(localStorage.getItem('daypop.user-data')).toBe('not-json');
  });
});
