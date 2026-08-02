import { useState } from 'react';
import { useAuth } from '../auth/authContext';
import type { AppUpdateState } from '../pwa/useAppUpdate';
import { useTheme } from '../theme/themeContext';
import { THEMES, THEME_IDS, type ThemeMode } from '../theme/themes';
import './screens.css';

export interface SettingsScaffoldScreenProps {
  updater: AppUpdateState;
  onOpenAuth(): void;
}

const MODE_OPTIONS: { mode: ThemeMode; label: string }[] = [
  { mode: 'light', label: '☀ 淺色' },
  { mode: 'dark', label: '☾ 深色' },
];

/**
 * 設定 tab.
 *
 * The 外觀主題 section is ported from the原檔 設定 screen and is the way to
 * verify all six themes in light and dark. Account and version blocks are the
 * DP-010/DP-011/DP-023 capabilities kept working inside the canonical shell;
 * they still carry scaffold styling and are redesigned in DP-014.
 */
export function SettingsScaffoldScreen({ updater, onOpenAuth }: SettingsScaffoldScreenProps) {
  const { themeId, mode, selectTheme, selectMode } = useTheme();
  const auth = useAuth();
  const [authActionError, setAuthActionError] = useState<string | null>(null);

  async function signOut() {
    setAuthActionError(null);
    try {
      await auth.signOut();
    } catch (error) {
      setAuthActionError(error instanceof Error ? error.message : '登出失敗，請稍後再試。');
    }
  }

  return (
    <div className="dp-screen">
      <div className="dp-screen-header">
        <div className="dp-screen-title">設定</div>
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

        <div className="dp-note">
          <span className="dp-note-task">DP-018</span>
          <strong>主題偏好還沒有保存</strong>
          <p>
            這裡的切換只影響目前這個瀏覽階段，重新載入會回到新使用者預設的「漫畫．淺色」。保存與
            system／light／dark 同步由 DP-018 接上，屆時不會覆寫你已經保存過的偏好。
          </p>
        </div>

        <div className="dp-section-label" style={{ marginTop: 18 }}>
          帳號
        </div>
        <div className="dp-legacy-scaffold">
          <section className={`storage-scope-banner${auth.user ? ' authenticated' : ''}`} aria-live="polite">
            <div>
              <strong>{auth.user ? '帳號已登入' : '目前是遊客模式'}</strong>
              <p>
                {auth.configurationError
                  ? `Supabase 尚未就緒：${auth.configurationError} 日曆仍安全保存在這台裝置。`
                  : auth.user
                    ? `${auth.user.email ?? '這個帳號'} 已完成登入；目前日曆仍保存在這台裝置，帳號資料保存會在下一階段接上。`
                    : '行程、待辦與設定只保存在這台裝置。登入不會刪除或自動上傳這些資料。'}
              </p>
              {authActionError && <p className="auth-action-error">{authActionError}</p>}
            </div>
            {auth.user ? (
              <button className="button secondary" type="button" onClick={() => void signOut()}>登出</button>
            ) : (
              <button className="button primary" type="button" onClick={onOpenAuth} disabled={Boolean(auth.configurationError)}>登入／註冊</button>
            )}
          </section>
        </div>

        <div className="dp-section-label">版本與更新</div>
        <div className="dp-legacy-scaffold">
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
            <li>日曆管理：顯示切換、改名與顏色</li>
            <li>寵物：命名、品種與開關</li>
            <li>一般偏好：週起始日、時區、月曆列數、滑動方向</li>
            <li>通知與預設提醒</li>
            <li>資料匯入匯出與開發／示範資料控制</li>
          </ul>
        </div>

        <div className="dp-screen-footnote">
          使用者資料與 App cache 分開保存・更新不會清除行程與設定
        </div>
      </div>
    </div>
  );
}
