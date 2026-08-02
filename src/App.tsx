import { useState } from 'react';
import { AuthDialog } from './auth/AuthDialog';
import { UpdateDialog } from './pwa/UpdateDialog';
import { useAppUpdate } from './pwa/useAppUpdate';
import { CalendarScreen, type CalendarFocus } from './screens/calendar/CalendarScreen';
import { OverviewScreen } from './screens/OverviewScreen';
import { SearchScreen } from './screens/SearchScreen';
import { SettingsScaffoldScreen } from './screens/SettingsScaffoldScreen';
import { AppShell } from './shell/AppShell';
import type { ShellTab } from './shell/tabs';

/**
 * Routes the four canonical tabs into the App shell.
 *
 * The update checker lives here rather than in the 設定 screen so that a new
 * release is still detected while the user is on any tab.
 */
export default function App() {
  const [tab, setTab] = useState<ShellTab>('cal');
  const [authOpen, setAuthOpen] = useState(false);
  // Tapping a result in 搜尋 or 綜覽 opens it on the 日曆 tab, as in the原檔.
  // Screens unmount when the tab changes, so `CalendarScreen` reads this once as
  // its initial state — no effect needed.
  const [calendarFocus, setCalendarFocus] = useState<CalendarFocus | null>(null);
  const updater = useAppUpdate();

  function focusCalendar(focus: CalendarFocus) {
    setCalendarFocus(focus);
    setTab('cal');
  }

  function changeTab(next: ShellTab) {
    // A plain tab tap is not a focus request; clearing here stops a stale focus
    // from re-opening a sheet the next time 日曆 is visited.
    setCalendarFocus(null);
    setTab(next);
  }

  return (
    <AppShell
      tab={tab}
      onTabChange={changeTab}
      dialogs={
        <>
          <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
          {updater.availableRelease && (
            <UpdateDialog
              release={updater.availableRelease}
              preparing={updater.preparing}
              onUpdate={() => void updater.updateNow()}
              onLater={updater.dismissUpdate}
            />
          )}
        </>
      }
    >
      {tab === 'cal' && (
        <CalendarScreen focus={calendarFocus} onGoSearch={() => changeTab('search')} />
      )}
      {tab === 'search' && (
        <SearchScreen
          onOpenEvent={(id) => focusCalendar({ kind: 'event', id })}
          onOpenDay={(dateKey) => focusCalendar({ kind: 'day', dateKey })}
        />
      )}
      {tab === 'overview' && (
        <OverviewScreen onOpenEvent={(id) => focusCalendar({ kind: 'event', id })} />
      )}
      {tab === 'settings' && (
        <SettingsScaffoldScreen updater={updater} onOpenAuth={() => setAuthOpen(true)} />
      )}
    </AppShell>
  );
}
