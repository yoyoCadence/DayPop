# 重模組載入評估（DP-161）

2026-10-21，從 `main` 的 `498e42a` 接續 DP-160。這次只新增建置量測與結論；產品仍採原本的同步載入方式。

## 方法與可重跑方式

```text
npm run measure:module-loading -- --output=output/playwright/module-loading.json
```

腳本使用 repo 的 Vite production config，將兩個 Supabase 環境變數明確設為空字串，以 `write: false` 建置，不改 `dist/`、不啟動 server、不讀帳號或使用者資料。它從最終 build output 計算 UTF-8 bytes 與逐檔 `gzipSync`；額外列出 `public/sw.js`。所有 generateBundle hooks 結束後才取最終大小，避免把 Vite 後處理前的內容當作產物。

模組歸因採 bundler 提供的 `renderedLength`，用來比較 tree shaking 後各模組的相對份量。**它不是最終 minified bytes、逐模組 gzip，也不能加減成拆分後的下載節省量**。輸出同時記錄從 `src/main.tsx` 出發的最短靜態路徑與目標的直接 static importers；動態依賴不加入搜尋圖。路徑已移除工作目錄，不含憑證。原始結果見 [2026-10-21 JSON](module-loading-measurement-2026-10-21.json)。

## 結果與建議

目前只有一個 entry JS chunk，沒有 dynamic imports。最終 entry 為 **732,451 raw／214,841 gzip bytes**；加上 worker 的 JS 總量為 **734,304／215,605 bytes**，CSS 為 **111,244／27,088 bytes**，與同樣空 Supabase 設定的 `npm run build`／`check:build` 一致。Vite reporter 自己的 gzip 顯示與本項的 Node `gzipSync` 口徑不同，以本項／DP-119 的逐檔計量為準。

較大的 dependency 歸因包含 React DOM（459,807）、Supabase Auth（168,386）、rrule（78,484），以及其他 Supabase client 子套件；這些數字都是 `renderedLength`，不是可直接延後的傳輸 bytes。

| 候選 | 靜態路徑／現況 | 建議 |
| --- | --- | --- |
| 設定頁 | `main → App → SettingsScaffoldScreen`，歸因 25,330 | 可以另外評估畫面 lazy loading，但只拆設定頁仍不會移除 ICS／備份依賴；尚無首屏 CPU／網路證據支持這項收益。 |
| JSON 備份 | `App → backupDownload → dataTransfer`；備份出口本身僅 423，還供錯誤畫面使用 | 保留錯誤畫面即時備份出口。不要為拆 chunk 把資料邊界或錯誤處理移入畫面。 |
| ICS | `dataTransfer → ics`，ICS 歸因 12,822；`dataTransfer` 同時被 DataProvider、兩個 repository、設定／預覽／備份使用 | 單獨 lazy 設定頁或替換一個 import 不足以延後；需要先把純匯入命令／JSON 與 ICS 編解碼的依賴整理清楚，再測實際 split build。這次不為有限且未量到的首屏收益改動穩定邊界。 |
| 重複事件 | `CalendarScreen → calendars → recurrence`，另被 validation、mutations、ICS、EventSheet 引用；rrule 也在首屏使用 | 不適合以「偶爾才用」直接延後。先處理 DP-178 已量到的展開成本；改 async 會波及 domain 驗證／日曆契約，並未解決展開本身慢。 |
| Supabase client | 即使這次是 guest build，仍包含 Auth／Storage 等 client code | 帳號啟動需要它；不得單憑 bundle 歸因就刪除子套件或改 Auth 啟動。若日後量到 guest 啟動瓶頸，另做帳號初始化的專項評估。 |

**定案：目前不拆分。** Vite 的 500 kB 單 chunk 警告保留，DP-119 的總量 budget 也保留。這是評估後的選擇，並不表示目前首屏效能已達標；本次沒有網路 throttling、parse／execute、LCP 或真機啟動量測。優先接續 DP-178 的 profile，因為它已有可重現的秒級操作成本。

## 離線邊界與後續條件

目前 worker 的 install 只預快取 HTML、manifest、icon；`/assets/` 在實際請求成功後才加入 app-shell cache。若之後新增 lazy chunk，曾啟動 App 但尚未操作該功能的裝置，離線首次打開該功能可能拿不到 chunk。不能把 DP-099 的「已快取 App」直接外推為所有 lazy 功能可用。

真正實作拆分前需量到首屏收益，並決定：是否 online 預暖功能 chunk、尚未快取時的離線提示／重試、chunk 更新或下載失敗時如何保留草稿。測試需涵蓋「控制後已快取／未快取」兩種離線情境、備份與 ICS 原有行為。拆分後仍把所有 chunk 算入總量 budget，不能以分檔隱藏增加的成本。本次產品與 worker 均未修改，重跑既有 production offline／ICS 回歸確認現狀。

## 驗證與限制

分析器五項 Node 回歸覆蓋共同依賴、動態依賴排除、循環、最短路徑、缺少入口及「只移除設定仍有 eager 路徑」。先在缺少實作時失敗；完成後刻意移除成功路徑回傳，四項失敗、一項通過，恢復後五項通過。這是分析工具的負控制，沒有聲稱修正產品缺陷。

lint、typecheck、1,312 單元＋12 Node 測試、build、check:build 通過；最終 JS／CSS／worker 與 `dist/` 的 raw／gzip 大小逐檔核對一致。手機／桌面的 ICS 與 production offline 共 10 項 e2e 通過，Node Etc/GMT-8、ICS browser America/New_York、offline browser Asia/Taipei 均實際列印。使用 repo Playwright，因本 session 沒有 Browser plugin。

版本仍 0.4.3、資料 schema v4、18 檔 migration。不改 Auth、domain／repository、UI、CSP、公告或部署。原始 JSON 記錄實際 Node 時區；檔案大小不受日期／時區效能影響。
