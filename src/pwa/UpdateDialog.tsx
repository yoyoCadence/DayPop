import { useRef } from 'react';
import { useModalFocus } from '../shell/useModalFocus';
import type { ReleaseInfo } from './version';

interface UpdateDialogProps {
  release: ReleaseInfo;
  preparing: boolean;
  error: string | null;
  onUpdate: () => void;
  onLater: () => void;
}

export function UpdateDialog({ release, preparing, error, onUpdate, onLater }: UpdateDialogProps) {
  // A notice: it waits for the person's own dialogs to close (DP-156). Escape
  // is 稍後提醒, except while the new version is being prepared.
  const layer = useRef<HTMLDivElement>(null);
  useModalFocus(layer, {
    notice: true,
    onEscape: () => {
      if (!preparing) onLater();
    },
  });

  return (
    <div ref={layer} className="dialog-backdrop" role="presentation">
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
        {error ? <p className="update-error" role="alert">{error}</p> : null}
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
