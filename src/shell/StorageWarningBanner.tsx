import './storageWarning.css';

export interface StorageWarningBannerProps {
  /** Why the browser stopped persisting data, in the user's words. */
  reason: string;
}

/**
 * Permanent notice shown while this tab runs on memory-only storage (DP-017).
 *
 * Deliberately not dismissible and deliberately part of the layout rather than
 * a toast: everything the user does from here is lost on reload, and a warning
 * they can close would let them forget that halfway through the session.
 */
export function StorageWarningBanner({ reason }: StorageWarningBannerProps) {
  return (
    <div className="dp-storage-warning" role="status">
      <span className="dp-storage-warning-mark" aria-hidden="true">
        !
      </span>
      <div className="dp-storage-warning-text">
        <strong>這次的變更不會被保存</strong>
        <p>{reason}目前的內容只留在這個分頁，重新整理或關掉之後就會消失。</p>
      </div>
    </div>
  );
}
