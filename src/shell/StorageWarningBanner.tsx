import './storageWarning.css';

export interface StorageWarningBannerProps {
  /** Why the browser stopped persisting data, in the user's words. */
  reason: string;
  /** Signed-in rows remain durable remotely even when the device cache fails. */
  accountBacked?: boolean;
}

/**
 * Permanent notice shown while this tab runs on memory-only storage (DP-017).
 *
 * Deliberately not dismissible and deliberately part of the layout rather than
 * a toast: everything the user does from here is lost on reload, and a warning
 * they can close would let them forget that halfway through the session.
 */
export function StorageWarningBanner({
  reason,
  accountBacked = false,
}: StorageWarningBannerProps) {
  return (
    <div className="dp-storage-warning" role="status">
      <span className="dp-storage-warning-mark" aria-hidden="true">
        !
      </span>
      <div className="dp-storage-warning-text">
        <strong>{accountBacked ? '這台裝置無法保存快取' : '這次的變更不會被保存'}</strong>
        <p>
          {reason}
          {accountBacked
            ? '已成功同步的帳號資料仍保存在雲端；重新整理時需要重新連線。'
            : '目前的內容只留在這個分頁，重新整理或關掉之後就會消失。'}
        </p>
      </div>
    </div>
  );
}
