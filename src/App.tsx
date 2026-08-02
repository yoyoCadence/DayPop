import { useState } from 'react';
import { AuthDialog } from './auth/AuthDialog';
import { UpdateDialog } from './pwa/UpdateDialog';
import { useAppUpdate } from './pwa/useAppUpdate';
import { CalendarScaffoldScreen } from './screens/CalendarScaffoldScreen';
import { PendingScreen } from './screens/PendingScreen';
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
  const updater = useAppUpdate();

  return (
    <AppShell
      tab={tab}
      onTabChange={setTab}
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
      {tab === 'cal' && <CalendarScaffoldScreen />}
      {tab === 'search' && (
        <PendingScreen
          title="搜尋"
          taskId="DP-014"
          summary="原稿的搜尋頁有完整的關鍵字流程，還沒有搬到 React。"
          contents={[
            '關鍵字欄位與即時結果',
            '全部／各日曆篩選 chips',
            '搜尋提示與空狀態',
            '點擊結果開啟事件 sheet',
          ]}
        />
      )}
      {tab === 'overview' && (
        <PendingScreen
          title="綜覽"
          taskId="DP-014"
          summary="原稿的綜覽頁可依時間範圍統計行程、待辦與貼圖，還沒有搬到 React。"
          contents={[
            '行程／待辦／貼圖切換',
            '年／月／週時間範圍與前後期、今天',
            '筆數統計與可展開內容',
          ]}
        />
      )}
      {tab === 'settings' && (
        <SettingsScaffoldScreen updater={updater} onOpenAuth={() => setAuthOpen(true)} />
      )}
    </AppShell>
  );
}
