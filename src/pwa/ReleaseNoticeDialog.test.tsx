import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReleaseNoticeDialog, type ReleaseNotice } from './ReleaseNoticeDialog';

const RELEASE = {
  version: '0.4.1',
  releasedAt: '2026-09-30',
  title: '更新公告與檢查回饋',
  changes: ['第一件事', '第二件事'],
};

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

function show(notice: ReleaseNotice, onClose = vi.fn()) {
  act(() => root.render(<ReleaseNoticeDialog notice={notice} onClose={onClose} />));
  const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
  return { dialog, onClose, items: [...dialog.querySelectorAll('li')].map((li) => li.textContent) };
}

describe('ReleaseNoticeDialog', () => {
  it("announces the version now running, with its notes, and closes on 知道了", () => {
    const { dialog, onClose, items } = show({ kind: 'whats-new', release: RELEASE });
    expect(dialog.textContent).toContain('已更新 · v0.4.1');
    expect(dialog.querySelector('h2')?.textContent).toBe('更新公告與檢查回饋');
    expect(items).toEqual(['第一件事', '第二件事']);

    const button = dialog.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toBe('知道了');
    expect(document.activeElement).toBe(button);
    act(() => button.click());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('answers 已是最新 with the running version and its notes', () => {
    const { dialog, items } = show({
      kind: 'check',
      currentVersion: '0.4.1',
      result: { kind: 'latest', release: RELEASE },
    });
    expect(dialog.querySelector('h2')?.textContent).toBe('目前已是最新版本');
    expect(dialog.textContent).toContain('v0.4.1「更新公告與檢查回饋」');
    expect(items).toEqual(['第一件事', '第二件事']);
  });

  it('answers 已是最新 without notes when the answer was an older version', () => {
    // A stale cache in front of version.json: still "nothing newer", but those
    // notes belong to another version and are not shown as this one's.
    const { dialog, items } = show({
      kind: 'check',
      currentVersion: '0.4.1',
      result: { kind: 'latest', release: null },
    });
    expect(dialog.textContent).toContain('v0.4.1 就是最新版');
    expect(items).toEqual([]);
    expect(dialog.querySelector('h3')).toBeNull();
  });

  it('says why a check failed', () => {
    const { dialog, items } = show({
      kind: 'check',
      currentVersion: '0.4.1',
      result: { kind: 'failed', message: 'HTTP 503' },
    });
    expect(dialog.querySelector('h2')?.textContent).toBe('暫時無法檢查更新');
    expect(dialog.textContent).toContain('HTTP 503');
    expect(items).toEqual([]);
  });
});
