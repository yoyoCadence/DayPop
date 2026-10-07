import { useState } from 'react';
import type { ErrorFallbackProps } from '../shell/ErrorBoundary';
import './screens.css';
import './recovery.css';

export interface ScreenErrorFallbackProps extends ErrorFallbackProps {
  /**
   * Starts a backup download and returns how many attachments it leaves out;
   * throws if the file could not be produced — DP-143. Supplied by `App`,
   * which holds the data, so this screen stays free of data access.
   */
  onDownloadBackup(): number;
  onReload(): void;
}

/**
 * What a tab shows instead of a blank page when its screen throws — DP-139.
 *
 * DayPop's own screen: the原檔 has no error states. It reuses the data-recovery
 * screen's layout and tokens rather than introducing a second look for "the
 * App is in trouble". Like every tab screen it renders exactly one `<h1>`.
 *
 * The backup is offered here rather than by sending the user to 設定 (DP-143):
 * 設定 may be the screen that failed, and someone looking at an error should
 * not have to know where the export lives.
 *
 * The message is shown on request only. It is there so the user can pass it
 * on; it is not sent anywhere.
 */
export function ScreenErrorFallback({ error, retry, onDownloadBackup, onReload }: ScreenErrorFallbackProps) {
  const [backupStatus, setBackupStatus] = useState<string | null>(null);

  function downloadBackup() {
    try {
      const attachments = onDownloadBackup();
      setBackupStatus(
        attachments > 0
          ? `已開始下載備份；${attachments} 個附件未包含在檔案內。`
          : '已開始下載備份。',
      );
    } catch (cause) {
      const reason = cause instanceof Error && cause.message ? cause.message : '未知的錯誤。';
      setBackupStatus(`備份沒有下載成功：${reason}`);
    }
  }

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
        <div className="recovery-note">其他分頁仍可使用。可以先下載備份，再試一次或重新載入。</div>
        <button className="recovery-primary" type="button" onClick={retry}>
          再試一次
        </button>
        <button className="recovery-secondary" type="button" onClick={downloadBackup}>
          下載備份
        </button>
        {backupStatus && (
          <div className="recovery-ok" role="status">
            {backupStatus}
          </div>
        )}
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
