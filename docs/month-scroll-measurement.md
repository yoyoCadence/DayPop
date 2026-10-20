# 月曆長時間捲動量測（DP-160）

本項只量測，不修改 `MonthView`、domain、repository、CSS、migration、schema／release version、公告或部署。產品基線為 DP-159 合併後的 `9229a80`；方法與原始結果一併保留，不能把桌面 Chromium 的模擬尺寸數據當成 iPhone 驗收。

## 方法

執行 `npm run measure:month-scroll -- --output=output/playwright/month-scroll.json`，需要 lockfile 對應的 Chromium（`npx playwright install chromium`）。`--steps=1–24` 與 `--runs=1–3` 可縮小／增加樣本，預設 12 次 buffer 增長、每組兩個全新 context。量測不用加入日常 CI 的耗時門檻。

- 透過 [Vite build API](https://vite.dev/guide/api-javascript.html#build) 在唯一 OS 暫存目錄建立 production guest App，強制兩個 Supabase env 為空。Playwright 攔截所有資源，僅供應該 build；意外外連立即失敗，不開 network server、不使用真實帳號或遠端資料。
- 同樣編譯 canonical `createEmptyUserData`／`parseDayPopUserData`／`visibleOccurrences`，沒有另寫一套 occurrence 演算法。固定假資料為空日曆或 20 個每日 30 分鐘系列，09:00–19:00、Asia/Taipei、自 2025-01-01 起、沒有例外／附件／貼圖／待辦。固定漫畫淺色、六列月格、寵物關閉。
- 日曆時間固定在 2026-10-20 12:00 Asia/Taipei，僅代理 `Date`，**保留原生 performance／RAF／timer**；每組印出並核對原生 API、實際 timezone、viewport。先前使用 Playwright clock 的校準數字未採用。
- 手機 390×844（touch）與桌面 1280×900，DPR 1、reduced-motion；兩者都在同一台 Windows 的 headless Chromium，沒有 CPU throttling。`.test` 的攔截 origin 不啟用 service worker，所以本項不量 PWA／離線。
- 初始 53 週（371 格），每次真正捲到底並等待增長 **恰好 12 週**，第 6／12 次記錄 125／197 週。沒有增長就失敗，不能把 no-op 當樣本；每個取樣點固定仍有一個 roving tabindex。
- DOM 同時記錄 document elements、日期格、chips 與 [CDP DOM counters](https://chromedevtools.github.io/devtools-protocol/tot/Memory/#method-getDOMCounters)。記憶體是明確 GC 後 [Runtime.getHeapUsage](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-getHeapUsage) 的 JS used heap，**不包含完整 renderer／native DOM／GPU／作業系統記憶體，也不是 leak 證明**；GC 不在捲動計時區間內。
- `scrollMs` 是設 scrollTop 到看到新增 rows 後下一個原生 RAF 的時間，包含 React、領域計算與 layout／frame 等待，並非單獨的 recurrence 時間或可靠的使用者延遲 percentile。只有兩個獨立 run，列範圍、不訂效能 gate。
- Browser 工作全部結束後才做 Node 的 canonical `visibleOccurrences` 計時：每個視窗先 warm-up 一次、實跑三次，核對每日 occurrence 數等於天數 × 系列數。這包含日期轉換與可見性過濾，不等同瀏覽器內部 profiling，也不能把它從 scrollMs 直接相減。

不要同時跑 lint、單元測試、另一個 build 或其他重工作。本機寫入 output 的 raw JSON 含 Node／OS／CPU／browser 版本、實際時區、每組樣本與獨立展開時間；不包含帳號、密鑰或真實行程。

## 校準與結果

先以 no-op 捲動做負控制，工具以 `buffer did not grow` 拒絕；改用原生 performance／RAF 後再次得到同一失敗。還原真實捲動後才執行正式兩輪。負控制不提交，既有產品沒有可回復的修正，也不宣稱修了一項使用者回報的故障。

## 正式結果（2026-10-20）

[完整 raw JSON](month-scroll-measurement-2026-10-20.json) 保留全部 24 個 browser 取樣點與 18 筆 Node 計時。Windows 10.0.26300、i7-13620H（16 logical CPUs）、15.71 GiB RAM、Node 24.19.0（實際 `Etc/GMT-8`）、Chromium 151.0.7922.34；browser 每組實際 `Asia/Taipei`，原生 performance／RAF 檢查全過。這是 **12 次程式捲至尾端**，不是連續手勢或數小時真人使用的模擬。

20 個每日系列，兩個獨立 context 的範圍如下。elements 不含 text nodes；heap 單位為 MiB（2²⁰ bytes），不能與完整 App 記憶體混為一談。

| viewport | 週數／日期格 | elements | GC 後 JS heap MiB | 該次增長到下一個 frame 秒數 |
| --- | ---: | ---: | ---: | ---: |
| 390×844 | 53／371 | 2,742 | 7.62–7.63 | 未量初始載入 |
| 390×844 | 125／875 | 6,342 | 22.45 | 6.293–8.661 |
| 390×844 | 197／1,379 | 9,942 | 32.55–32.56 | 8.688–13.844 |
| 1280×900 | 53／371 | 2,371 | 7.45–7.47 | 未量初始載入 |
| 1280×900 | 125／875 | 5,467 | 21.82 | 7.464–8.582 |
| 1280×900 | 197／1,379 | 8,563 | 31.43–31.51 | 8.427–10.368 |

兩種布局沿用既有 chip budget：本輪手機每格三個、桌面兩個，所以 elements 不同；相同的完整 occurrences 數已獨立核對，沒有因此丟資料。所有取樣仍各有一個 roving tab stop。空日曆對照：elements 同為 1,258 → 2,842 → 4,426，heap 約 3.59–3.62 → 6.17–6.21 MiB；197 週的增長取樣，手機 33.8–35.7 ms、桌面 33.3–38.3 ms。

同一個假資料與視窗，獨立 Node `visibleOccurrences`（warm-up 後三次）：

| 週數 | 每日 occurrences | 三次秒數 | 中位數秒 |
| ---: | ---: | --- | ---: |
| 53 | 7,420 | 2.313／2.808／2.970 | 2.808 |
| 125 | 17,500 | 7.420／6.198／7.153 | 7.153 |
| 197 | 27,580 | 15.397／14.980／12.600 | 14.980 |

空日曆同一路徑中位數均小於 0.1 ms。Node 與 browser 使用不同執行環境、JIT／日期 instrumentation；這些數值只能各自比較，不能相減推論 React 或 DOM 占比。兩次 browser 樣本有明顯抖動，CPU 頻率、溫度與 OS 背景工作未鎖定，不外推 percentile、極大資料或真機表現。定稿工具把未增長 guard 放寬至 120 秒，以免較慢機器的有效樣本被當成故障；本輪成功的 browser 增長點全低於原先 15 秒 guard，不受該調整影響。最終工具另以 `--steps=1 --runs=1` 跑完四組 smoke 與 JSON 產出，未混入上表的正式兩輪。

## 判斷與下一步

在這組固定重負載已重現秒級同步成本，原本「只增不減」的靜態風險已有數據；不代表一般使用者、真機或所有月曆都會如此。建議另立 **DP-178，先 Mode A**：

1. 先做 browser CPU profile，定位展開／牆上時間轉換與繪製成本；確認可重用計算的失效邊界。初始 53 週的獨立展開已約 2.8 秒，所以只限制 buffer 也不能宣稱解決初始成本。
2. 規劃有界的展開／保留視窗，連同 DOM 一起限制。只做 DOM virtualization 不會自動限制 `visibleOccurrences` 的輸入，仍須驗證 CPU 工作量。
3. 定案 buffer 上限與移出視窗時的鍵盤焦點政策，再實作。必須保住 DP-069 的 roving tabindex、Arrow／Home／End 跨邊界、prepend／trim 捲動補償、今天與搜尋定位、DP-064 的跨午夜／長事件／例外；不能用效能理由改成月分頁或丟掉資料。

本 PR 只完成量測，沒有實作 DP-178、提高效能 budget 或更動 canonical UI。本機瀏覽器與暫存 build 已由 finally 清除；無需 migration／owner push／部署，DP-032／077 與實際帳號驗收保持未驗。

本機驗證：lint／typecheck、84 檔 1,312 單元＋7 Node、build／check:build 通過；JS 734,390 raw／215,664 gzip bytes、CSS 111,244 raw／27,088 gzip bytes，與基線相同。相關 `month-cell-fit.spec.ts`／`responsive-shell.spec.ts` 為 9 passed／3 desktop 不適用 skipped（22.1 秒），兩個 Supabase env 以真正空字串啟動。沒有 schema 變更，不重跑本機 DB／MCP；PR CI 仍須四個 jobs 全過才依授權合併，精確 CI 證據記在 PR。
