import { useCallback, useSyncExternalStore } from 'react';
import { instantDateInZone } from '../domain/eventTime';

// Only the active screen subscribes. Compare the date key rather than storing
// every clock tick, so minutes within the same day do not redraw the screen.
function subscribe(refresh: () => void) {
  const timer = window.setInterval(refresh, 60_000);
  const onVisible = () => {
    if (document.visibilityState === 'visible') refresh();
  };
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** Today in the saved display zone, including midnight and foreground resume. */
export function useTodayKey(timezone: string): string {
  const snapshot = useCallback(
    () => instantDateInZone(new Date().toISOString(), timezone),
    [timezone],
  );
  return useSyncExternalStore(subscribe, snapshot);
}
