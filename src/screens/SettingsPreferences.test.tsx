import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataProvider';
import type { DayPopRepository } from '../data/repository';
import { LocalDayPopRepository } from '../storage/localRepository';
import { LegacyImportProvider } from '../legacy/LegacyImportProvider';
import { ThemeProvider } from '../theme/ThemeProvider';
import { createEmptyUserData } from '../domain/types';
import { readUserData, writeUserData } from '../storage/versionedStorage';
import { SettingsScaffoldScreen } from './SettingsScaffoldScreen';
import { zoneOffsetLabel } from './timezoneOptions';

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

  it('寵物名字帶入已保存的值，離開欄位時寫回 trim 後的名字', async () => {
    await render();
    expect(petNameInput().value).toBe('摩卡');

    await type(petNameInput(), '  小黑  ');

    // 打字期間只更新草稿，還沒送出。
    expect(petNameInput().value).toBe('  小黑  ');
    expect(savedPreferences().petName).toBe('摩卡');

    await blur(petNameInput());

    expect(savedPreferences().petName).toBe('小黑');
    expect(petNameInput().value).toBe('小黑');
  });

  it('清空名字不會保存空字串，離開欄位後還原成已保存的值', async () => {
    await render();
    await type(petNameInput(), '小黑');
    await blur(petNameInput());
    expect(savedPreferences().petName).toBe('小黑');

    await type(petNameInput(), '   ');
    await blur(petNameInput());

    // domain 的 petName 不接受空字串，所以整個草稿放棄，欄位還原。
    expect(savedPreferences().petName).toBe('小黑');
    expect(petNameInput().value).toBe('小黑');
  });
});

/**
 * `DataProvider` 沒有樂觀更新，`data.preferences` 會落後尚未回應的寫入。
 * 這個 adapter 把 `updatePreferences` 卡住不回應，重現遠端帳號的情況：
 * 打字期間畫面拿到的 `preferences.petName` 還是送出前的舊值。
 */
class PendingPreferencesRepository extends LocalDayPopRepository {
  readonly sent: string[] = [];
  #release: (() => void)[] = [];

  override updatePreferences(patch: Parameters<LocalDayPopRepository['updatePreferences']>[0]) {
    if (typeof patch.petName === 'string') this.sent.push(patch.petName);
    return new Promise<Awaited<ReturnType<LocalDayPopRepository['updatePreferences']>>>((resolve) => {
      this.#release.push(() => resolve(super.updatePreferences(patch)));
    });
  }

  /**
   * 依序放行。DP-062 的佇列是序列化的：前一筆回應之前，下一筆根本不會呼叫到
   * repository，所以每放行一筆就要讓 microtask 跑完，下一筆才會出現。
   */
  async flush() {
    for (let guard = 0; this.#release.length > 0 && guard < 20; guard += 1) {
      this.#release.shift()?.();
      await act(async () => {});
    }
  }
}

describe('設定 桌寵（寫入尚未回應時）', () => {
  it('同一次編輯裡的中間值不會被送出，只送最終值', async () => {
    const repository = new PendingPreferencesRepository();
    await render(repository);

    // 「摩卡」→ 刪成「摩」→ 立刻補回「摩卡」，中途不離開欄位。
    await type(petNameInput(), '摩');
    await type(petNameInput(), '摩卡');
    await blur(petNameInput());

    // 中間值「摩」不會進到佇列，所以不可能變成最後保存的值。
    expect(repository.sent).toEqual(['摩卡']);

    await repository.flush();
    expect(savedPreferences().petName).toBe('摩卡');
  });

  it('前一次寫入還沒回應時，下一次編輯照樣送出且最後一次獲勝', async () => {
    const repository = new PendingPreferencesRepository();
    await render(repository);

    await type(petNameInput(), '小黑');
    await blur(petNameInput());

    // 第一次寫入還卡著，所以 preferences.petName 仍是送出前的「摩卡」，
    // 欄位顯示的也是它。若拿這個舊值去比對就會漏送第二次編輯。
    expect(repository.sent).toEqual(['小黑']);
    expect(savedPreferences().petName).toBe('摩卡');
    expect(petNameInput().value).toBe('摩卡');

    await type(petNameInput(), '小白');
    await blur(petNameInput());

    await repository.flush();

    // 兩次編輯都送到了 repository，順序與呼叫順序一致，最後一次獲勝。
    expect(repository.sent).toEqual(['小黑', '小白']);
    expect(savedPreferences().petName).toBe('小白');
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

  it('有夏令時間的時區依當下日期顯示 offset，不是寫死的那個', () => {
    const summer = new Date('2026-08-26T12:00:00Z');
    const winter = new Date('2026-01-15T12:00:00Z');

    // 原稿把這四個寫死成 -8／-5／+0／+11，一年裡有一半是錯的。
    expect(zoneOffsetLabel('America/Los_Angeles', summer)).toBe('GMT-7');
    expect(zoneOffsetLabel('America/Los_Angeles', winter)).toBe('GMT-8');
    expect(zoneOffsetLabel('America/New_York', summer)).toBe('GMT-4');
    expect(zoneOffsetLabel('Europe/London', summer)).toBe('GMT+1');
    expect(zoneOffsetLabel('Europe/London', winter)).toBe('GMT+0');
    expect(zoneOffsetLabel('Australia/Sydney', summer)).toBe('GMT+10');
    expect(zoneOffsetLabel('Australia/Sydney', winter)).toBe('GMT+11');

    // 沒有 DST 的六個，兩個季節都與原稿逐字相同。
    for (const at of [summer, winter]) {
      expect(zoneOffsetLabel('Asia/Taipei', at)).toBe('GMT+8');
      expect(zoneOffsetLabel('Asia/Tokyo', at)).toBe('GMT+9');
      expect(zoneOffsetLabel('Asia/Seoul', at)).toBe('GMT+9');
    }

    // 半小時時區保留分鐘；認不得的字串回 null 讓呼叫端只顯示城市名。
    expect(zoneOffsetLabel('Asia/Kolkata', summer)).toBe('GMT+5:30');
    expect(zoneOffsetLabel('Not/AZone', summer)).toBeNull();
  });

  it('時區選項的標籤用的是動態 offset', async () => {
    await render();
    const labels = [...timezoneSelect().options].map((option) => option.textContent);

    expect(labels).toContain('台北 (GMT+8)');
    expect(labels).toContain('UTC');
    const losAngeles = labels.find((label) => label?.startsWith('洛杉矶'));
    expect(losAngeles).toBe(`洛杉矶 (${zoneOffsetLabel('America/Los_Angeles', new Date())})`);
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
