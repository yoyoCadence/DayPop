import type { ReleaseInfo } from './version';

interface UpdateDialogProps {
  release: ReleaseInfo;
  preparing: boolean;
  onUpdate: () => void;
  onLater: () => void;
}

export function UpdateDialog({ release, preparing, onUpdate, onLater }: UpdateDialogProps) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title">
        <div className="update-kicker">NEW VERSION · v{release.version}</div>
        <h2 id="update-title">{release.title}</h2>
        <p>新版 DayPop 已經準備好了。更新只會替換 App 程式，不會刪除你的行程、待辦或設定。</p>
        <h3>這次更新</h3>
        <ul>
          {release.changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onLater} disabled={preparing}>
            稍後提醒
          </button>
          <button className="button primary" type="button" onClick={onUpdate} disabled={preparing}>
            {preparing ? '準備更新…' : '立即更新'}
          </button>
        </div>
      </section>
    </div>
  );
}
