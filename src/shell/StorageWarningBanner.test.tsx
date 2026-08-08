import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StorageWarningBanner } from './StorageWarningBanner';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('StorageWarningBanner', () => {
  it('warns that guest memory-only edits disappear', () => {
    act(() => {
      root.render(<StorageWarningBanner reason="儲存空間不可用。" />);
    });

    expect(container.textContent).toContain('這次的變更不會被保存');
    expect(container.textContent).toContain('關掉之後就會消失');
  });

  it('does not claim confirmed account rows were lost when only the cache is unavailable', () => {
    act(() => {
      root.render(<StorageWarningBanner reason="儲存空間不可用。" accountBacked />);
    });

    expect(container.textContent).toContain('這台裝置無法保存快取');
    expect(container.textContent).toContain('帳號資料仍保存在雲端');
    expect(container.textContent).not.toContain('這次的變更不會被保存');
  });
});
