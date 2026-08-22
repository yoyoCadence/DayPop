import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadTextFile, readTextFile } from './dataTransferFiles';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('browser data transfer files', () => {
  it('reads an imported file as UTF-8 text', async () => {
    const file = new File(['日蹦備份'], 'daypop.json', { type: 'application/json' });

    await expect(readTextFile(file)).resolves.toBe('日蹦備份');
  });

  it('downloads through a temporary object URL and revokes it', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:daypop-test');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadTextFile('daypop.json', '{"ok":true}', 'application/json;charset=utf-8');

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download="daypop.json"]')).toBeNull();
    vi.advanceTimersByTime(1_500);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:daypop-test');
  });
});
