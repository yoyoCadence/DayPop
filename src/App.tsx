import { useState } from 'react';
import { AuthDialog } from './auth/AuthDialog';
import { useDayPopDataState } from './data/dataContext';
import { useStorageMode } from './hooks/useStorageMode';
import { UpdateDialog } from './pwa/UpdateDialog';
import { useAppUpdate } from './pwa/useAppUpdate';
import { CalendarScreen, type CalendarFocus } from './screens/calendar/CalendarScreen';
import { DataRecoveryScreen } from './screens/DataRecoveryScreen';
import { OverviewScreen } from './screens/OverviewScreen';
import { SearchScreen } from './screens/SearchScreen';
import { SettingsScaffoldScreen } from './screens/SettingsScaffoldScreen';
import { AppShell } from './shell/AppShell';
import { StorageWarningBanner } from './shell/StorageWarningBanner';
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

  // Shown on every tab while the browser refuses to persist data — DP-017.
  const storageMode = useStorageMode();
  const banner =
    storageMode.kind === 'memory' ? <StorageWarningBanner reason={storageMode.reason} /> : null;

  // Checked before any screen mounts. A screen that mounted over unreadable
  // data would write a blank state over it on the first edit — DP-016. The
  // provider owns this state now, so a write refused mid-session lands here
  // too, without every screen having to plumb the error up.
  const { state, refresh } = useDayPopDataState();

  if (state.status === 'blocked') {
    return (
      <AppShell tab="cal" onTabChange={() => {}} banner={banner} hideTabBar>
        <DataRecoveryScreen result={state.result} onRecovered={refresh} />
      </AppShell>
    );
  }

  // Unreachable with the guest adapter, which loads synchronously. Kept as a
  // plain engineering placeholder until DP-026 wires the remote adapter in and
  // decides what a load failure should actually look like.
  if (state.status !== 'ready') {
    return (
      <AppShell tab="cal" onTabChange={() => {}} banner={banner} hideTabBar>
        <div className="dp-screen-body">
          <p className="dp-note">{state.status === 'failed' ? state.message : '載入中…'}</p>
        </div>
      </AppShell>
    );
  }

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
      banner={banner}
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
        <OverviewScreen
          onOpenEvent={(id) => focusCalendar({ kind: 'event', id })}
          onOpenDay={(dateKey) => focusCalendar({ kind: 'day', dateKey })}
        />
      )}
      {tab === 'settings' && (
        <SettingsScaffoldScreen updater={updater} onOpenAuth={() => setAuthOpen(true)} />
      )}
    </AppShell>
  );
}
