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
