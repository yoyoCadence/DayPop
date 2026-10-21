# 月格 segment／標籤的時區欄位重用（DP-182）

2026-10-22，擁有者明確採用 DP-181 提案；PR #175 四項 CI 全過（Chromium 251 passed／13 skipped），合併為 `cd72ddec4117191b3b1c1893add8a1c02313855a`。從更新後 main 開獨立分支，任務依 Backlog → Next → In Progress 執行。

## 實作與邊界

`MonthView.groupEventsByDate()` 在每次同步呼叫建立自己的 `createZonedPartsReader()`，交給 `eventDisplaySegments()` 及 `eventStartTimeInZone()` 共用。前者新增第五個可選 reader、後者新增第三個；未提供時照舊走原生欄位讀取，因此其他檢視不會自動新增另一份長期快取。

沿用 DP-179 的完整 timezone／epoch milliseconds key、最多 256 筆 FIFO；沒有改 reader 的命中／淘汰或既有 formatter 快取。reader 只含時間欄位，不持有 event、membership 或 snapshot；不附在回傳的 Map／entry／event、不進 state／ref，也不跨 grouping 或持久化。既有 memo 的 occurrences、displayTimezone、firstKey／lastKey 依賴不變；來源、時區、視窗與撤權的重算都拿新的 reader。

只減少重複欄位讀取，沒有改日期／DST／午夜／長事件 clipping、排序／衝突判斷、RRule、展開／visibility 過濾、53 週／鍵盤焦點、React 排程、CSS 或使用者介面。沒有新增使用者文件欄位，不需要 schema version／write barrier；user-data 仍 v4，App 仍 0.4.3、18 migrations，無 Auth／RLS、公告、部署或 Supabase 操作。

## 先失敗、修正及反向驗證

基線七項新回歸失敗，皆為同一對 start／end 原生轉換 5 次而目標 2 次。六個 domain 案例核對帶 reader 與不帶 reader 的完整 segment 陣列及標籤相同，覆蓋紐約 DST 跳過／重複、Santiago 跳過午夜、UTC+14 午夜結尾、UTC−12、跨多年的雙端 window clipping；也核對輸入不變。

真實 MonthView 案例以已解析 occurrence 隔開 resolver 工作，核對跨午夜兩格／tooltip；相同 instants 的來源名稱變更、Taipei → UTC → Taipei 都確實重算，每次增加兩次原生轉換，沒有跨次快取；收到的來源被移除後不再有 chip，原輸入不變。reader 自身的分區、256 上限／淘汰與失敗語意沿既有 eventTime 回歸。

修正後相關三檔 102 項通過。反向把三個產品檔恢復到 `cd72dde`，同樣七項失敗；finally 還原後兩檔 78 項通過。沒有用執行時間當回歸斷言，既有其他日期／排序／衝突與例外測試完整保留。

## 同程序 paired measurement

```text
npm run measure:month-display -- --baseline=cd72ddec4117191b3b1c1893add8a1c02313855a --output=output/playwright/dp182-month-display.json
```

只用 DP-181 的 20 個每日系列假資料及三個固定 53 週視窗，不讀帳號／storage、不啟 server、不載入 Supabase 設定。工具以 Vite `configFile:false` 產生兩份 disposable ES module；baseline 僅把這次修改的三個產品檔由指定 git commit 載入，其餘 source 共用本分支版本。PR 的其餘產品檔未變，因此這是同一份基線的對照。未來重跑應使用本 PR 的版本，不把其他修改混進來。

量測建置只替實際 MonthView source 附加 private `groupEventsByDate` 的 export；正常產品不新增 export、工具也不複製其演算法，並要求 baseline 三檔都確實由 git 版本載入。occurrence 展開在 interval 外完成，各 variant 完整輸入 JSON 必須相同；先 warm-up，再單獨攔原生 `formatToParts` 計數並還原，四次計時時沒有 spy，順序 baseline/candidate → candidate/baseline 交替。每次完整輸出 hash 相同、原輸入不變，guard 要求 371 個日期與 7,420 entries；no-op grouping 負控制確實由 `missing display days` 拒絕，finally 還原後才正式量測。

| 53 週起日 | occurrences／entries | 原生轉換：baseline → candidate | baseline 四次 ms 範圍 | candidate 四次 ms 範圍 |
| --- | ---: | ---: | ---: | ---: |
| 2026-04-19 | 7,420／7,420 | 37,100 → 7,791 | 131.2–138.1 | 54.4–58.6 |
| 2027-09-05 | 7,420／7,420 | 37,100 → 7,791 | 128.3–136.3 | 54.1–55.6 |
| 2029-01-21 | 7,420／7,420 | 37,100 → 7,791 | 127.4–130.5 | 52.7–57.2 |

本假資料相鄰半小時行程共用端點，所以每日 20 筆只有 21 個相異 instants；短 memo 可連同相鄰 entries 重用。這不是對任意資料都承諾的固定呼叫數。原始值、完整輸入／輸出 SHA、候選 source bytes SHA 與 Node／OS／CPU 見 [JSON](month-display-reuse-measurement-2026-10-22.json)，量測 UTC 時刻為 2026-10-21T23:21:25Z（裝置為 10-22）。自查補上 baseline 三檔載入 guard 後重跑，表與 raw 以最終工具為準；source SHA 是當時工作樹原始 bytes，換行可隨平台／checkout 改變。實際 Node timezone `Etc/GMT-8` 已印出；只有 native performance 計時，沒有 Date proxy、profiler 或同時跑其他重工作。

這是 grouping 這一段的同程序對照，**不包含 resolver、clipping、衝突 pair、React render／DOM／paint 或實際捲動**。不與 DP-181 的含 profiler／Date proxy browser 數字相減，也不宣稱整體改善百分比、真機 FPS、percentile 或全部秒級成本已消失。樣本小、沒有鎖 CPU／熱狀態，毫秒數不是 CI gate。剩餘 RRule／時區展開、display clipping 與 `hasOverlap` 仍按原語意計算，後續各自依證據規劃，不在本項混改。

## 品質與實際渲染

lint／typecheck、完整 1,347 單元＋17 Node、build／check:build 通過。PowerShell 設定並印出實際 America/New_York 後，六檔日期／月格／screen 回歸 175 項通過。JS 735,747 raw／216,170 gzip bytes，CSS 111,265／27,099，均在原 budget。

相關手機／桌面／WebKit 矩陣 47 passed／3 desktop 不適用 skipped：月格容量／線條、雙向視窗／焦點／今天／搜尋／旋轉、事件時區、跨午夜與重複單次／全部／取消、共享／離線／撤權與草稿、WebKit 四分頁／保存／焦點。child env 明確清空 Supabase URL／publishable key，實際 browser timezone 都印為 Asia/Taipei；本次 hidden server 核對 PID／parent／command line 後已停止。

Browser plugin not available，沿既有 Playwright 做 canonical 對照。原始 `.dc.html`／React 分別在 390×844、1280×900，以固定 2026-08-06、寵物關閉、六列、漫畫淺色空資料／深色同一筆 Planning 拍攝八張。React 四個畫面皆 53 週、無水平溢出／console warning／error；原稿同樣四條未解析 native input template 的既有 warning，與 DP-180 一致。已檢視手機深色與桌面淺色的原稿／React 配對；控制順序與畫面內容保留，手機展示框、原稿首週日期的初始裁切、title-only 標籤、深色灰細線與對比文字維持既有差異，本次 JSX／CSS／定位程式均未改。圖片及 summary 留本機 temp `daypop-dp182-visual-Ng2cXY`，不提交圖片／原稿／generated support.js。

最新 head 的四項 CI 與審查完成才依持續授權合併。真機、standalone 與實際家庭帳號仍待擁有者驗收。
