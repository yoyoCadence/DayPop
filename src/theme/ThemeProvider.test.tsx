import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataProvider';
import { createEmptyUserData } from '../domain/types';
import { writeUserData } from '../storage/versionedStorage';
import { ThemeProvider } from './ThemeProvider';
import { useTheme } from './themeContext';

let container: HTMLDivElement;
let root: Root;
let dark = true;
let changeListener: (() => void) | null = null;

function Probe() {
  const theme = useTheme();
  return (
    <div data-mode={theme.mode} data-resolved={theme.resolvedMode}>
      {theme.themeId}
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  dark = true;
  changeListener = null;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      get matches() {
        return dark;
      },
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => {
        changeListener = listener;
      },
      removeEventListener: () => {
        changeListener = null;
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    })),
  });
  document.head.insertAdjacentHTML('beforeend', '<meta name="theme-color" content="#ffffff">');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.querySelector('meta[name="theme-color"]')?.remove();
  vi.restoreAllMocks();
});

describe('ThemeProvider', () => {
  it('uses saved preferences and follows live system colour-scheme changes', async () => {
    const data = createEmptyUserData();
    data.preferences.theme = 'system';
    data.preferences.themeId = 'warm';
    writeUserData(data, 0);

    await act(async () => {
      root.render(
        <DataProvider>
          <ThemeProvider><Probe /></ThemeProvider>
        </DataProvider>,
      );
    });

    const probe = container.querySelector('[data-mode]');
    expect(probe?.getAttribute('data-mode')).toBe('system');
    expect(probe?.getAttribute('data-resolved')).toBe('dark');
    expect(probe?.textContent).toBe('warm');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content'))
      .toBe('#241d17');

    dark = false;
    await act(async () => changeListener?.());

    expect(probe?.getAttribute('data-resolved')).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content'))
      .toBe('#f4ede1');
  });
});
