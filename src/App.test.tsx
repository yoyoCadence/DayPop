import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { DataProvider } from './data/DataProvider';
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
    checkForUpdate: () => Promise.resolve(),
    updateNow: () => Promise.resolve(),
    dismissUpdate: () => {},
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
    root.render(
      <DataProvider>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </DataProvider>,
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

  it('renders recovery instead of the tabs when the data cannot be read', async () => {
    localStorage.setItem('daypop.user-data', 'not-json');

    await mount();

    expect(container.textContent).toContain('備份');
    expect(container.querySelector('.dp-tabbar')).toBeNull();
    expect(localStorage.getItem('daypop.user-data')).toBe('not-json');
  });
});
