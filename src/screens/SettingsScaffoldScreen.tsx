import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useAuth } from '../auth/authContext';
import { downloadTextFile, readTextFile } from '../browser/dataTransferFiles';
import { useDayPopData, useDayPopDataState } from '../data/dataContext';
import { nextCalendarColor, sortedCalendars } from '../domain/calendars';
import {
  backupFileName,
  buildIcsExport,
  buildJsonBackup,
  planIcsImport,
  planJsonImport,
  previewTotal,
  serializeJsonBackup,
  type ImportPlan,
} from '../domain/dataTransfer';
import type { Calendar, CalendarGridMode, ThemePreference } from '../domain/types';
import type { AppUpdateState } from '../pwa/useAppUpdate';
import { LegacyImportCard } from '../legacy/LegacyImportCard';
import { useTheme } from '../theme/themeContext';
import { THEMES, THEME_IDS } from '../theme/themes';
import { CalendarEditDialog } from './CalendarEditDialog';
import { timezoneOptions } from './timezoneOptions';
import { DataImportDialog } from './DataImportDialog';
import { DataPrivacyCard } from './DataPrivacyCard';
import './screens.css';
import './calendarManage.css';
import './dataTransfer.css';
import './settingsPreferences.css';

export interface SettingsScaffoldScreenProps {
  updater: AppUpdateState;
  onOpenAuth(): void;
}

const MODE_OPTIONS: { mode: ThemePreference; label: string }[] = [
  { mode: 'system', label: '◐ 跟隨系統' },
  { mode: 'light', label: '☀ 淺色' },
  { mode: 'dark', label: '☾ 深色' },
];

const GRID_OPTIONS: { mode: CalendarGridMode; label: string }[] = [
  { mode: 'adaptive', label: '自動 4–6 列' },
  { mode: 'fixed-six', label: '固定 6 列' },
];

const WEEK_START_OPTIONS: { value: 0 | 1; label: string }[] = [
  { value: 0, label: '日' },
  { value: 1, label: '一' },
];

/**
 * 設定 tab.
 *
 * The 外觀主題、我的日曆、桌寵 and 一般 sections are ported from the原檔 設定
 * screen. Account and version blocks are the DP-010/DP-011/DP-023 capabilities
 * kept working inside the canonical shell. DP-113 applies the same card and
 * control tokens to those DayPop-owned surfaces without changing their flows.
 *
 * 桌寵與一般只搬移現有偏好模型撐得起的控制項。原稿的「選擇夥伴」與
 * 「左右滑動翻頁」需要新的偏好欄位與 migration，等級／XP 需要 DP-041 的規則，
 * 預設提醒與通知提醒屬 DP-042 —— 這些一律留在下方的「尚未搬移」清單，
 * 不以停用或假的成功狀態充數。
 */
export function SettingsScaffoldScreen({ updater, onOpenAuth }: SettingsScaffoldScreenProps) {
  const { themeId, mode, selectTheme, selectMode } = useTheme();
  const auth = useAuth();
  const { state: dataState } = useDayPopDataState();
  const {
    data,
    addCalendar,
    updateCalendar,
    deleteCalendar,
    updatePreferences,
    importData,
  } = useDayPopData();
  const [authActionError, setAuthActionError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    fileName: string;
    plan: ImportPlan;
  } | null>(null);
  const [transferMessage, setTransferMessage] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  /**
   * 寵物名字的未送出草稿；`null` 代表畫面直接顯示已保存的值。
   *
   * 原稿 :994 的 `onPetName` 每按一鍵就把原始字串寫進 state，但 DayPop 的
   * `petName` 在 domain 是「非空且已 trim」的字串（`validation.ts:433`），
   * 空字串會在 repository 邊界被擋下。衝突時以 DayPop 的 validation 為準：
   * 草稿讓打字（含中途的空白）不被卡住，離開欄位時才單次送出。
   *
   * **不可以在每次輸入時比對 `preferences.petName` 決定要不要送出。**
   * `DataProvider` 沒有樂觀更新 —— `setState` 只在 repository 回應後才跑
   * （`DataProvider.tsx` 的 `enqueue()`）—— 所以打字期間 `preferences` 還是
   * 送出前的舊值。用它比對會讓「摩卡 → 摩 → 摩卡」的第二次判定成不用寫，
   * 佇列最後保存的反而是中途的「摩」，使用者打的最終值被靜默丟掉。
   */
  const [petNameDraft, setPetNameDraft] = useState<string | null>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const icsInputRef = useRef<HTMLInputElement>(null);
  /** null = closed, 'new' = creating, otherwise the calendar id being edited. */
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  const calendars = sortedCalendars(data.calendars);
  const editingCalendar =
    editing && editing !== 'new'
      ? (calendars.find((calendar) => calendar.id === editing) ?? null)
      : null;
  // The原檔 keeps the delete option away from the last remaining calendar.
  const canDelete = editing !== 'new' && editingCalendar !== null && calendars.length > 1;
  const syncLabel =
    dataState.status !== 'ready'
      ? '檢查中'
      : dataState.warning
        ? '尚未同步'
        : dataState.saving
          ? '同步中…'
          : '已同步';

  const preferences = data.preferences;
  const petNameValue = petNameDraft ?? preferences.petName;
  // 時區 offset 依「現在」解析。固定成一個值，重繪時標籤才不會跳動。
  const now = useMemo(() => new Date(), []);

  function changePetName(value: string) {
    setPetNameDraft(value);
  }

  /**
   * 離開欄位時把草稿送出一次，然後放開草稿讓欄位回到已保存的值。
   *
   * 這裡刻意不跟 `preferences.petName` 比對（理由見 `petNameDraft` 的說明）：
   * 重複送出同一個名字是 idempotent 的，代價遠小於漏送使用者的最終值。
   * 清空後離開欄位則是放棄草稿、還原成原本的名字，而不是留下一個
   * 看起來已改、實際沒保存的畫面（DP-076 的教訓）。
   */
  function commitPetName() {
    const draft = petNameDraft;
    setPetNameDraft(null);
    if (draft === null) return;
    const trimmed = draft.trim();
    if (trimmed) updatePreferences({ petName: trimmed });
  }

  function togglePet() {
    // 原稿 :995 同時關掉寵物對話泡泡；DayPop 的泡泡屬 DP-040，目前還沒有。
    updatePreferences({ petEnabled: !preferences.petEnabled });
  }

  function itemsOn(calendar: Calendar | null): number {
    if (!calendar) return 0;
    const belongs = (row: { calendarId: string }) => row.calendarId === calendar.id;
    return (
      data.events.filter(belongs).length +
      data.todos.filter(belongs).length +
      data.stickers.filter(belongs).length
    );
  }

  function saveCalendar(values: { name: string; color: string }) {
    if (editing === 'new') addCalendar(values);
    else if (editingCalendar) updateCalendar(editingCalendar.id, values);
    setEditing(null);
  }

  async function signOut() {
    setAuthActionError(null);
    try {
      await auth.signOut();
    } catch (error) {
      setAuthActionError(error instanceof Error ? error.message : '登出失敗，請稍後再試。');
    }
  }

  function exportJson() {
    setTransferError(null);
    try {
      downloadTextFile(
        backupFileName('json'),
        serializeJsonBackup(buildJsonBackup(data, { appVersion: updater.currentVersion })),
        'application/json;charset=utf-8',
      );
      setTransferMessage(
        data.eventAttachments.length > 0
          ? `已開始下載備份；${data.eventAttachments.length} 個附件未包含在檔案內。`
          : '已開始下載 DayPop 備份。',
      );
    } catch (error) {
      setTransferError(describeError(error, '建立備份檔案失敗。'));
    }
  }

  function exportIcs() {
    setTransferError(null);
    try {
      downloadTextFile(
        backupFileName('ics'),
        buildIcsExport(data),
        'text/calendar;charset=utf-8',
      );
      setTransferMessage(`已開始下載 ${data.events.length} 筆行程的 iCalendar 檔案。`);
    } catch (error) {
      setTransferError(describeError(error, '建立 iCalendar 檔案失敗。'));
    }
  }

  async function chooseImport(kind: 'json' | 'ics', event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setTransferMessage(null);
    setTransferError(null);
    try {
      const text = await readTextFile(file);
      const plan =
        kind === 'json'
          ? planJsonImport(text, data)
          : planIcsImport(text, data, {
              calendarId: data.calendars.find((calendar) => calendar.isDefault)?.id,
              defaultTimezone: data.preferences.timezone,
            });
      setPendingImport({ fileName: file.name, plan });
    } catch (error) {
      setTransferError(describeError(error, `無法讀取「${file.name}」。`));
    } finally {
      // Selecting the same file again must fire another change event.
      input.value = '';
    }
  }

  async function confirmImport() {
    if (!pendingImport || importing) return;
    setImporting(true);
    setTransferError(null);
    try {
      await importData(pendingImport.plan.command);
      const count = previewTotal(pendingImport.plan.preview);
      setTransferMessage(
        pendingImport.plan.preview.mode === 'replace'
          ? `已從「${pendingImport.fileName}」還原 ${count} 筆資料。`
          : `已從「${pendingImport.fileName}」匯入 ${count} 筆資料。`,
      );
      setPendingImport(null);
    } catch (error) {
      setTransferError(describeError(error, '匯入失敗；原有資料沒有被預覽內容覆寫。'));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="dp-screen">
      <div className="dp-screen-header">
        <h1 className="dp-screen-title">設定</h1>
      </div>
      <div className="dp-screen-body">
        <div className="dp-section-label">外觀主題</div>
        <div className="dp-theme-grid">
          {THEME_IDS.map((id) => {
            const theme = THEMES[id];
            const active = id === themeId;
            return (
              <button
                key={id}
                className="dp-theme-card"
                type="button"
                aria-pressed={active}
                onClick={() => selectTheme(id)}
              >
                <div className="dp-theme-preview" aria-hidden="true">
                  <div
                    className="dp-theme-swatch"
                    style={{ background: theme.light.surface, border: `2px solid ${theme.light.fg}` }}
                  >
                    <i style={{ background: theme.light.accent }} />
                  </div>
                  <div className="dp-theme-lines">
                    <i style={{ width: '80%', background: theme.light.fg, opacity: 0.85 }} />
                    <i style={{ width: '55%', background: theme.light.accent }} />
                    <i style={{ width: '68%', background: theme.light.fg, opacity: 0.4 }} />
                  </div>
                </div>
                <div className="dp-theme-name">
                  {theme.name}
                  <span aria-hidden="true">{active ? '✓' : ''}</span>
                </div>
                <div className="dp-theme-desc">{theme.desc}</div>
              </button>
            );
          })}
        </div>

        <div className="dp-mode-toggle" role="group" aria-label="淺色或深色">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.mode}
              className="dp-mode-button"
              type="button"
              aria-pressed={mode === option.mode}
              onClick={() => selectMode(option.mode)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="dp-section-label" style={{ marginTop: 18 }}>
          我的日曆
        </div>
        <div className="cal-manage-list">
          {calendars.map((calendar) => (
            <div className="cal-manage-row" key={calendar.id}>
              <button
                className="cal-manage-open"
                type="button"
                onClick={() => setEditing(calendar.id)}
              >
                <span className="cal-manage-dot" style={{ background: calendar.color }} />
                <span className="cal-manage-name">{calendar.name}</span>
                <span className="cal-manage-edit-hint">編輯</span>
              </button>
              <button
                className="cal-manage-toggle"
                type="button"
                aria-pressed={calendar.isVisible}
                aria-label={`${calendar.isVisible ? '隱藏' : '顯示'} ${calendar.name}`}
                onClick={() => updateCalendar(calendar.id, { isVisible: !calendar.isVisible })}
              >
                <span className="cal-manage-knob" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        <button className="cal-manage-add" type="button" onClick={() => setEditing('new')}>
          ＋ 新增日曆
        </button>

        {editing && (
          <CalendarEditDialog
            calendar={editingCalendar}
            suggestedColor={nextCalendarColor(calendars.length)}
            canDelete={canDelete}
            itemCount={itemsOn(editingCalendar)}
            reassignTargetName={
              calendars.find(
                (calendar) => calendar.isDefault && calendar.id !== editingCalendar?.id,
              )?.name ??
              calendars.find((calendar) => calendar.id !== editingCalendar?.id)?.name ??
              ''
            }
            onSave={saveCalendar}
            onDelete={() => {
              if (editingCalendar) deleteCalendar(editingCalendar.id);
              setEditing(null);
            }}
            onClose={() => setEditing(null)}
          />
        )}

        <div className="dp-section-label" style={{ marginTop: 18 }}>
          帳號
        </div>
        <div className="dp-account-blocks">
          <section className={`storage-scope-banner${auth.user ? ' authenticated' : ''}`} aria-live="polite">
            <div>
              <strong>{auth.user ? '帳號已登入' : '目前是遊客模式'}</strong>
              <p>
                {auth.configurationError
                  ? `Supabase 尚未就緒：${auth.configurationError} 日曆仍安全保存在這台裝置。`
                  : auth.user
                    ? `${auth.user.email ?? '這個帳號'} 已完成登入；行程、待辦與設定會保存至此帳號。這台裝置只保留版本化快取，遊客資料不會自動上傳。`
                    : '行程、待辦與設定只保存在這台裝置。登入不會刪除或自動上傳這些資料。'}
              </p>
              {auth.user ? (
                <span
                  className={`account-sync-status${
                    dataState.status === 'ready' && !dataState.warning && !dataState.saving
                      ? ' synced'
                      : ''
                  }`}
                >
                  ● {syncLabel}
                </span>
              ) : null}
              {authActionError && <p className="auth-action-error">{authActionError}</p>}
            </div>
            {auth.user ? (
              <button className="button secondary" type="button" onClick={() => void signOut()}>登出</button>
            ) : (
              <button className="button primary" type="button" onClick={onOpenAuth} disabled={Boolean(auth.configurationError)}>登入／註冊</button>
            )}
          </section>
          <LegacyImportCard />
        </div>

        {/* 原稿 :317-326。等級／XP 區塊屬 DP-041、選擇夥伴屬 DP-040，都還沒搬。 */}
        <div className="dp-section-label">桌寵</div>
        <div className="set-pref-card">
          <div className="set-pref-toggle-row">
            <span className="set-pref-toggle-label" id="pet-enabled-label">
              顯示桌寵
            </span>
            <button
              className="set-pref-toggle"
              type="button"
              aria-pressed={preferences.petEnabled}
              aria-labelledby="pet-enabled-label"
              onClick={togglePet}
            >
              <span className="set-pref-knob" aria-hidden="true" />
            </button>
          </div>
          <label className="set-pref-field-label" htmlFor="pet-name">
            寵物名字
          </label>
          <input
            id="pet-name"
            className="set-pref-input"
            type="text"
            value={petNameValue}
            placeholder="幫牠取名"
            maxLength={40}
            onChange={(event) => changePetName(event.target.value)}
            onBlur={commitPetName}
          />
          {/*
            原稿 :323 的說明描述的是四個 DP-040 才會有的能力（走動、對話泡泡、
            透過牠新增待辦、行程建議）。現在的寵物層只有固定位置與待辦數 badge
            （見 `PetLayer.tsx` 的說明），所以照搬那句話會變成宣告不存在的功能。
            依 `docs/prototype-behavior-baseline.md` 的規則保留原文與版面位置，
            但把還沒有的能力明講成尚未提供，不以假的成功狀態充數。
          */}
          <p className="set-pref-help">
            目前牠會待在日曆右下角，顯示未完成待辦的數量。
            <br />
            <span className="set-pref-pending">
              尚未提供（DP-040）：在角落走動、用漫畫對話框提醒你今日與明日的待辦、直接透過牠新增待辦或請牠給行程建議。
            </span>
          </p>
        </div>

        {/* 原稿 :329-337。預設提醒與通知提醒屬 DP-042，雲端同步已在上面的帳號區塊。 */}
        <div className="dp-section-label">一般</div>
        <div className="set-pref-rows">
          <div className="set-pref-row">
            {/* 原稿這一列是「月檢視週數 4／5／6」。DP-018 已定案 DayPop 改用
                自動／固定兩種列數模式，所以沿用該模型，只把它放回原稿的位置。 */}
            <span className="set-pref-row-label" id="grid-mode-label">
              月曆列數
            </span>
            <div className="set-pref-segment" role="group" aria-labelledby="grid-mode-label">
              {GRID_OPTIONS.map((option) => (
                <button
                  key={option.mode}
                  className="set-pref-segment-button"
                  type="button"
                  aria-pressed={preferences.calendarGridMode === option.mode}
                  onClick={() => updatePreferences({ calendarGridMode: option.mode })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="set-pref-row">
            <span className="set-pref-row-label" id="week-start-label">
              每週起始日
            </span>
            <div className="set-pref-segment" role="group" aria-labelledby="week-start-label">
              {WEEK_START_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className="set-pref-segment-button"
                  type="button"
                  aria-pressed={preferences.weekStartsOn === option.value}
                  onClick={() => updatePreferences({ weekStartsOn: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="set-pref-row">
            <label className="set-pref-row-label" htmlFor="default-timezone">
              預設時區
            </label>
            <select
              id="default-timezone"
              className="set-pref-select"
              value={preferences.timezone}
              onChange={(event) => updatePreferences({ timezone: event.target.value })}
            >
              {timezoneOptions(preferences.timezone, now).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="dp-section-label">資料備份</div>
        <div className="data-transfer-actions">
          <button
            className="data-transfer-button"
            type="button"
            disabled={importing}
            onClick={exportJson}
          >
            ⬇ 匯出資料
          </button>
          <button
            className="data-transfer-button"
            type="button"
            disabled={importing}
            onClick={() => jsonInputRef.current?.click()}
          >
            ⬆ 匯入資料
          </button>
          <input
            ref={jsonInputRef}
            className="data-transfer-json-input"
            type="file"
            accept="application/json,.json"
            aria-label="選擇 DayPop JSON 備份"
            hidden
            onChange={(event) => void chooseImport('json', event)}
          />
        </div>
        <p className="data-transfer-help">
          匯出成 JSON 存到裝置；換手機或清除瀏覽器資料前先備份。備份不含附件，匯入前會先預覽且確認後才取代資料。
        </p>
        <div className="data-transfer-actions">
          <button
            className="data-transfer-button"
            type="button"
            disabled={importing}
            onClick={exportIcs}
          >
            ⬇ 匯出 .ics
          </button>
          <button
            className="data-transfer-button"
            type="button"
            disabled={importing}
            onClick={() => icsInputRef.current?.click()}
          >
            ⬆ 匯入 .ics
          </button>
          <input
            ref={icsInputRef}
            className="data-transfer-ics-input"
            type="file"
            accept=".ics,text/calendar"
            aria-label="選擇 iCalendar 檔案"
            hidden
            onChange={(event) => void chooseImport('ics', event)}
          />
        </div>
        <p className="data-transfer-help">
          .ics 是 Google 日曆、Apple 日曆與 Outlook 等服務共用的格式；匯入只會附加行程，不會取代現有資料。
        </p>
        {transferMessage ? (
          <p className="data-transfer-status" role="status">
            {transferMessage}
          </p>
        ) : null}
        {transferError && !pendingImport ? (
          <p className="data-transfer-status error" role="alert">
            {transferError}
          </p>
        ) : null}

        {pendingImport ? (
          <DataImportDialog
            fileName={pendingImport.fileName}
            plan={pendingImport.plan}
            currentCalendars={data.calendars}
            busy={importing}
            error={transferError}
            onConfirm={() => void confirmImport()}
            onCancel={() => {
              if (!importing) {
                setPendingImport(null);
                setTransferError(null);
              }
            }}
          />
        ) : null}

        <DataPrivacyCard />

        <div className="dp-section-label">版本與更新</div>
        <div className="dp-account-blocks">
          <section className="release-panel">
            <div>
              <h2>版本與更新</h2>
              <p>目前版本 v{updater.currentVersion}。DayPop 會在啟動、回到前景與連線恢復時檢查新版。</p>
              {updater.currentRelease && (
                <details className="current-release">
                  <summary>查看這個版本更新了什麼</summary>
                  <ul>
                    {updater.currentRelease.changes.map((change) => <li key={change}>{change}</li>)}
                  </ul>
                </details>
              )}
              {updater.error && <p className="update-error">本次檢查失敗：{updater.error}</p>}
            </div>
            <button className="button secondary" type="button" onClick={() => void updater.checkForUpdate()} disabled={updater.checking}>
              {updater.checking ? '檢查中…' : '檢查更新'}
            </button>
          </section>
        </div>

        <div className="dp-section-label">尚未搬移</div>
        <div className="dp-note">
          <span className="dp-note-task">DP-014</span>
          <strong>設定的其餘區塊還在原稿裡</strong>
          <p>這些區塊會依原稿逐段搬移，不會被合併或改成別的版面：</p>
          <ul>
            <li>AI 助理區塊（安全代理方案見 DP-043）</li>
            <li>桌寵的等級與已完成待辦數（DP-041 才定義 XP 規則）</li>
            <li>桌寵的「選擇夥伴」品種（DP-040 的素材，且偏好還沒有這個欄位）</li>
            <li>一般偏好的「左右滑動翻頁」（偏好還沒有這個欄位）</li>
            <li>通知提醒與預設提醒（DP-042）</li>
            <li>開發／示範資料控制</li>
          </ul>
        </div>

        <div className="dp-screen-footnote">
          使用者資料與 App cache 分開保存・更新不會清除行程與設定
        </div>
      </div>
    </div>
  );
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
