import type { ReactNode } from 'react';
import { SHELL_TABS, SHELL_TAB_LABELS, type ShellTab } from './tabs';

export interface TabBarProps {
  active: ShellTab;
  onSelect(tab: ShellTab): void;
}

/**
 * Bottom four-tab navigation, transcribed from the tab bar of
 * `日曆桌寵 Calendar Pet.dc.html`: 22px stroked icons over a 10px label, the
 * active tab in `--accent` and the rest in `--faint`.
 */
export function TabBar({ active, onSelect }: TabBarProps) {
  return (
    <nav className="dp-tabbar" aria-label="主導覽">
      {SHELL_TABS.map((tab) => (
        <button
          key={tab}
          className="dp-tab"
          type="button"
          aria-current={tab === active ? 'page' : undefined}
          onClick={() => onSelect(tab)}
        >
          {TAB_ICONS[tab]}
          <span className="dp-tab-label">{SHELL_TAB_LABELS[tab]}</span>
        </button>
      ))}
    </nav>
  );
}

const iconProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  'aria-hidden': true,
} as const;

const TAB_ICONS: Record<ShellTab, ReactNode> = {
  cal: (
    <svg {...iconProps}>
      <rect x="3.5" y="5" width="17" height="16" rx="3" />
      <line x1="3.5" y1="9.5" x2="20.5" y2="9.5" />
      <line x1="8" y1="3" x2="8" y2="6" />
      <line x1="16" y1="3" x2="16" y2="6" />
    </svg>
  ),
  search: (
    <svg {...iconProps}>
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  ),
  overview: (
    <svg {...iconProps}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  ),
  settings: (
    <svg {...iconProps}>
      <line x1="4" y1="8" x2="20" y2="8" />
      <circle cx="10" cy="8" r="2.5" fill="var(--surface)" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="15" cy="16" r="2.5" fill="var(--surface)" />
    </svg>
  ),
};
