import { useState, type ReactNode } from 'react';
import { useTheme } from '../theme/themeContext';
import { TabBar } from './TabBar';
import type { ShellTab } from './tabs';
import { AppViewportContext } from './viewportContext';
import './shell.css';

export interface AppShellProps {
  tab: ShellTab;
  onTabChange(tab: ShellTab): void;
  /** The active tab screen. Screens render their own `.dp-screen` root. */
  children: ReactNode;
  /**
   * Floating layers that sit above the app body but inside the viewport —
   * FAB, App 內浮動寵物, reminder toast. Wired up by DP-051 / DP-040.
   */
  overlay?: ReactNode;
  /**
   * Sheets and dialogs. Rendered last so their backdrop covers the tab bar,
   * and inside the viewport so they never break out of the preview frame.
   */
  dialogs?: ReactNode;
}

/**
 * Canonical App shell: viewport, safe area, top status area, bottom four tabs,
 * and the desktop-only 404 × 824 phone preview frame.
 *
 * The notch and status bar are simulated device chrome and exist only in the
 * desktop preview; on a phone or an installed PWA the same DOM renders as plain
 * App content inside the real safe area. See
 * `docs/claude-design-source-of-truth.md` § 手機 App 與桌面預覽外框.
 */
export function AppShell({ tab, onTabChange, children, overlay, dialogs }: AppShellProps) {
  const { cssVariables, theme, mode } = useTheme();
  // Published so sheets and dialogs can portal into the viewport instead of
  // escaping the preview frame — see `ViewportLayer`.
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);

  return (
    <div className="dp-preview" style={cssVariables}>
      <div className="dp-phone">
        <div className="dp-viewport" ref={setViewport}>
          <div className="dp-texture" aria-hidden="true" />
          <div className="dp-notch" aria-hidden="true" />
          <PreviewStatusBar />
          <AppViewportContext.Provider value={viewport}>
            <div className="dp-appbody">{children}</div>
            {overlay ? <div className="dp-overlay">{overlay}</div> : null}
            <TabBar active={tab} onSelect={onTabChange} />
            {dialogs}
          </AppViewportContext.Provider>
        </div>
      </div>
      <div className="dp-preview-caption">
        目前主題：<b>{theme.name}</b>（{mode === 'dark' ? '深色' : '淺色'}）· 到「設定」可切換 6
        種風格與淺／深色
      </div>
    </div>
  );
}

/**
 * Simulated iOS status bar. Preview chrome only — hidden on phones and in the
 * installed PWA, where the real OS status bar sits above the safe area instead.
 */
function PreviewStatusBar() {
  return (
    <div className="dp-statusbar" aria-hidden="true">
      <div className="dp-statusbar-time">9:41</div>
      <div className="dp-statusbar-right">
        <span>5G</span>
        <div className="dp-statusbar-battery" />
      </div>
    </div>
  );
}
