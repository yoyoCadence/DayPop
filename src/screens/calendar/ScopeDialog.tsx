import { useRef } from 'react';
import { useModalFocus } from '../../shell/useModalFocus';
import { ViewportLayer } from '../../shell/ViewportLayer';

/** Which question the dialog is asking — the原檔's `scopeAsk.mode`. */
export type ScopeMode = 'save' | 'delete';

export interface ScopeDialogProps {
  mode: ScopeMode | null;
  onThis(): void;
  onAll(): void;
  onCancel(): void;
}

/**
 * 原稿 `:430-439` 的重複事件範圍對話框。
 *
 * 四段文案逐字搬自原稿 `:1372` 的三元式，包括「只改這一次」與「套用全部」
 * 兩個按鈕在刪除模式下換成「只刪這一次」與「刪除全部」。
 *
 * The原檔 opens this from `saveEvent()`/`deleteEvent()` whenever the event
 * being edited repeats, and `scopeApply(kind)` then branches. DayPop keeps
 * that shape: 全部 goes to `updateEvent`/`deleteEvent`, 這一次 goes to
 * `replaceEventOccurrence`/`cancelEventOccurrence`.
 */
export function ScopeDialog({ mode, ...rest }: ScopeDialogProps) {
  // Mounted only while asking, so the shared focus rules register when the
  // question appears and hand focus back when it goes.
  if (!mode) return null;
  return <ScopeQuestion mode={mode} {...rest} />;
}

function ScopeQuestion({ mode, onThis, onAll, onCancel }: ScopeDialogProps & { mode: ScopeMode }) {
  // Tab stays on these three buttons, focus starts on the first, and Escape
  // means "I did not mean to save", not "throw away my edits": being the
  // topmost layer, it closes this question and leaves the event sheet below
  // with its draft (DP-155, which replaced this dialog's own key handling).
  const layer = useRef<HTMLDivElement>(null);
  useModalFocus(layer, { onEscape: onCancel });

  const deleting = mode === 'delete';
  const title = deleting ? '刪除重複事件' : '修改重複事件';

  return (
    <ViewportLayer>
      <div className="cal-scope-layer" ref={layer}>
        <div className="cal-scope-backdrop" onClick={onCancel} />
        <div className="cal-scope-card" role="dialog" aria-modal="true" aria-label={title}>
          <div className="cal-scope-title">{title}</div>
          <div className="cal-scope-msg">
            {deleting ? '這是重複事件，要刪除哪些？' : '這是重複事件，變更要套用到哪些？'}
          </div>
          <button className="cal-scope-this" type="button" onClick={onThis}>
            {deleting ? '只刪這一次' : '只改這一次'}
          </button>
          <button className="cal-scope-all" type="button" onClick={onAll}>
            {deleting ? '刪除全部' : '套用全部'}
          </button>
          <button className="cal-scope-cancel" type="button" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </ViewportLayer>
  );
}
