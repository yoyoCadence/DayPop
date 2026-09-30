import type { UpdateCheckResult } from './useAppUpdate';
import type { ReleaseInfo } from './version';

/**
 * The one-button counterpart of `UpdateDialog` — DP-090.
 *
 * It says either "this is what the version you are now running changed" or
 * how a manual 檢查更新 ended. Same `.update-dialog` styles as the update
 * prompt, so it inherits the scrolling that keeps its button reachable on a
 * short screen.
 */
export type ReleaseNotice =
  | { kind: 'whats-new'; release: ReleaseInfo }
  | { kind: 'check'; currentVersion: string; result: UpdateCheckResult };

interface ReleaseNoticeDialogProps {
  notice: ReleaseNotice;
  onClose: () => void;
}

export function ReleaseNoticeDialog({ notice, onClose }: ReleaseNoticeDialogProps) {
  const content = describe(notice);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-notice-title"
      >
        <div className="update-kicker">{content.kicker}</div>
        <h2 id="release-notice-title">{content.title}</h2>
        <p>{content.message}</p>
        {content.changes.length > 0 && (
          <>
            <h3>這次更新</h3>
            <ul>
              {content.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </>
        )}
        <div className="dialog-actions">
          {/* Focus lands on the only way out, so the dialog is keyboard-closable. */}
          <button className="button primary" type="button" onClick={onClose} autoFocus>
            知道了
          </button>
        </div>
      </section>
    </div>
  );
}

function describe(notice: ReleaseNotice): {
  kicker: string;
  title: string;
  message: string;
  changes: string[];
} {
  if (notice.kind === 'whats-new') {
    return {
      kicker: `已更新 · v${notice.release.version}`,
      title: notice.release.title,
      message: 'DayPop 已經是新版本了，這次的變更如下。',
      changes: notice.release.changes,
    };
  }
  if (notice.result.kind === 'failed') {
    return {
      kicker: '檢查更新',
      title: '暫時無法檢查更新',
      message: `沒有連到更新資訊（${notice.result.message}）。請確認網路連線後再試一次；你的行程與設定不受影響。`,
      changes: [],
    };
  }
  const release = notice.result.release;
  return {
    kicker: `已是最新版本 · v${notice.currentVersion}`,
    title: '目前已是最新版本',
    message: release
      ? `你正在使用的 v${release.version}「${release.title}」就是最新版。`
      : `你正在使用的 v${notice.currentVersion} 就是最新版。`,
    changes: release?.changes ?? [],
  };
}
