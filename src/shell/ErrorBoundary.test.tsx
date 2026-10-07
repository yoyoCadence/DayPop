import { act } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenErrorFallback } from '../screens/ScreenErrorFallback';
import { ErrorBoundary } from './ErrorBoundary';
import { RootErrorFallback } from './RootErrorFallback';

/**
 * DP-139. A render error used to unmount the whole React tree and leave a
 * blank page; these pin what the user gets instead.
 */
let container: HTMLDivElement;
let root: Root;
let broken: boolean;

function Screen() {
  if (broken) throw new Error('畫面元件壞了');
  return <p className="screen-content">正常內容</p>;
}

beforeEach(() => {
  broken = true;
  // React reports every caught error through console.error; the report is
  // expected here and would otherwise drown the test output.
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

const button = (label: string) =>
  [...container.querySelectorAll('button')].find((item) => item.textContent === label);

describe('ErrorBoundary with the screen fallback', () => {
  function render(key: string, reload = vi.fn(), settingsHint = true) {
    act(() =>
      root.render(
        <div className="outside">
          <span className="tab-bar">分頁列</span>
          <ErrorBoundary
            key={key}
            fallback={(caught) => <ScreenErrorFallback {...caught} settingsHint={settingsHint} onReload={reload} />}
          >
            <Screen />
          </ErrorBoundary>
        </div>,
      ),
    );
    return reload;
  }

  it('renders its children untouched while nothing throws', () => {
    broken = false;
    render('cal');
    expect(container.querySelector('.screen-content')?.textContent).toBe('正常內容');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('replaces only the failed screen, says the data is intact and keeps the rest of the App mounted', () => {
    render('cal');
    expect(container.querySelector('.screen-content')).toBeNull();
    expect(container.querySelector('.tab-bar')?.textContent).toBe('分頁列');
    expect(container.querySelector('h1')?.textContent).toBe('這個畫面暫時無法顯示');
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('你的資料沒有被刪除');
    expect(container.textContent).toContain('「設定」匯出備份');
    expect(container.querySelector('details')?.textContent).toContain('畫面元件壞了');
  });

  it('does not point at 設定 when 設定 itself is the screen that failed', () => {
    render('settings', vi.fn(), false);
    expect(container.textContent).not.toContain('「設定」匯出備份');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('你的資料沒有被刪除');
  });

  it('再試一次 renders the screen again, and shows the fallback again if it still throws', () => {
    render('cal');
    act(() => button('再試一次')!.click());
    expect(container.querySelector('h1')?.textContent).toBe('這個畫面暫時無法顯示');
    broken = false;
    act(() => button('再試一次')!.click());
    expect(container.querySelector('.screen-content')?.textContent).toBe('正常內容');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('a different key (another tab) starts clean instead of inheriting the error', () => {
    render('cal');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    broken = false;
    render('settings');
    expect(container.querySelector('.screen-content')?.textContent).toBe('正常內容');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('重新載入 App asks for a reload and nothing else', () => {
    const reload = render('cal');
    act(() => button('重新載入 App')!.click());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(container.querySelector('h1')?.textContent).toBe('這個畫面暫時無法顯示');
  });

  it('catches an error from a portal the screen opened, the way sheets and dialogs render', () => {
    function Sheet(): never {
      throw new Error('sheet 壞了');
    }
    function ScreenWithSheet() {
      // `ViewportLayer` portals sheets out of the screen's DOM; they are still
      // the screen's React children, which is what the boundary follows.
      return createPortal(<Sheet />, document.body);
    }
    act(() =>
      root.render(
        <ErrorBoundary fallback={(caught) => <ScreenErrorFallback {...caught} settingsHint onReload={vi.fn()} />}>
          <ScreenWithSheet />
        </ErrorBoundary>,
      ),
    );
    expect(container.querySelector('h1')?.textContent).toBe('這個畫面暫時無法顯示');
    expect(container.querySelector('details')?.textContent).toContain('sheet 壞了');
  });

  it('wraps a thrown non-Error so the fallback always has a message to show', () => {
    function ThrowsString(): never {
      throw '字串錯誤';
    }
    act(() =>
      root.render(
        <ErrorBoundary fallback={(caught) => <ScreenErrorFallback {...caught} settingsHint onReload={vi.fn()} />}>
          <ThrowsString />
        </ErrorBoundary>,
      ),
    );
    expect(container.querySelector('details')?.textContent).toContain('字串錯誤');
  });
});

describe('ErrorBoundary with the root fallback', () => {
  it('explains the failed start without any shell or theme, and offers a reload', () => {
    const reload = vi.fn();
    act(() =>
      root.render(
        <ErrorBoundary fallback={(caught) => <RootErrorFallback {...caught} onReload={reload} />}>
          <Screen />
        </ErrorBoundary>,
      ),
    );
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.querySelector('h1')?.textContent).toBe('日蹦暫時無法啟動');
    expect(alert?.textContent).toContain('資料沒有被刪除');
    expect(alert?.querySelector('details')?.textContent).toContain('畫面元件壞了');
    act(() => button('重新載入')!.click());
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
