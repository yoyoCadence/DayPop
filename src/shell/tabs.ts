/**
 * The four canonical bottom tabs of the Claude Design prototype.
 * Order and labels come from the tab bar in `日曆桌寵 Calendar Pet.dc.html`.
 */
export const SHELL_TABS = ['cal', 'search', 'overview', 'settings'] as const;

export type ShellTab = (typeof SHELL_TABS)[number];

export const SHELL_TAB_LABELS: Record<ShellTab, string> = {
  cal: '日曆',
  search: '搜尋',
  overview: '綜覽',
  settings: '設定',
};
