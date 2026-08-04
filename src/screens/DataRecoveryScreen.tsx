import { useState } from 'react';
import {
  backupRawUserData,
  listUserDataBackups,
  resetUserData,
  type StorageReadResult,
} from '../storage/versionedStorage';
import './screens.css';
import './recovery.css';

export interface DataRecoveryScreenProps {
  result: Exclude<StorageReadResult, { status: 'ready' }>;
  /** Called after a successful reset so the app can reload its data. */
  onRecovered(): void;
}

/**
 * Shown instead of the tabs when the stored data cannot be read (DP-016).
 *
 * The app fails closed here on purpose. Rendering the normal screens would let
 * the first edit write a blank state over bytes DayPop could not parse, which
 * is exactly the data-loss path this screen exists to close.
 *
 * Reset is gated on a backup existing — `resetUserData` throws otherwise — so
 * the destructive option can never be the only copy of the user's data.
 */
export function DataRecoveryScreen({ result, onRecovered }: DataRecoveryScreenProps) {
  const [backupKey, setBackupKey] = useState<string | null>(
    () => listUserDataBackups().at(-1) ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  const isFuture = result.status === 'future';

  function backupAndDownload() {
    setError(null);
    try {
      // Copy into localStorage first: that succeeds or throws immediately,
      // whereas a download can be cancelled without us ever knowing.
      const key = backupRawUserData(result.raw);
      setBackupKey(key);

      const url = URL.createObjectURL(new Blob([result.raw], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${key}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setDownloaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '備份失敗。');
    }
  }

  function reset() {
    setError(null);
    try {
      resetUserData();
      onRecovered();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重設失敗。');
    }
  }

  return (
    <div className="dp-screen recovery-screen">
      <div className="dp-screen-header">
        <div className="dp-screen-title">資料需要處理</div>
      </div>
      <div className="dp-screen-body">
        <div className="recovery-alert">
          <strong>
            {isFuture ? '這份資料來自較新版本的 DayPop' : '這台裝置上的 DayPop 資料讀不出來'}
          </strong>
          <p>
            {isFuture
              ? `儲存的資料是 schema v${result.schemaVersion}，比目前的 App 新。舊版寫入會破壞它，所以已暫停編輯。`
              : `原因：${result.reason}`}
          </p>
        </div>

        <div className="recovery-note">
          為了不覆蓋掉原始內容，行程與待辦的編輯已全部停用。原始資料還在這台裝置上，沒有被修改。
        </div>

        {isFuture ? (
          <>
            <div className="dp-section-label">建議做法</div>
            <div className="dp-note">
              <strong>先更新 App</strong>
              <p>
                重新整理頁面取得最新版本，通常就能直接讀取。如果更新後仍看到這個畫面，再用下面的備份與重設。
              </p>
            </div>
          </>
        ) : null}

        <div className="dp-section-label">1. 先備份原始內容</div>
        <button className="recovery-primary" type="button" onClick={backupAndDownload}>
          備份並下載原始資料
        </button>
        {backupKey && (
          <div className="recovery-ok">
            已複製到這台裝置的 <code>{backupKey}</code>
            {downloaded ? '，並已開始下載檔案。' : '。'}
          </div>
        )}

        <div className="dp-section-label" style={{ marginTop: 18 }}>
          2. 確定備份好了再重設
        </div>
        <div className="recovery-note">
          重設會把 <code>daypop.user-data</code> 換成空白資料。上一步的備份不會被刪除，
          <code>calpet.v2</code> 與其他網站資料也不受影響。
        </div>
        <button
          className="recovery-danger"
          type="button"
          disabled={!backupKey}
          onClick={reset}
        >
          重設本機資料
        </button>
        {!backupKey && <div className="recovery-hint">先完成備份才會開放重設。</div>}

        {error && <div className="recovery-error">{error}</div>}
      </div>
    </div>
  );
}
