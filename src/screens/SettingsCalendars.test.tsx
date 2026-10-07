import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataProvider';
import type { DayPopRepository } from '../data/repository';
import { RemoteDataError } from '../data/supabaseRepository';
import { LegacyImportProvider } from '../legacy/LegacyImportProvider';
import { ThemeProvider } from '../theme/ThemeProvider';
import { MemoryStorage } from '../storage/browserStorage';
import { LocalDayPopRepository } from '../storage/localRepository';
import { readUserData } from '../storage/versionedStorage';
import { SettingsScaffoldScreen } from './SettingsScaffoldScreen';

/**
 * The 我的日曆 list and its dialog, driven through real clicks. Auth is stubbed
 * because the account block is not part of this section.
 */
vi.mock('../auth/authContext', () => ({
  useAuth: () => ({ user: null, configurationError: null, signOut: () => Promise.resolve() }),
}));

const updater = {
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
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(repository?: DayPopRepository) {
  await act(async () => {
    root.render(
      <DataProvider repository={repository}>
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
  });
}

async function type(input: Element | null | undefined, value: string) {
  const field = input as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set?.bind(field);
    setter?.(value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const rows = () => [...container.querySelectorAll('.cal-manage-row')];
const names = () => rows().map((row) => row.querySelector('.cal-manage-name')?.textContent);
const dialog = () => container.querySelector('.cal-manage-dialog');

describe('設定 我的日曆', () => {
  it('lists the bootstrap calendar with its colour', async () => {
    await render();

    expect(names()).toEqual(['我的日曆']);
    const dot = rows()[0]?.querySelector('.cal-manage-dot') as HTMLElement;
    expect(dot.style.background).toBe('rgb(240, 108, 92)');
  });

  it('adds a calendar through the dialog', async () => {
    await render();
    await click(container.querySelector('.cal-manage-add'));

    expect(dialog()?.getAttribute('aria-label')).toBe('新增日曆');
    await type(container.querySelector('.cal-manage-input'), '工作');
    await click(container.querySelector('.cal-manage-save'));

    expect(dialog()).toBeNull();
    expect(names()).toEqual(['我的日曆', '工作']);
  });

  it('opens an existing calendar prefilled and renames it', async () => {
    await render();
    await click(rows()[0]?.querySelector('.cal-manage-open'));

    expect(dialog()?.getAttribute('aria-label')).toBe('編輯日曆');
    const input = container.querySelector('.cal-manage-input') as HTMLInputElement;
    expect(input.value).toBe('我的日曆');

    await type(input, '個人');
    await click(container.querySelector('.cal-manage-save'));

    expect(names()).toEqual(['個人']);
  });

  it('toggles visibility without removing the calendar', async () => {
    await render();
    const toggle = () => rows()[0]?.querySelector('.cal-manage-toggle');
    expect(toggle()?.getAttribute('aria-pressed')).toBe('true');

    await click(toggle());

    expect(toggle()?.getAttribute('aria-pressed')).toBe('false');
    expect(names()).toEqual(['我的日曆']);
  });

  it('hides delete while only one calendar exists, and offers it once there are two', async () => {
    await render();
    await click(rows()[0]?.querySelector('.cal-manage-open'));
    expect(container.querySelector('.cal-manage-delete')).toBeNull();
    await click(container.querySelector('.cal-manage-cancel'));

    await click(container.querySelector('.cal-manage-add'));
    await type(container.querySelector('.cal-manage-input'), '工作');
    await click(container.querySelector('.cal-manage-save'));

    await click(rows()[1]?.querySelector('.cal-manage-open'));
    expect(container.querySelector('.cal-manage-delete')).not.toBeNull();

    await click(container.querySelector('.cal-manage-delete'));
    expect(names()).toEqual(['我的日曆']);
  });

  /**
   * DP-141, through the real provider. The repository refuses the first write
   * of each kind the way an account adapter does when the network drops.
   */
  it('keeps the dialog and its draft when a save or deletion is not confirmed, and applies it on retry', async () => {
    const repository = new LocalDayPopRepository(new MemoryStorage());
    await repository.load();
    const refuseOnce = <Args extends unknown[], Result>(real: (...args: Args) => Promise<Result>) => {
      let refused = false;
      return (...args: Args) => {
        if (refused) return real(...args);
        refused = true;
        return Promise.reject<Result>(new RemoteDataError('寫入日曆', new Error('network down')));
      };
    };
    repository.addCalendar = refuseOnce(repository.addCalendar.bind(repository));
    repository.deleteCalendar = refuseOnce(repository.deleteCalendar.bind(repository));
    await render(repository);

    await click(container.querySelector('.cal-manage-add'));
    await type(container.querySelector('.cal-manage-input'), '工作');
    await click(container.querySelector('.cal-manage-save'));
    expect(dialog()?.getAttribute('aria-label')).toBe('新增日曆');
    expect((container.querySelector('.cal-manage-input') as HTMLInputElement).value).toBe('工作');
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain('名稱與顏色已保留');
    expect(names()).toEqual(['我的日曆']);

    await click(container.querySelector('.cal-manage-save'));
    expect(dialog()).toBeNull();
    expect(names()).toEqual(['我的日曆', '工作']);

    await click(rows()[1]?.querySelector('.cal-manage-open'));
    await click(container.querySelector('.cal-manage-delete'));
    expect(dialog()?.getAttribute('aria-label')).toBe('編輯日曆');
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain('尚未確認刪除');
    expect(names()).toEqual(['我的日曆', '工作']);

    await click(container.querySelector('.cal-manage-delete'));
    expect(dialog()).toBeNull();
    expect(names()).toEqual(['我的日曆']);
  });
});

describe('設定 顯示偏好', () => {
  it('persists the theme id, display mode and semantic grid choice', async () => {
    await render();
    const buttons = () => [...container.querySelectorAll('button')];

    await click(buttons().find((button) => button.textContent?.includes('像素')));
    await click(buttons().find((button) => button.textContent?.includes('深色')));
    await click(buttons().find((button) => button.textContent?.includes('固定 6 列')));

    const stored = readUserData();
    expect(stored.status).toBe('ready');
    if (stored.status === 'ready') {
      expect(stored.envelope.data.preferences).toMatchObject({
        themeId: 'pixel',
        theme: 'dark',
        calendarGridMode: 'fixed-six',
      });
    }
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });
});
