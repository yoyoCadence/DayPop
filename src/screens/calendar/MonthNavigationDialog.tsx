import { useRef } from 'react';
import { useModalFocus } from '../../shell/useModalFocus';
import { ViewportLayer } from '../../shell/ViewportLayer';
import type { MonthNavigation } from './monthNavigation';

export function MonthNavigationDialog({ mode, onChoose, onClose }: {
  mode: MonthNavigation;
  onChoose(mode: MonthNavigation): void;
  onClose(): void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  useModalFocus(layer, { onEscape: onClose });
  return (
    <ViewportLayer>
      <div className="cal-scope-layer" ref={layer}>
        <div className="cal-scope-backdrop" onClick={onClose} />
        <div className="cal-scope-card" role="dialog" aria-modal="true" aria-label="月曆顯示方式">
          <div className="cal-scope-title">月曆顯示方式</div>
          <div className="cal-scope-msg">記住此裝置的顯示方式。</div>
          <button className="cal-scope-all cal-month-mode-choice" type="button" aria-pressed={mode === 'continuous'} onClick={() => onChoose('continuous')}>
            <span>連續捲動</span><span>上下滑動，月份相連</span>
          </button>
          <button className="cal-scope-all cal-month-mode-choice" type="button" aria-pressed={mode === 'paged'} onClick={() => onChoose('paged')}>
            <span>單月翻頁</span><span>一次顯示一個月，左右換月</span>
          </button>
          <button className="cal-scope-cancel" type="button" onClick={onClose}>取消</button>
        </div>
      </div>
    </ViewportLayer>
  );
}
