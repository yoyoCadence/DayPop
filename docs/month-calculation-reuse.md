# 單次月曆展開的計算重用（DP-179）

承接 DP-178 PR #172 的 `f298eae` 與擁有者已確認的分段計畫。這一項只減少日期轉換的重複工作，不改 MonthView buffer／焦點；53 週滑動視窗另由 DP-180 實作。

## 改動與邊界

`eventTime.createZonedPartsReader()` 以完整 timezone 字串與 epoch milliseconds 為 key，只重用相同輸入的時區欄位，最多 256 筆、FIFO 淘汰。既有每個 timezone 的 formatter 快取不變；牆上時間兩次校正、DST gap 檢查與原生錯誤也不變，不改用固定 offset。

`resolveEventOccurrences()` 每次呼叫建立自己的 reader，傳入候選展開、shift、重疊檢查與例外路徑；呼叫結束後沒有事件、snapshot 或外部 map 保留 reader。它不快取事項、權限或整份結果，不進 localStorage／帳號快取；下一次 snapshot 即使日期相同也重新計算。未傳 reader 的既有日期函式仍使用原本的直接轉換路徑。

private `expandBaseEvent()` 逐筆交出轉換後的候選，讓 resolver 立即處理例外與重疊，保住短 memo 內的重用值，避免先物化整段系列後才消費。RRule 的有界候選日期仍沿原本的限制產生；**public resolver 仍完整算完、排序後才回傳陣列**，沒有把 iterator 或部分 snapshot 交給 UI，也沒有改寫來源資料。

## 先失敗與反向驗證

- 三天 New York 系列跨 DST 的回歸先在原版失敗：12 組不同 instant／timezone 被轉換 31 次；修改後只需各轉一次，起訖 instants 與原本的 DST 行為相同。
- UTC 365 天長系列先在「有短 memo、整批消費」時失敗：1,460 次轉換超過每筆兩個 UTC instants 加 anchor allowance 的 734 次上限；逐筆消費後通過。這項不靠毫秒判定。
- 最終版停用 memo 命中，5 項回歸失敗；停用容量淘汰，1 項失敗；恢復整批消費，長系列 1 項失敗。每次均恢復正確實作後確認通過。
- reader 回歸另涵蓋不同 Date 物件代表相同 instant、不同 timezone、不同生命週期、淘汰與近期命中、invalid Date／timezone 不被兜底，以及 New York DST gap、Apia 跳日、0100 年的直接／重用輸出等價。新的 snapshot 標題立即反映，且兩次展開各自執行轉換。

## 同程序基線對照

用既有固定 20 個每日系列，同一 Node 程序分別編譯基線 `f298eae` 與工作樹的 canonical 函式（unminified library）。每個視窗各暖機一次，三次交替 baseline／candidate 順序；完整輸出 JSON 的 SHA-256 每次必須相同、筆數完整、輸入 bytes 不變。轉換計數另外執行，不混入計時。

| 視窗 | 完整 occurrences | baseline formatToParts | 修改後 formatToParts | baseline 三次 ms | 修改後三次 ms |
| --- | ---: | ---: | ---: | --- | --- |
| 53 週 | 7,420 | 75,140 | 45,040 | 304.1／323.8／303.9 | 248.6／247.8／246.6 |
| 197 週 | 27,580 | 276,740 | 166,000 | 8,397.4／10,542.1／11,592.0 | 7,950.4／8,359.1／8,644.6 |

完整原始值、輸出 hash、候選 source SHA-256、Node／OS／CPU 與實際時區見 [對照 JSON](month-calculation-reuse-2026-10-21.json)。source hash 是當時 Windows 工作樹的原始 bytes，跨平台 checkout 的換行可有差異。Node 為 Etc/GMT-8，display timezone 為 Asia/Taipei。兩組完整輸出相同，且原生轉換呼叫量明確減少；這些是工作量與等價性證據。

**不以此宣稱一般使用者改善百分比、真機 FPS 或 production browser 耗時。** 樣本小，CPU 溫度／背景負載未鎖定，長視窗仍為秒級；不能拿它與 DP-178 trace 相減或跨輪比較。CI 只把輸出、呼叫量、容量與生命週期當回歸，不把這些毫秒值設為 gate。

## 後續

DP-180 再同時限制 occurrence／segment 輸入與 DOM：最多 53 週、每次 12 週、裁掉離屏焦點時移至可見日期並保住選取／捲動。這一項沒有讓只增不減的 DOM 有界，也沒有宣稱初始成本或所有重負載已解決。

維持 App 0.4.3、schema v4、18 檔 migration；沒有 Auth／RLS、repository 邊界、資料欄位、公告或部署變更，未使用 Supabase MCP 或查正式資料。真機與實際家庭帳號仍未驗。

本機驗證：lint、typecheck、1,322 單元＋12 Node、build、check:build 全過；JS 734,536 raw／215,729 gzip bytes、CSS 111,244／27,088，仍在原 budget。相關手機／桌面共享、重複週格拖曳、跨午夜及事件時區 e2e 27 passed／1 desktop 不適用 skipped，兩個 Supabase env 以 Node child env 明確設為空字串。104 項日期／occurrence／segment 回歸另從 PowerShell 在 America/New_York 通過，實際 Node／browser 時區均列印。使用既有 Playwright，Browser plugin 不可用；臨時 server 已關閉。
