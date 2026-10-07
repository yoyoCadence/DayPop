import type { ErrorFallbackProps } from '../shell/ErrorBoundary';
import './screens.css';
import './recovery.css';

export interface ScreenErrorFallbackProps extends ErrorFallbackProps {
  /**
   * False when 設定 is the screen that failed: pointing the user at the tab
   * they are already on, and cannot use, would send them in a circle.
   */
  settingsHint: boolean;
  onReload(): void;
}

/**
 * What a tab shows instead of a blank page when its screen throws — DP-139.
 *
 * DayPop's own screen: the原檔 has no error states. It reuses the data-recovery
 * screen's layout and tokens rather than introducing a second look for "the
 * App is in trouble". Like every tab screen it renders exactly one `<h1>`.
 *
 * The message is shown on request only. It is there so the user can pass it
 * on; it is not sent anywhere.
 */
export function ScreenErrorFallback({ error, retry, settingsHint, onReload }: ScreenErrorFallbackProps) {
  return (
    <div className="dp-screen recovery-screen">
      <div className="dp-screen-header">
        <h1 className="dp-screen-title">這個畫面暫時無法顯示</h1>
      </div>
      <div className="dp-screen-body">
        <div className="recovery-alert recovery-alert-plain" role="alert">
          <strong>畫面發生錯誤</strong>
          <p>這不是你的操作造成的，你的資料沒有被刪除。</p>
        </div>
        <div className="recovery-note">
          {settingsHint
            ? '其他分頁仍可使用。需要時可以先到「設定」匯出備份，再重新載入。'
            : '其他分頁仍可使用。可以再試一次，或重新載入。'}
        </div>
        <button className="recovery-primary" type="button" onClick={retry}>
          再試一次
        </button>
        <button className="recovery-secondary" type="button" onClick={onReload}>
          重新載入 App
        </button>
        <details className="recovery-details">
          <summary>錯誤訊息</summary>
          <p>{error.message || '（沒有訊息）'}</p>
        </details>
      </div>
    </div>
  );
}
