import { useEffect, useRef, useState, type FormEvent } from 'react';
import { calendarSwatches } from '../domain/calendars';
import { createDomainId, type Calendar } from '../domain/types';
import { ViewportLayer } from '../shell/ViewportLayer';
import './calendarManage.css';

export interface CalendarEditDialogProps {
  /** The calendar being edited, or null when creating a new one. */
  calendar: Calendar | null;
  /** Colour offered to a new calendar, from the palette. */
  suggestedColor: string;
  /** False when this is the only calendar, matching `calEditCanDelete`. */
  canDelete: boolean;
  /** How many events, todos and stickers would move on delete. */
  itemCount: number;
  /** Where those items would move to. */
  reassignTargetName: string;
  /**
   * A synchronous callback has already confirmed; production awaits the queue
   * (DP-141). `draftId` stays the same for every attempt from this dialog, so
   * a retried 新增日曆 reaches the row an unconfirmed attempt may have stored
   * (DP-142); it means nothing when an existing calendar is being edited.
   */
  onSave(values: { name: string; color: string }, draftId: string): Promise<void> | void;
  onDelete(): Promise<void> | void;
  onClose(): void;
}

/** Which confirmed write the dialog is waiting for — DP-141. */
type WriteKind = 'save' | 'delete';

/**
 * 日曆編輯 dialog, ported from the `calEditOpen` block of
 * `日曆桌寵 Calendar Pet.dc.html`. Used for both 新增日曆 and 編輯日曆.
 *
 * The delete note is the one addition to the原檔: DayPop moves a deleted
 * calendar's rows to the surviving default instead of orphaning them, and
 * moving someone's data without saying so would be worse than the extra line.
 *
 * DP-141 adds the waiting and failure states the原檔's synchronous local save
 * never needed. The dialog closes itself once the write is confirmed; until
 * then it cannot be dismissed or submitted again, and a failure stays here
 * with the typed name and colour instead of only in the App-wide banner.
 */
export function CalendarEditDialog({
  calendar,
  suggestedColor,
  canDelete,
  itemCount,
  reassignTargetName,
  onSave,
  onDelete,
  onClose,
}: CalendarEditDialogProps) {
  const [name, setName] = useState(calendar?.name ?? '');
  const [color, setColor] = useState(calendar?.color ?? suggestedColor);
  const swatches = calendarSwatches(calendar?.color ?? null);
  // Decided once, when the dialog opens. A confirmed deletion removes the row
  // from the data a moment before this dialog is told to close, and the
  // heading must not flip to 新增日曆 in between.
  const [heading] = useState(calendar ? '編輯日曆' : '新增日曆');
  const [draftId] = useState(createDomainId);
  const pending = useRef(false);
  const mounted = useRef(true);
  const [pendingKind, setPendingKind] = useState<WriteKind | null>(null);
  const busy = pendingKind !== null;
  const [failure, setFailure] = useState<{ kind: WriteKind; message: string } | null>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A control that is disabled while focused drops focus to <body>. Hand it
  // back to the button that was pressed, but never take it from anything else.
  useEffect(() => {
    if (busy || !failure || document.activeElement !== document.body) return;
    (failure.kind === 'delete' ? deleteButton : saveButton).current?.focus();
  }, [busy, failure]);

  /** Closes only once the queued write confirms; nothing is re-sent on failure. */
  async function confirmWrite(kind: WriteKind, operation: () => Promise<void> | void) {
    if (pending.current) return;
    pending.current = true;
    setPendingKind(kind);
    setFailure(null);
    try {
      const result = operation();
      if (result !== undefined) await result;
      if (mounted.current) onClose();
    } catch (cause) {
      if (mounted.current) {
        const reason = cause instanceof Error ? cause.message : kind === 'delete' ? '未能確認刪除。' : '未能確認保存。';
        const kept = kind === 'delete' ? '尚未確認刪除' : '名稱與顏色已保留';
        setFailure({ kind, message: `${reason} ${kept}；請先確認資料再重試。` });
      }
    } finally {
      pending.current = false;
      if (mounted.current) setPendingKind(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void confirmWrite('save', () => onSave({ name, color }, draftId));
  }

  return (
    <ViewportLayer>
      <div className="cal-manage-layer">
        <div
          className="cal-manage-backdrop"
          onClick={() => {
            if (!pending.current) onClose();
          }}
        />
        <form
          className="cal-manage-dialog"
          onSubmit={submit}
          // Announced as a modal like the two calendar sheets are. Without this
          // a screen reader keeps reading the 設定 list behind the backdrop as
          // if it were still reachable.
          role="dialog"
          aria-modal="true"
          aria-label={heading}
          aria-busy={busy}
        >
          <div className="cal-manage-title">{heading}</div>

          <label className="cal-manage-label" htmlFor="calendar-name">
            名稱
          </label>
          <input
            id="calendar-name"
            className="cal-manage-input"
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：工作、家庭、健身"
            autoFocus
          />

          <div className="cal-manage-label">顏色</div>
          <div className="cal-manage-swatches" role="group" aria-label="日曆顏色">
            {swatches.map((hex) => (
              <button
                key={hex}
                className="cal-manage-swatch"
                type="button"
                aria-label={`顏色 ${hex}`}
                aria-pressed={color === hex}
                disabled={busy}
                onClick={() => setColor(hex)}
                style={{
                  background: hex,
                  boxShadow:
                    color === hex ? '0 0 0 3px var(--accent)' : '0 0 0 1.5px rgba(0, 0, 0, 0.15)',
                }}
              />
            ))}
          </div>

          <div className="cal-manage-actions">
            <button ref={saveButton} className="cal-manage-save" type="submit" disabled={busy}>
              {pendingKind === 'save' ? '保存中…' : '儲存'}
            </button>
            <button className="cal-manage-cancel" type="button" disabled={busy} onClick={onClose}>
              取消
            </button>
          </div>
          {failure?.kind === 'save' && (
            <p className="cal-manage-error" role="alert">
              {failure.message}
            </p>
          )}

          {canDelete && (
            <>
              <button
                ref={deleteButton}
                className="cal-manage-delete"
                type="button"
                disabled={busy}
                onClick={() => void confirmWrite('delete', onDelete)}
              >
                {pendingKind === 'delete' ? '刪除中…' : '刪除此日曆'}
              </button>
              {/* Next to the control that failed, before the standing note. */}
              {failure?.kind === 'delete' && (
                <p className="cal-manage-error" role="alert">
                  {failure.message}
                </p>
              )}
              {itemCount > 0 && (
                <p className="cal-manage-delete-note">
                  這個日曆的 {itemCount} 筆資料會移到「{reassignTargetName}」，不會被刪除。
                </p>
              )}
            </>
          )}
        </form>
      </div>
    </ViewportLayer>
  );
}
