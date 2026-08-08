import { useState, type FormEvent } from 'react';
import { calendarSwatches } from '../domain/calendars';
import type { Calendar } from '../domain/types';
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
  onSave(values: { name: string; color: string }): void;
  onDelete(): void;
  onClose(): void;
}

/**
 * 日曆編輯 dialog, ported from the `calEditOpen` block of
 * `日曆桌寵 Calendar Pet.dc.html`. Used for both 新增日曆 and 編輯日曆.
 *
 * The delete note is the one addition to the原檔: DayPop moves a deleted
 * calendar's rows to the surviving default instead of orphaning them, and
 * moving someone's data without saying so would be worse than the extra line.
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({ name, color });
  }

  return (
    <ViewportLayer>
      <div className="cal-manage-layer">
        <div className="cal-manage-backdrop" onClick={onClose} />
        <form
          className="cal-manage-dialog"
          onSubmit={submit}
          // Announced as a modal like the two calendar sheets are. Without this
          // a screen reader keeps reading the 設定 list behind the backdrop as
          // if it were still reachable.
          role="dialog"
          aria-modal="true"
          aria-label={calendar ? '編輯日曆' : '新增日曆'}
        >
          <div className="cal-manage-title">{calendar ? '編輯日曆' : '新增日曆'}</div>

          <label className="cal-manage-label" htmlFor="calendar-name">
            名稱
          </label>
          <input
            id="calendar-name"
            className="cal-manage-input"
            value={name}
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
            <button className="cal-manage-save" type="submit">
              儲存
            </button>
            <button className="cal-manage-cancel" type="button" onClick={onClose}>
              取消
            </button>
          </div>

          {canDelete && (
            <>
              <button className="cal-manage-delete" type="button" onClick={onDelete}>
                刪除此日曆
              </button>
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
