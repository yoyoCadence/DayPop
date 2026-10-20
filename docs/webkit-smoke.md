# WebKit smoke（DP-159）

本項從 `52a9692` 的 main 接續，僅增加測試與 CI，不改產品、migration、user-data v4、App 0.4.3、公告或部署。Browser plugin not available，因此使用 repo 的 Playwright 1.62.1。範圍與取捨見 [ADR §7](architecture-decisions.md#7-工程治理)。

## 覆蓋與界線

| 流程 | 驗證結果 |
| --- | --- |
| 啟動 → 四分頁 → 回日曆 | 頁面標題、內容、分頁狀態、無 Vite overlay |
| 新增行程 → 重載 → 刪除 → 重載 | 先看到保存內容，最後確認刪除保持有效 |
| 聚焦新增 → Enter → Shift+Tab 循環 → Escape → 再開／取消 | 焦點不逃出 sheet、背景 inert、關閉後還原焦點 |
| 設定 → 改寵物名字／每週起始日 → 重載 | durable guest envelope 與畫面均保留設定 |

每條使用獨立 context，監看 browser console warning／error 及 pageerror，印出並核對實際 `Asia/Taipei`。模擬 iPhone 13（390×844、touch、DPR 1），不等於 iOS Safari、真機手勢、safe-area、軟鍵盤、standalone、OAuth、實際帳號或離線驗收。DP-032／077 及家庭真機驗收不因此結案。

## 執行

先下載 lockfile 對應的瀏覽器；這不改 package 版本：

```powershell
npx playwright install webkit
```

Windows 本機要避免 `.env.local` 的 Supabase 設定進入 dev server。從 repo 根目錄的 PowerShell，用 Node 的 child env 保留真正的空字串；測試自行啟動的 server 也會繼承它。若 4173 已有 server，先停掉或確認它同樣使用空設定。

```powershell
@'
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, [
  'node_modules/@playwright/test/cli.js', 'test', '--project=webkit-smoke',
], {
  env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
'@ | node
```

`npm run test:e2e` 預設包含兩個 Chromium projects 與四條 WebKit smoke。本機只有 Chromium 時需先 install WebKit；只跑既有矩陣可明確指定 `--project=mobile-chrome --project=desktop-chrome`。CI 的兩個 browser jobs 分開下載，失敗 artifact 名稱也分開；reusable quality gate 包含新增 job，仍須擁有者人工觸發部署。

## 驗證紀錄（2026-10-20）

接線前指定 `--project=webkit-smoke --list` 明確失敗：project 不存在。接線後只列四條，且測試會斷言 browserName 是 webkit，不能用 Chromium 冒充。

本機 Windows 使用 WebKit 26.5／revision 2336，四條通過，實際時區 `Asia/Taipei`。第一輪的焦點回復案例原本以 pointer click 開啟，沒有明確取得鍵盤焦點，已改成先 focus／Enter，其他斷言維持不變。preset 的 screen 是 390×844、viewport 卻是 390×664；核對後在 config 明確覆寫 viewport 為 390×844，並在每條輸出實際 viewport，避免把 screen 尺寸當成測試尺寸。

反向驗證只在本機 context 替換 `Storage.prototype.setItem`，不改產品：初版略過全部 guest 寫入得到兩項失敗（其中行程進入既有保護路徑）；縮小為保留初始化、只略過含行程或新寵物名字的 envelope 後，兩項明確在保存斷言失敗：重載後行程筆數 0（預期 1）、durable 名字仍為「摩卡」（預期新名字）。移除探針後四條 4／4 通過（16.9 秒，覆寫 viewport 前）；負控制沒有提交。

相關 Chromium `guest-crud.spec.ts`／`calendar-sheet-focus.spec.ts` 手機與桌面共 10／10 通過（56 秒）。lint／typecheck、84 檔 1,312 單元＋7 Node、build／check:build 通過；JS 734,390 raw／215,664 gzip bytes，CSS 111,244 raw／27,088 gzip bytes，與本項前相同。只有測試與 CI 變更，未重跑本機 DB／MCP；既有完整 database job 仍由 PR CI 執行。

明確覆寫 390×844 後，本機四條再次 4／4 通過（19.3 秒），每條實際輸出 `{"timezone":"Asia/Taipei","viewport":{"width":390,"height":844}}`；lint／typecheck 再次通過。自我核對發現的 viewport 問題也出現在第一版 PR 自動審查，同一修正已涵蓋。

最新 CI 四個 jobs 通過後才依授權合併；實際 runner 耗時記在 PR，避免為補 CI 數字而讓同一份文件再觸發整輪檢查。未執行部署或查改遠端使用者資料。
