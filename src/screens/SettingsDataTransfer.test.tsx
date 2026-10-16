import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataProvider';
import { buildJsonBackup, serializeJsonBackup } from '../domain/dataTransfer';
import { LegacyImportProvider } from '../legacy/LegacyImportProvider';
import { readUserData } from '../storage/versionedStorage';
import { ThemeProvider } from '../theme/ThemeProvider';
import { SettingsScaffoldScreen } from './SettingsScaffoldScreen';

const fileIo = vi.hoisted(() => ({
  download: vi.fn(),
  read: vi.fn<(file: File) => Promise<string>>(),
}));

vi.mock('../browser/dataTransferFiles', () => ({
  downloadTextFile: fileIo.download,
  readTextFile: fileIo.read,
}));

const authState = vi.hoisted(() => ({ user: null as { id: string; email: string } | null }));

vi.mock('../auth/authContext', () => ({
  useAuth: () => ({ user: authState.user, configurationError: null, signOut: () => Promise.resolve() }),
}));

const updater = {
  currentVersion: '0.3.0-test',
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
};

const ics = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//test//EN',
  'BEGIN:VEVENT',
  'UID:settings-import@example.com',
  'DTSTAMP:20260801T000000Z',
  'DTSTART:20260823T010000Z',
  'DTEND:20260823T020000Z',
  'SUMMARY:外部行程',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  authState.user = null;
  fileIo.download.mockReset();
  fileIo.read.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      <DataProvider>
        <LegacyImportProvider accountId={null}>
          <ThemeProvider>
            <SettingsScaffoldScreen updater={updater} onOpenAuth={vi.fn()} />
          </ThemeProvider>
        </LegacyImportProvider>
      </DataProvider>,
    );
  });
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error('element not found');
  await act(async () => {
    (element as HTMLElement).click();
    await Promise.resolve();
  });
}

async function choose(selector: string, file: File) {
  const input = container.querySelector(selector) as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(label));
}

describe('設定 資料備份', () => {
  it('renders the four canonical actions and downloads JSON plus ICS', async () => {
    await render();

    expect(button('匯出資料')).toBeDefined();
    expect(button('匯入資料')).toBeDefined();
    expect(button('匯出 .ics')).toBeDefined();
    expect(button('匯入 .ics')).toBeDefined();

    await click(button('匯出資料'));
    expect(fileIo.download).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^daypop-backup-\d{4}-\d{2}-\d{2}\.json$/),
      expect.any(String),
      'application/json;charset=utf-8',
    );
    const json = JSON.parse(fileIo.download.mock.calls[0]![1]);
    expect(json.appVersion).toBe('0.3.0-test');
    expect(json.data).not.toHaveProperty('eventAttachments');

    await click(button('匯出 .ics'));
    expect(fileIo.download).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^daypop-\d{4}-\d{2}-\d{2}\.ics$/),
      expect.stringContaining('BEGIN:VCALENDAR'),
      'text/calendar;charset=utf-8',
    );
  });

  it('previews a JSON replacement and writes only after confirmation', async () => {
    await render();
    const stored = readUserData();
    if (stored.status !== 'ready') throw new Error('guest data not ready');
    const backup = buildJsonBackup({
      ...stored.envelope.data,
      preferences: { ...stored.envelope.data.preferences, petName: '還原夥伴' },
    });
    fileIo.read.mockResolvedValueOnce(serializeJsonBackup(backup));

    await choose(
      '.data-transfer-json-input',
      new File(['ignored by mock'], 'my-backup.json', { type: 'application/json' }),
    );

    const dialog = container.querySelector('[role="dialog"][aria-label="匯入預覽"]');
    expect(dialog?.textContent).toContain('my-backup.json · 共 0 筆行程');
    expect(dialog?.textContent).toContain('確認前不會寫入');
    const beforeConfirm = readUserData();
    expect(
      beforeConfirm.status === 'ready' ? beforeConfirm.envelope.data.preferences.petName : '',
    ).not.toBe('還原夥伴');

    await click(button('取代資料'));

    expect(container.querySelector('[aria-label="匯入預覽"]')).toBeNull();
    const after = readUserData();
    expect(after.status === 'ready' ? after.envelope.data.preferences.petName : null).toBe(
      '還原夥伴',
    );
    expect(container.textContent).toContain('已從「my-backup.json」還原');
  });

  it('previews and appends an ICS event', async () => {
    await render();
    fileIo.read.mockResolvedValueOnce(ics);

    await choose(
      '.data-transfer-ics-input',
      new File(['ignored by mock'], 'calendar.ics', { type: 'text/calendar' }),
    );

    expect(container.textContent).toContain('calendar.ics · 共 1 筆行程');
    expect(container.textContent).toContain('外部行程');
    await click(button('匯入 1 筆'));

    const after = readUserData();
    expect(after.status === 'ready' ? after.envelope.data.events[0]?.title : null).toBe('外部行程');
  });

  it('reports an invalid file without opening a preview or changing data', async () => {
    await render();
    const before = localStorage.getItem('daypop.user-data');
    fileIo.read.mockResolvedValueOnce('{}');

    await choose(
      '.data-transfer-json-input',
      new File(['ignored by mock'], 'foreign.json', { type: 'application/json' }),
    );

    expect(container.querySelector('[aria-label="匯入預覽"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('不是 DayPop 備份');
    expect(localStorage.getItem('daypop.user-data')).toBe(before);
  });
});

describe('設定 上次匯出', () => {
  const guestKey = 'daypop.last-backup.guest';

  function lastBackupLine(): string {
    return container.querySelector('.data-backup-last')?.textContent ?? '';
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records the exported file and shows it in the display timezone, also after a remount', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T06:05:00.000Z'));
    await render();
    expect(lastBackupLine()).toBe('這台裝置還沒有匯出過備份。');
    expect(localStorage.getItem(guestKey)).toBeNull();

    await click(button('匯出資料'));

    const file = JSON.parse(fileIo.download.mock.calls[0]![1]);
    expect(JSON.parse(localStorage.getItem(guestKey)!)).toEqual({
      exportedAt: file.exportedAt,
      calendars: file.data.calendars.length,
      events: 0,
      todos: 0,
      stickers: 0,
      omittedAttachments: 0,
    });
    // The default preferences use Asia/Taipei, not the process timezone.
    expect(lastBackupLine()).toBe(
      '這台裝置上次匯出：2026/10/16 14:05 含 1 個日曆、0 筆行程、0 筆待辦、0 張貼圖與設定；不含附件。',
    );

    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(lastBackupLine()).toContain('這台裝置上次匯出：2026/10/16 14:05');
  });

  it('does not count an .ics export or a download that failed', async () => {
    await render();

    await click(button('匯出 .ics'));
    expect(localStorage.getItem(guestKey)).toBeNull();

    fileIo.download.mockImplementationOnce(() => {
      throw new Error('瀏覽器拒絕下載');
    });
    await click(button('匯出資料'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('瀏覽器拒絕下載');
    expect(localStorage.getItem(guestKey)).toBeNull();
    expect(lastBackupLine()).toBe('這台裝置還沒有匯出過備份。');
  });

  it('keeps a signed-in account apart from the guest record', async () => {
    const guestRecord = JSON.stringify({
      exportedAt: '2026-10-01T00:00:00.000Z',
      calendars: 1,
      events: 3,
      todos: 0,
      stickers: 0,
      omittedAttachments: 0,
    });
    localStorage.setItem(guestKey, guestRecord);
    authState.user = { id: 'account-a', email: 'a@example.com' };
    await render();
    // A guest backup is not a backup of this account.
    expect(lastBackupLine()).toBe('這台裝置還沒有匯出過這個帳號的備份。');

    await click(button('匯出資料'));
    expect(localStorage.getItem('daypop.last-backup.account.account-a')).not.toBeNull();
    expect(localStorage.getItem(guestKey)).toBe(guestRecord);
    expect(lastBackupLine()).toContain('這台裝置上次匯出：');
  });
});
