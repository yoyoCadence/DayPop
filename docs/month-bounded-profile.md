# 53 週月曆的剩餘成本 profile（DP-181）

2026-10-21，承接 DP-180 PR #174 合併的 `12280a82c3d7299477e6d0f2b2f0d4bee666d2e8`。該 PR 最終 head `95ea150` 的 CI run `39619419252` 四項成功，Chromium 251 passed／13 skipped。擁有者指定先做剩餘效能 profile；本項只增加量測工具、分析器回歸與紀錄，產品 source、日期演算法與互動不變。

## 重跑方式與有效性

```text
npm run measure:month-scroll -- --profile=mobile-last --strategy=bounded --steps=12 --runs=2 --output=output/playwright/dp181-bounded-profile.json
```

沿既有量測工具增量加入選用模式，未指定 `--profile` 時仍是原本 bounded 量測；growth 歷史模式不能與 profile 合用。使用 production guest build，Supabase URL／publishable key 明確設空，不連網路 server、不讀帳號或正式資料；全部 resource 由 Playwright route 供應。Browser plugin not available，因此沿用 repo 的 Playwright。沒有新增相依。

固定原有 `monthScrollData(0 | 20)` 假資料，每個每日系列從 2025-01-01 起、無 COUNT／UNTIL；同一日期、偏好與 390×844／1280×900，各兩個全新 context。只代理 Date，performance、RAF 與 timers 保持原生；實際 Node 時區為 `Etc/GMT-8`、browser 為 `Asia/Taipei`，均印出並記錄。正式量測不與單元／建置／其他瀏覽器驗證並行。

全部 8 組／24 點通過固定 53 列、371 格、唯一 tab stop；每次確實向後移動 84 天。三個取樣視窗起日為 2026-04-19、2027-09-05、2029-01-21，皆涵蓋 371 天；獨立 Node 呼叫 canonical `visibleOccurrences()`，核對 20 系列每窗完整 7,420 筆。手機 DOM elements 固定 2,742，桌面固定 2,371；空資料兩種尺寸皆 1,258。這些只是本次有效性證據，不是任意資料量的記憶體上限。

只在手機 20 系列的第 12 次移動開啟 CDP CPU profiler（要求 1,000 µs interval）及 timeline，兩輪各一份；從 2028-10-29 開始的視窗移至 2029-01-21，仍為 53 週。CPU 起迄包含啟停 trace 的額外時間；scroll interval 則是程式捲到底至視窗更新後的下一個原生 RAF。GC 後 heap 取樣在該 interval 與 profile 結束之後，沒有為了美化數字在 interval 內手動 GC。

建置只在 OS temp 產生 hidden external source maps，正常產品 build 不產生 map。CPU／trace／maps 留在 temp 的 `daypop-month-profile-5TF3aJ`，各檔 SHA-256、bytes、環境、來源 commit／工作樹 bytes SHA、全部取樣與分析結果見 [JSON](month-bounded-profile-2026-10-21.json)。只有該 JSON 提交至 repo；工具 finally 只清理自己建立的暫存 build，raw 另存供複查。工作樹 SHA 包含 Windows 換行，跨平台可不同；本項沒有改 `src/`／`e2e/`／`supabase/`。

## 觀察到的成本

| 手機最後一次移動 | 第 1 輪 ms | 第 2 輪 ms |
| --- | ---: | ---: |
| scroll interval（有 profiler） | 3,561.0 | 2,981.5 |
| timeline FunctionCall 累計 | 3,368.1 | 2,881.6 |
| 最長單一 FunctionCall | 3,362.6 | 2,875.5 |
| timeline Layout | 62.1 | 9.5 |
| timeline Paint 累計 | 211.2 | 84.0 |
| timeline MinorGC 累計 | 36.2 | 37.6 |

timeline 僅取主 renderer 的完整事件；FunctionCall、Layout、Paint、GC 可互相包含，**不得相加、相減或當作互斥百分比**。這兩份 trace 的秒級區間主要跟著長 JavaScript 呼叫，不能只用「DOM 已有界」推論計算也順暢。

CPU 取樣覆蓋的相鄰區間為 3,827.684／3,017.047 ms；最接近的 mapped JS ancestor 歸因如下。原生 leaf 歸入其 JS ancestor 是推論，不是對 ICU／瀏覽器原生管線的精確計量：

| 互斥的 nearest-source 歸因 | 第 1 輪 ms | 第 2 輪 ms |
| --- | ---: | ---: |
| eventTime 時區換算路徑 | 1,764.1 | 1,696.1 |
| rrule 套件 | 524.1 | 388.3 |
| MonthView `hasOverlap()` | 435.2 | 324.9 |

其餘包含 unmapped／idle／program／GC、其他 domain 與 React；上述三列不是全部樣本。source map 指向**函式起點**，不是函式內某一行的逐行精確時間。eventTime 內的 `wallTimeToInstant()` 與 `zonedParts()` 都突出；V8 內聯及 Date proxy 也會影響歸因，不能把所有數字都叫作 `formatToParts()` 自身耗時。

包含子呼叫的 stage inclusive 值，另列為：`visibleOccurrences` 1,897.7／1,735.7 ms，其中 resolver 1,680.7／1,430.7、display clipping 213.7／294.5；月格 grouping 777.5／686.5，其中 `eventDisplaySegments` 560.4／507.9。**這些 inclusive 列互相重疊，不與上表加總。** eventTime 的最近外部 caller 中，recurrence `shiftEvent` 為 952.1／819.0 ms、segment 為 428.4／402.0、display clipping 為 186.0／292.1、月格標籤 grouping 為 155.7／139.2；其他 caller 也完整保留在 JSON。

因此剩餘成本跨越展開與顯示階段。RRule 從早期 DTSTART 迭代仍可見，但這兩份樣本不足以主張「RRule 是唯一瓶頸」或保證任意久遠／複雜規則的成本。`hasOverlap` 對同日 entries 成對檢查，本假資料的 20 筆半小時行程不互相重疊，會走完 pair；這是另一個可分開處理的熱點。

獨立 Node 的三個 53 週視窗，各三次完整展開為 2,606／2,903／3,154、3,211／2,260／3,089、3,066／2,278／2,092 ms。與前輪 DP-180 不同，不能跨輪相減、宣稱效能退步／改善，也不能從 browser 時間減去 Node 以估算 render。profiler overhead 未扣除；兩輪不是 percentile、真機／iPhone／standalone 或 FPS 證據，沒有 CPU／熱狀態鎖定。

## 下一段建議，待擁有者確認

**建議 DP-182 先限於月格 segment 與標籤的重複時區欄位讀取。** 現有 `eventDisplaySegments()` 對相同 start／end instant 各讀日期與時間，`groupEventsByDate()` 又讀開始標籤；這些是相同 timezone／epoch milliseconds 的可重用純值。DP-179 的 reader 目前只屬於 resolver，不能覆蓋後續顯示工作。

沿用既有最多 256 筆、完整 timezone／epoch milliseconds key 的 `createZonedPartsReader()`，只在一次月格 grouping 的同步計算內共用；必要 helper 以可選 reader 傳入、既有 caller 預設語意不變。reader 不附到 event／occurrence／snapshot、不跨次或持久化，也不新增文件欄位；來源、撤權、時區或視窗變更照既有 memo 重算。先不改 RRule、clipping 規則、pair 衝突演算法、53 週／焦點或 React 排程。

驗收先用原生轉換呼叫數證明同一 instant 的日期／時間／標籤讀取真的重複，測試先失敗；修正與反向撤除都須有證據。以完整 segments／排序／tooltip／衝突結果等價為準，涵蓋跨午夜、午夜結尾、DST 重複／跳過、UTC−12／UTC+14、長事件 clipping、例外與共享撤權。再以相同固定視窗做同程序輸出對照與小範圍 paired measurement；不把毫秒值設成 CI gate，也不承諾一次消除全部秒級成本。

選這段是因為 segment 與標籤路徑在兩輪都可見，重複輸入能直接寫成工作量回歸；範圍比改 recurrence 規則或衝突演算法小。`hasOverlap` 及早期 DTSTART 迭代留待後續各自規劃；**本項不實作 DP-182，未把此建議當作已定案**。

## 分析器與品質驗證

新增 Node 分析器不裝 source-map 套件；使用 [Node SourceMap 的零起算 offset API](https://nodejs.org/download/release/v24.19.0/docs/api/module.html#sourcemapfindentrylineoffset-columnoffset)，輸出轉成人讀的一起算行號並只保留 repo 相對路徑。CPU 使用 CDP timeDeltas 的累積時間，與 sample ID 一起排序後把相鄰區間歸給前一個 sample；保留第一個 sample 前／最後 sample 後未分配的時間，不估造尾巴。排序方向參照 [DevTools CPUProfileDataModel](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/cpu_profile/CPUProfileDataModel.ts)；沒有套用其補估末段或替換 program sample 的邏輯，因此結果不應宣稱逐項等同 DevTools UI。

初次試跑第二份 CDP profile 有一個 −101 µs delta，原分析器以負值拒絕；該輪沒有產出有效 JSON、沒有混入正式結果。新增亂序回歸先失敗，修正後重跑上述整輪。正式兩份 raw 則都沒有負 delta。self 保留原生／unmapped 節點；nearest-source 每段只歸一類；inclusive 同一遞迴位置去重但不同 ancestor 仍重疊。

五項 Node 回歸涵蓋不等間距、原生 self、缺少 weights／未知 sample／空 profile、未知 map、亂序／offset 與 renderer thread／nested timeline。反向負控制：等權重 3 項失敗、取消遞迴去重 1 項、錯誤 offset 2 項、放入其他 thread 1 項、不排序 1 項；finally 還原後 5／5 通過。另以新 profile 模式執行 no-op scroll，確實被 `buffer did not advance` 拒絕並還原。沒有可反向撤除的產品修正，也不新增鏡像文件文字的測試。

本機 lint／typecheck、完整 1,340 單元＋17 Node（含新 5 項）、build／check:build 全過。單元以 `--testTimeout=30000 --maxWorkers=2` 跑，本輪沒有失敗重試，CI 預設不變。JS 735,722 raw／216,147 gzip、CSS 111,265／27,099 bytes，與產品基線相同。JSON 與 retained raw／maps SHA 全部核對，兩份摘要可由原始檔精確重算。

相關 month-window／month-cell-fit／webkit-smoke 共 16 passed／2 desktop 不適用 skipped，涵蓋手機／桌面的雙向裁列、焦點／日期與 pixel、搜尋／今天／年份邊界／旋轉、月格完整標籤及 WebKit 保存／焦點／四分頁；實際 browser 時區皆印為 Asia/Taipei。由 Node child env 明確設空 Supabase 設定，本次 hidden Vite 的 PID／parent／command line 核對後已停止；產品沒有 React／CSS 變更，因此不重做 DP-180 的 canonical 視覺差異。

最新 head 的四項 CI 與審查完成才依持續授權合併。App 0.4.3、user-data v4、18 migrations、Auth／RLS、公告與部署均不變；未用 MCP 或讀正式資料。真機與實際家庭帳號驗收仍未完成。
