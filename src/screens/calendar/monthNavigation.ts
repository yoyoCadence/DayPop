import { getAppStorage } from '../../storage/browserStorage';

/** Device UI state, outside the user's versioned document and cloud preferences. */
export type MonthNavigation = 'continuous' | 'paged';
export const MONTH_NAVIGATION_KEY = 'daypop.month-navigation.v1';

export function readMonthNavigation(): MonthNavigation {
  return getAppStorage().getItem(MONTH_NAVIGATION_KEY) === 'paged' ? 'paged' : 'continuous';
}

export function saveMonthNavigation(mode: MonthNavigation): void {
  // AppStorage keeps its existing memory-mode warning if persistence fails.
  getAppStorage().setItem(MONTH_NAVIGATION_KEY, mode);
}

/**
 * Which way a swipe turns the page in 單月翻頁 (DP-261). Also device UI state,
 * outside user data; horizontal unless this device chose vertical.
 */
export type MonthSwipe = 'horizontal' | 'vertical';
export const MONTH_SWIPE_KEY = 'daypop.month-swipe.v1';

export function readMonthSwipe(): MonthSwipe {
  return getAppStorage().getItem(MONTH_SWIPE_KEY) === 'vertical' ? 'vertical' : 'horizontal';
}

export function saveMonthSwipe(swipe: MonthSwipe): void {
  getAppStorage().setItem(MONTH_SWIPE_KEY, swipe);
}
