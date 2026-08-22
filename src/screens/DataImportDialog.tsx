import { useEffect, useMemo, useRef } from 'react';
import { previewTotal, type ImportPlan } from '../domain/dataTransfer';
import { eventWallTime } from '../domain/eventTime';
import type { Calendar } from '../domain/types';
import { ViewportLayer } from '../shell/ViewportLayer';

export interface DataImportDialogProps {
  fileName: string;
  plan: ImportPlan;
  currentCalendars: Calendar[];
  busy: boolean;
  error: string | null;
  onConfirm(): void;
  onCancel(): void;
}

const MAX_PREVIEW_EVENTS = 40;

/** Canonical import preview layer, ported from the original centered dialog. */
export function DataImportDialog({
  fileName,
  plan,
  currentCalendars,
  busy,
  error,
  onConfirm,
  onCancel,
}: DataImportDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const events = plan.command.kind === 'replace' ? plan.command.data.events : plan.command.events;
  const calendars =
    plan.command.kind === 'replace' ? plan.command.data.calendars : currentCalendars;
  const colors = useMemo(
    () => new Map(calendars.map((calendar) => [calendar.id, calendar.color])),
    [calendars],
  );

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <ViewportLayer>
      <div
        className="data-import-layer"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) onCancel();
        }}
      >
        <button
          className="data-import-backdrop"
          type="button"
          aria-label="取消匯入"
          disabled={busy}
          onClick={onCancel}
        />
        <section
          className="data-import-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="匯入預覽"
        >
          <header className="data-import-header">
            <h2>匯入預覽</h2>
            <p>
              {fileName} · 共 {plan.preview.events} 筆行程
            </p>
          </header>

          <div className="data-import-summary">
            <span>日曆 {plan.preview.calendars}</span>
            <span>待辦 {plan.preview.todos}</span>
            <span>貼圖 {plan.preview.stickers}</span>
            <span>例外 {plan.preview.eventExceptions}</span>
          </div>

          {plan.preview.mode === 'replace' ? (
            <p className="data-import-impact">
              將取代目前 {plan.preview.replacedTotal} 筆可攜資料；確認前不會寫入。
            </p>
          ) : null}
          {plan.preview.skippedAttachments > 0 ? (
            <p className="data-import-impact">
              備份略過 {plan.preview.skippedAttachments} 個附件；附件不會隨檔案移轉。
            </p>
          ) : null}
          {plan.preview.remappedDuplicateIds > 0 ? (
            <p className="data-import-impact">
              {plan.preview.remappedDuplicateIds} 個重複識別碼會在匯入時重新命名。
            </p>
          ) : null}

          <div className="data-import-list">
            {events.length === 0 ? (
              <p className="data-import-empty">
                這份檔案沒有行程；仍可依上方摘要還原其他資料。
              </p>
            ) : (
              events.slice(0, MAX_PREVIEW_EVENTS).map((event) => {
                const wall = eventWallTime(event);
                const sub = event.allDay
                  ? `全天 · ${wall.date}`
                  : `${wall.start}–${wall.end} · ${wall.date}`;
                return (
                  <div className="data-import-row" key={event.id}>
                    <span
                      className="data-import-dot"
                      style={{ background: colors.get(event.calendarId) ?? '#888888' }}
                      aria-hidden="true"
                    />
                    <div>
                      <strong>{event.title}</strong>
                      <span>
                        {sub}
                        {event.recurrence ? ' · 重複' : ''}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
            {events.length > MAX_PREVIEW_EVENTS ? (
              <p className="data-import-more">
                及其餘 {events.length - MAX_PREVIEW_EVENTS} 筆…
              </p>
            ) : null}
          </div>

          {error ? (
            <p className="data-import-error" role="alert">
              {error}
            </p>
          ) : null}

          <footer className="data-import-actions">
            <button type="button" disabled={busy} onClick={onCancel}>
              取消
            </button>
            <button
              ref={confirmRef}
              className="primary"
              type="button"
              disabled={busy}
              onClick={onConfirm}
            >
              {busy
                ? '匯入中…'
                : plan.preview.mode === 'replace'
                  ? '取代資料'
                  : `匯入 ${previewTotal(plan.preview)} 筆`}
            </button>
          </footer>
        </section>
      </div>
    </ViewportLayer>
  );
}
