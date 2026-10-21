# 53 週月曆滑動視窗（DP-180）

2026-10-21，承接 DP-179 PR #173 合併的 `7824713`（四項 CI 全過、Chromium 245 passed／13 skipped、審查無未解決事項），依擁有者在 DP-178 確認的契約實作。維持連續捲動、每次 12 週；不改成按月翻頁。

## 行為與界線

`MonthView` 固定 53 列，靠近任一端便移動起日 12 週，另一端同步裁掉；occurrence 與 segment 仍只取該視窗。每列以第一天 key 保留仍存在的 DOM。補／裁列與列高改變共用「頂端週日期＋列內比例」，等實際列高提交後、繪製前調整 scrollTop；固定列高時保留原 pixel，resize 時保留列內相對位置。停用原生 scroll anchoring 避免雙重補償。

只有真的持有焦點且將被裁掉的月格，才會以 `focus({preventScroll:true})` 轉到第一個完整可見週；不改 selected day、不開 sheet。仍在視窗裡的實際焦點保留同一節點，焦點在工具列／對話框時不搶焦點。月格仍只有一個 tab stop，Arrow／Home／End／PageUp／PageDown 沿原規則移動，跨界先移視窗再聚焦。今天超出範圍時重置為其附近的 53 週；搜尋待辦開啟新日曆畫面時以該日期初始化，不把焦點從日詳情拉走。

私有 UI 起日保留為 Date，支援邊界週的少數相鄰 0099／10000 日期只當停用佔位，不傳給 domain、不算農曆，也不能用鍵盤或點擊新增。有效查詢仍為既有 0100–9999 年。實際搜尋 9999 年重現原本兩日時區 padding 變成五位年份、字串反序而讓畫面出錯；0100 年重複跨日事項也重現遺失。因此必要的日期邊界修正包括：padding 截在原支援範圍、候選 look-behind 不早於 DTSTART、floating candidate date 保持四位年份。一般兩天時區 padding、DST、COUNT／UNTIL 與例外語意不變，沒有擴大資料驗證範圍或更動資料。

沒有新增來源／snapshot 結果快取。既有 memo 依來源 callback、時區與視窗重算，收到的分享仍遵守原 view／personalData 邊界。只限制展開輸入和 materialised DOM；RRule 仍可能從很早的 DTSTART 迭代，不能宣稱所有規則的 CPU 成本都是常數，也沒有解決任意大資料或所有首屏成本。

## 回歸與實際渲染

先在舊版重現 7 項 buffer／焦點失敗，再實作；年份 padding 兩端另先失敗。反向恢復 `MonthView`／`calendars`／`recurrence` 三份基線後得到 12 項失敗，finally 還原修正。覆蓋雙向長捲、精確查詢範圍、保留節點／移轉焦點、外部焦點、鍵盤／今天、96px 初始化、resize、四轉五列與裁列同次提交、週起始日及年份兩端。

新瀏覽器回歸手機／桌面 6 passed：各向前／後 12 次每次核對固定 53 列、起日移 84 天、可見日期與 y、唯一 tabindex；資料文件 bytes 不變；另驗證焦點／選取／工具列、鍵盤跨界、今天、2000／0100／9999 年搜尋、日詳情焦點及旋轉。只固定 Date，保留實際 scroll／RAF／ResizeObserver。Supabase env 由 Node child env 明確設為空字串，browser 實際時區 Asia/Taipei。

PR #174 審查再重現「搜尋 → 今天 → 月／週／月」會重播原始搜尋日期，且週游標仍在舊日期。新增兩項整合回歸先失敗，修正後通過、反向還原也同樣兩項失敗，再還原修正。「今天」現在一併更新既有 cursor，MonthView 重掛從目前 cursor 初始化；不再持續傳入原始 focus prop。瀏覽器搜尋案例補上同一輪檢視切換。

導航修正後重跑新視窗、responsive 與 WebKit smoke：13 passed／1 desktop 不適用 skipped，包含手機／桌面搜尋 → 今天 → 月／週／月；臨時 server 再次清理。原先較廣的 50／4 與這次針對性重跑分別記錄，不相加成新案例數。

Browser plugin 不可用，沿既有 Playwright 做實際渲染。原始 `.dc.html` 與 React 各在 390×844／1280×900 比對漫畫淺色空資料、深色相同單筆行程，皆為新 context、六列、寵物關閉。控制順序、格線／日期／色塊與連續捲動保留；原稿手機仍有展示框、時間前綴與白細線，React 保留既有 DP-050／165／166／145 的明確差異，沒有改樣式。React 沒有水平溢出、overlay、console warning／error；原稿有四條未解析 native input template 的既有 warning，未改原稿或 support.js。截圖與 summary 留本機暫存目錄 `daypop-dp180-visual-1j9rkt`，不提交圖片或完整 trace。

## 可重跑的負載量測

`npm run measure:month-scroll -- --strategy=bounded --steps=12 --runs=2 --output=output/playwright/dp180-month-window.json`。沿 DP-160 的固定日期／空資料或 20 每日系列、production guest build、手機／桌面、原生 performance／RAF／timers、GC 後 JS heap 與獨立 Node 完整展開量測。新增模式要求 DOM 恰為 53 週、日期每次前進 84 天、仍一個 tab stop；Node 核對天數 × 系列數，不能把 no-op 當樣本。舊 growth guard 保留，只供舊策略使用。

原始 JSON 會記錄基線 commit、候選工作樹 source SHA-256、browser／Node／OS 與實際時區。SHA 是 Windows 工作樹原始 bytes，跨平台換行可不同。不與不同輪的 DP-160／178／179 數字相減或計算改善百分比；不把抖動的毫秒值設成 CI gate，不當成 iPhone／standalone、真機 FPS 或 leak 證明。

正式兩輪共 8 組／24 點均通過；no-op 負控制由 `buffer did not advance` 拒絕，工具 finally 還原後才跑正式樣本。三個取樣點起日為 2026-04-19、2027-09-05、2029-01-21，結束日各相距 370 天；20 系列各為 7,420 occurrences，沒有漏掉移動後的資料。**這輪來源是審查前的 `1dfec97`，raw source SHA-256 原樣保留**；後續導航修正只改 CalendarScreen 的 cursor／初始化目標，這個無搜尋樣本的初值相同，但沒有另跑兩輪，不把歷史數字當成新 head 的精確耗時。

| 20 系列、viewport | 初始／第 6／第 12 次 DOM elements | GC 後 JS heap MiB（初始 → 第 6 → 第 12） | 第 6／第 12 次 scroll ms（兩輪範圍） |
| --- | --- | --- | --- |
| 390×844 | 2,742／2,742／2,742 | 7.84 → 10.70–10.73 → 10.78–10.79 | 360–1,698／1,794–2,827 |
| 1280×900 | 2,371／2,371／2,371 | 7.55 → 10.42–10.45 → 10.48–10.50 | 1,532–2,660／1,708–1,733 |

空資料兩種尺寸各為 1,258 elements；第 6／12 次取樣 19–44 ms。Node 的三個 53 週視窗均完整產生 7,420 筆，三次量測分別 1,108／1,119／1,129、1,219／1,185／1,180、1,240／1,179／1,340 ms。**資料與 DOM 有界，不代表每次移動已順暢**；20 系列仍有秒級計算，GC 後 heap 也不能視為固定上限或沒有 leak 的證明。候選 source bytes、全部原始值與環境見 [量測 JSON](month-window-measurement-2026-10-21.json)。

完整本機 lint／typecheck、1,340 單元＋12 Node、build／check:build 全過；New York 的 202 項日期／月曆回歸由 PowerShell 設定並列印實際 `America/New_York` 後通過。總 JS 735,722 raw／216,147 gzip bytes，CSS 111,265／27,099，在原 budget 內。相關手機／桌面及 WebKit e2e 50 passed／4 desktop 不適用 skipped（包含前述新 6 項），涵蓋共享／撤權、跨午夜／重複週格拖曳、事件時區、月格標籤／線條及 responsive。另以全新 WebKit context 驗證三次裁列、離屏焦點轉可見日期、今天回定位與工具列焦點，console／pageerror 為零、實際 Asia/Taipei。曾有一次本機 Vitest worker 啟動逾時、未跑到測試，單獨重跑與完整測試均通過；CI 仍是最終閘門。

App 0.4.3、user-data v4、18 migrations、Auth／RLS、repository contract、公告與部署不變；未用 Supabase MCP 或查正式資料。真機、實際家庭帳號與部署驗收仍待擁有者。剩餘秒級成本先列 DP-181 profile 建議，不在這項擴大演算法或快取。
