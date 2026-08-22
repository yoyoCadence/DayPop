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

vi.mock('../auth/authContext', () => ({
  useAuth: () => ({ user: null, configurationError: null, signOut: () => Promise.resolve() }),
}));

const updater = {
  currentVersion: '0.3.0-test',
  currentRelease: null,
  availableRelease: null,
  checking: false,
  preparing: false,
  error: null,
  checkForUpdate: () => Promise.resolve(),
  updateNow: () => Promise.resolve(),
  dismissUpdate: () => {},
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
