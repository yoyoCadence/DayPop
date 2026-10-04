import type { DataWarning } from '../data/dataContext';
import './remoteDataWarning.css';

export interface RemoteDataWarningBannerProps {
  warning: DataWarning;
  onRefresh(): void;
}

const TITLES: Record<DataWarning['kind'], string> = {
  cached: '目前顯示裝置快取',
  'write-failed': '資料尚未同步',
  // Also shown to guests, who have nothing to sync — DP-123.
  refused: '剛才的變更沒有套用',
};

/**
 * Persistent data notice.
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
        <strong>{TITLES[warning.kind]}</strong>
        <p>{warning.message}</p>
      </div>
      <button className="dp-remote-warning-action" type="button" onClick={onRefresh}>
        重新載入
      </button>
    </div>
  );
}
