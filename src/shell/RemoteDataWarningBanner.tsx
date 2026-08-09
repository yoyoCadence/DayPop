import type { DataWarning } from '../data/dataContext';
import './remoteDataWarning.css';

export interface RemoteDataWarningBannerProps {
  warning: DataWarning;
  onRefresh(): void;
}

/**
 * Persistent account-data notice.
 *
 * A toast would let the user miss that the shown document is cached or that a
 * write was rejected. Refresh reconciles with the server; it deliberately does
 * not replay the mutation because a lost response may still have committed.
 */
export function RemoteDataWarningBanner({
  warning,
  onRefresh,
}: RemoteDataWarningBannerProps) {
  return (
    <div className="dp-remote-warning" role="status">
      <span className="dp-remote-warning-mark" aria-hidden="true">
        ↻
      </span>
      <div className="dp-remote-warning-text">
        <strong>
          {warning.kind === 'cached' ? '目前顯示裝置快取' : '資料尚未同步'}
        </strong>
        <p>{warning.message}</p>
      </div>
      <button className="dp-remote-warning-action" type="button" onClick={onRefresh}>
        重新載入
      </button>
    </div>
  );
}
