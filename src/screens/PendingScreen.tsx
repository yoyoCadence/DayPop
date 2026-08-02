import './screens.css';

export interface PendingScreenProps {
  title: string;
  /** Task that owns the migration, so the placeholder is never mistaken for done. */
  taskId: string;
  summary: string;
  /** What the original screen contains, kept visible so the scope is not lost. */
  contents: string[];
}

/**
 * Placeholder for a canonical screen that exists in the Claude Design source but
 * has not been ported yet.
 *
 * The prototype's screen keeps its tab position and states plainly that it is
 * not migrated — per `docs/claude-design-source-of-truth.md`, unfinished areas
 * may be disabled and labelled, but must never show a fake working state.
 */
export function PendingScreen({ title, taskId, summary, contents }: PendingScreenProps) {
  return (
    <div className="dp-screen">
      <div className="dp-screen-header">
        <div className="dp-screen-title">{title}</div>
      </div>
      <div className="dp-screen-body">
        <div className="dp-section-label">尚未搬移</div>
        <div className="dp-note">
          <span className="dp-note-task">{taskId}</span>
          <strong>這一頁還沒有從原稿搬過來</strong>
          <p>{summary}</p>
          <ul>
            {contents.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="dp-screen-footnote">
          原稿畫面定義於「日曆桌寵 Calendar Pet.dc.html」，搬移規則見 docs/claude-design-source-of-truth.md
        </div>
      </div>
    </div>
  );
}
