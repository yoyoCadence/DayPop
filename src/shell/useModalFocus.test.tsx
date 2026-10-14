import { act, StrictMode, useEffect, useRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useModalFocus, useModalLayerOpen } from './useModalFocus';

/**
 * DP-154. jsdom does not move focus on Tab, so these drive the edges the hook
 * is responsible for — wrapping, entering from outside, Escape, `inert`, and
 * where focus goes on close. `e2e/calendar-dialog-focus.spec.ts` presses real
 * keys in a browser.
 */

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

function Layer({ name, onEscape, children }: { name: string; onEscape?: () => void; children: ReactNode }) {
  const layer = useRef<HTMLDivElement>(null);
  useModalFocus(layer, { onEscape });
  return (
    <div ref={layer} data-layer={name}>
      {children}
    </div>
  );
}

function Page({ open, nested = false, onEscape = vi.fn(), onNestedEscape = vi.fn() }: {
  open: boolean;
  nested?: boolean;
  onEscape?: () => void;
  onNestedEscape?: () => void;
}) {
  return (
    <>
      <nav>
        <button type="button">分頁</button>
      </nav>
      <main>
        <button type="button">開啟</button>
      </main>
      {open && (
        <Layer name="lower" onEscape={onEscape}>
          <input aria-label="名稱" />
          <button type="button">儲存</button>
          <button type="button">取消</button>
        </Layer>
      )}
      {open && nested && (
        <Layer name="upper" onEscape={onNestedEscape}>
          <button type="button">只改這一次</button>
          <button type="button">套用全部</button>
        </Layer>
      )}
    </>
  );
}

const byText = (text: string) =>
  Array.from(container.querySelectorAll<HTMLElement>('button, input')).find(
    (element) => element.textContent === text || element.getAttribute('aria-label') === text,
  )!;

/** Dispatches a key at whatever has focus; returns whether it was prevented. */
function press(key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event.defaultPrevented;
}

describe('useModalFocus (DP-154)', () => {
  it('makes everything outside the layer inert while it is open, and releases only that', () => {
    const elsewhere = document.createElement('aside');
    elsewhere.setAttribute('inert', '');
    document.body.append(elsewhere);
    act(() => root.render(<Page open={false} />));
    expect(container.querySelectorAll('[inert]')).toHaveLength(0);

    act(() => root.render(<Page open />));
    expect(container.querySelector('nav')!.hasAttribute('inert')).toBe(true);
    expect(container.querySelector('main')!.hasAttribute('inert')).toBe(true);
    expect(container.querySelector('[data-layer]')!.hasAttribute('inert')).toBe(false);

    act(() => root.render(<Page open={false} />));
    expect(container.querySelectorAll('[inert]')).toHaveLength(0);
    // Already inert before the layer opened, so not the layer's to release.
    expect(elsewhere.hasAttribute('inert')).toBe(true);
    elsewhere.remove();
  });

  it('wraps Tab at either end and pulls focus back in from outside', () => {
    act(() => root.render(<Page open />));
    byText('取消').focus();
    expect(press('Tab')).toBe(true);
    expect(document.activeElement).toBe(byText('名稱'));

    expect(press('Tab', { shiftKey: true })).toBe(true);
    expect(document.activeElement).toBe(byText('取消'));

    // Between the ends the browser moves focus on its own.
    byText('名稱').focus();
    expect(press('Tab')).toBe(false);

    byText('開啟').focus();
    expect(press('Tab')).toBe(true);
    expect(document.activeElement).toBe(byText('名稱'));
  });

  it('keeps focus where it is when every control is disabled', () => {
    function Locked() {
      const layer = useRef<HTMLDivElement>(null);
      useModalFocus(layer);
      return (
        <div ref={layer}>
          <button type="button" disabled>
            保存中…
          </button>
        </div>
      );
    }
    act(() => root.render(<Locked />));
    (document.activeElement as HTMLElement | null)?.blur();
    expect(press('Tab')).toBe(true);
    expect(document.activeElement).toBe(document.body);
  });

  it('gives Escape to the topmost layer only, and only once an input method is done', () => {
    const onEscape = vi.fn();
    const onNestedEscape = vi.fn();
    act(() => root.render(<Page open nested onEscape={onEscape} onNestedEscape={onNestedEscape} />));
    // The upper layer made the lower one inert too.
    expect(container.querySelector('[data-layer="lower"]')!.hasAttribute('inert')).toBe(true);

    expect(press('Escape', { isComposing: true })).toBe(false);
    expect(onNestedEscape).not.toHaveBeenCalled();

    expect(press('Escape')).toBe(true);
    expect(onNestedEscape).toHaveBeenCalledTimes(1);
    expect(onEscape).not.toHaveBeenCalled();

    act(() => root.render(<Page open onEscape={onEscape} onNestedEscape={onNestedEscape} />));
    expect(container.querySelector('[data-layer="lower"]')!.hasAttribute('inert')).toBe(false);
    expect(container.querySelector('main')!.hasAttribute('inert')).toBe(true);
    press('Escape');
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('lets a control inside the layer claim Escape first (DP-155)', () => {
    const onEscape = vi.fn();
    function WithEditor() {
      const layer = useRef<HTMLDivElement>(null);
      useModalFocus(layer, { onEscape });
      return (
        <div ref={layer}>
          {/* Like 日詳情's inline title editor: Escape cancels the edit only. */}
          <input
            aria-label="待辦標題"
            onKeyDown={(event) => {
              if (event.key === 'Escape') event.stopPropagation();
            }}
          />
          <button type="button">完成</button>
        </div>
      );
    }
    act(() => root.render(<WithEditor />));
    byText('待辦標題').focus();
    press('Escape');
    expect(onEscape).not.toHaveBeenCalled();

    byText('完成').focus();
    press('Escape');
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('reports the layers the person opened, not notices, so a notice can wait (DP-156)', () => {
    const seen: boolean[] = [];
    function Watcher() {
      seen.push(useModalLayerOpen());
      return null;
    }
    function Notice() {
      const layer = useRef<HTMLDivElement>(null);
      useModalFocus(layer, { notice: true });
      return (
        <div ref={layer}>
          <button type="button">稍後提醒</button>
        </div>
      );
    }
    function Screen({ notice, dialog }: { notice: boolean; dialog: boolean }) {
      return (
        <>
          <Watcher />
          {notice && <Notice />}
          {dialog && (
            <Layer name="dialog">
              <button type="button">儲存</button>
            </Layer>
          )}
        </>
      );
    }
    act(() => root.render(<Screen notice={false} dialog={false} />));
    expect(seen.at(-1)).toBe(false);
    act(() => root.render(<Screen notice dialog={false} />));
    expect(seen.at(-1)).toBe(false);
    act(() => root.render(<Screen notice={false} dialog />));
    expect(seen.at(-1)).toBe(true);
    act(() => root.render(<Screen notice={false} dialog={false} />));
    expect(seen.at(-1)).toBe(false);
  });

  it('leaves Escape alone for a layer that does not close on it', () => {
    function Plain() {
      const layer = useRef<HTMLDivElement>(null);
      useModalFocus(layer);
      return (
        <div ref={layer}>
          <button type="button">好</button>
        </div>
      );
    }
    act(() => root.render(<Plain />));
    expect(press('Escape')).toBe(false);
  });

  it('moves focus in on open, and returns it to what had it on close', () => {
    act(() => root.render(<Page open={false} />));
    byText('開啟').focus();
    act(() => root.render(<Page open />));
    expect(document.activeElement).toBe(byText('名稱'));

    act(() => root.render(<Page open={false} />));
    expect(document.activeElement).toBe(byText('開啟'));
  });

  it('returns focus to what an earlier effect focused as the layer opened (DP-072, DP-155)', () => {
    // The week grid puts focus back on the dragged block in its own effect,
    // after the scope question has rendered but before its effect runs.
    function Grid({ asking }: { asking: boolean }) {
      const block = useRef<HTMLButtonElement>(null);
      useEffect(() => {
        if (asking) block.current?.focus();
      }, [asking]);
      return (
        <button ref={block} type="button">
          跨午夜夜班
        </button>
      );
    }
    function Week({ asking }: { asking: boolean }) {
      return (
        <>
          <Grid asking={asking} />
          {asking && (
            <Layer name="scope">
              <button type="button">只改這一次</button>
            </Layer>
          )}
        </>
      );
    }
    act(() => root.render(<Week asking={false} />));
    act(() => root.render(<Week asking />));
    expect(document.activeElement).toBe(byText('只改這一次'));
    act(() => root.render(<Week asking={false} />));
    expect(document.activeElement).toBe(byText('跨午夜夜班'));
  });

  it('does not move focus off an autoFocus control when StrictMode re-runs effects', () => {
    function AutoFocused() {
      const layer = useRef<HTMLDivElement>(null);
      useModalFocus(layer);
      return (
        <div ref={layer}>
          <button type="button">取消</button>
          <button type="button" autoFocus>
            取代資料
          </button>
        </div>
      );
    }
    act(() =>
      root.render(
        <StrictMode>
          <AutoFocused />
        </StrictMode>,
      ),
    );
    expect(document.activeElement).toBe(byText('取代資料'));
  });
});
