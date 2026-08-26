import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataProvider';
import { LegacyImportProvider } from '../legacy/LegacyImportProvider';
import { ThemeProvider } from '../theme/ThemeProvider';
import { createEmptyUserData } from '../domain/types';
import { readUserData, writeUserData } from '../storage/versionedStorage';
import { SettingsScaffoldScreen } from './SettingsScaffoldScreen';

/**
 * 設定的「桌寵」與「一般」兩張卡片（DP-014 這一段的搬移）。
 * 每一項都走真實點擊／輸入，並確認值真的落到保存的偏好裡 ——
 * 這一段最主要的風險就是控制項看起來有反應但沒有保存。
 * Auth 被 stub 掉，帳號區塊不屬於這一段。
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
  checkForUpdate: () => Promise.resolve(),
  updateNow: () => Promise.resolve(),
  dismissUpdate: () => {},
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

/** React 把 `onBlur` 掛在會冒泡的 `focusout` 上，所以不能派送原生的 `blur`。 */
async function blur(element: Element | null | undefined) {
  await act(async () => {
    (element as HTMLElement).dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

async function selectOption(element: Element | null | undefined, value: string) {
  const field = element as HTMLSelectElement;
  await act(async () => {
    field.value = value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const petToggle = () => container.querySelector('.set-pref-toggle');
const petNameInput = () => container.querySelector('#pet-name') as HTMLInputElement;
const timezoneSelect = () => container.querySelector('#default-timezone') as HTMLSelectElement;
/** 一般卡的第 n 列（0 = 月曆列數、1 = 每週起始日、2 = 預設時區）。 */
const generalRow = (index: number) =>
  container.querySelectorAll('.set-pref-rows .set-pref-row')[index];
const pressed = (buttons: NodeListOf<Element> | Element[]) =>
  [...buttons]
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.textContent);

function savedPreferences() {
  const stored = readUserData();
  if (stored.status !== 'ready') throw new Error(`storage not ready: ${stored.status}`);
  return stored.envelope.data.preferences;
}

describe('設定 桌寵', () => {
  it('顯示桌寵開關預設開啟，關掉後保存為 false', async () => {
    await render();
    expect(petToggle()?.getAttribute('aria-pressed')).toBe('true');

    await click(petToggle());

    expect(petToggle()?.getAttribute('aria-pressed')).toBe('false');
    expect(savedPreferences().petEnabled).toBe(false);
  });

  it('寵物名字帶入已保存的值並寫回 trim 後的名字', async () => {
    await render();
    expect(petNameInput().value).toBe('摩卡');

    await type(petNameInput(), '  小黑  ');

    // 畫面保留未 trim 的草稿，保存的是 trim 後的值。
    expect(petNameInput().value).toBe('  小黑  ');
    expect(savedPreferences().petName).toBe('小黑');
  });

  it('清空名字不會保存空字串，離開欄位後還原成已保存的值', async () => {
    await render();
    await type(petNameInput(), '小黑');
    expect(savedPreferences().petName).toBe('小黑');

    await type(petNameInput(), '   ');

    // domain 的 petName 不接受空字串，所以這一步不能寫入。
    expect(savedPreferences().petName).toBe('小黑');

    await blur(petNameInput());
    expect(petNameInput().value).toBe('小黑');
  });
});

describe('設定 一般', () => {
  it('每週起始日切換到週一並保存', async () => {
    await render();
    const buttons = () => generalRow(1)!.querySelectorAll('.set-pref-segment-button');
    expect(pressed(buttons())).toEqual(['日']);

    await click([...buttons()][1]);

    expect(pressed(buttons())).toEqual(['一']);
    expect(savedPreferences().weekStartsOn).toBe(1);
  });

  it('月曆列數留在一般卡的第一列並保存選擇', async () => {
    await render();
    const buttons = () => generalRow(0)!.querySelectorAll('.set-pref-segment-button');
    expect(pressed(buttons())).toEqual(['自動 4–6 列']);

    await click([...buttons()][1]);

    expect(savedPreferences().calendarGridMode).toBe('fixed-six');
  });

  it('預設時區帶入已保存的值並保存新選擇', async () => {
    await render();
    expect(timezoneSelect().value).toBe('Asia/Taipei');

    await selectOption(timezoneSelect(), 'Europe/London');

    expect(savedPreferences().timezone).toBe('Europe/London');
  });

  it('清單外的已保存時區會被補進選項，不會顯示空白', async () => {
    // legacy 匯入與 .ics 匯入都可能帶進原稿 11 個選項以外的 IANA 時區。
    const seeded = createEmptyUserData();
    writeUserData({ ...seeded, preferences: { ...seeded.preferences, timezone: 'Pacific/Auckland' } }, 0);

    await render();

    const values = [...timezoneSelect().options].map((option) => option.value);
    expect(values).toContain('Pacific/Auckland');
    expect(timezoneSelect().value).toBe('Pacific/Auckland');
  });
});
