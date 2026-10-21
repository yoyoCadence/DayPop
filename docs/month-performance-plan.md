# 月曆計算與滑動視窗定案（DP-178）

> 後續實作：DP-179 PR #173 已合併為 `7824713`；DP-180 的有界視窗、焦點／捲動及日期邊界實作與驗證見 [視窗紀錄](month-window.md)。下文保留規劃當時的 profile 與契約。

2026-10-21，承接已合併 DP-161 PR #171 的 `7850c87`。擁有者在 Mode A 確認採用「53 週，焦點移到可見日期」。本 PR 記錄 profile 與實作契約，產品仍是只增不減的舊 buffer；計算重用與滑動視窗各開後續 PR。

## Profile 與判斷

沿用 DP-160 的固定 20 個每日系列、日期、production guest build 與 Date-only proxy，原生 performance／RAF／timers 不變。手機 viewport 390×844、Chromium 151.0.7922.34、browser Asia/Taipei／Node Etc/GMT-8。在系統暫存副本加 external source map，僅第 12 次（185 → 197 週）增長啟動 CDP CPU profiler 與 `devtools.timeline,v8,blink.user_timing` tracing；取樣結束後立即停止，明確要求的 GC／heap 取樣另在原本的取樣點（trace 內仍可能發生自然 GC）。沒有修改產品、讀取帳號、啟動 server 或查遠端資料。

| 取樣點 | 週數 | DOM elements | GC 後 JS heap bytes | 該次增長 ms |
| --- | ---: | ---: | ---: | ---: |
| 初始 | 53 | 2,742 | 8,134,492 | 未量啟動耗時 |
| 第 6 次 | 125 | 6,342 | 23,538,844 | 5,046.2 |
| 第 12 次 | 197 | 9,942 | 34,103,764 | 5,911.8 |

最後增長的 renderer trace：`FunctionCall` 約 5,850.8 ms、Layout 13.0 ms、Paint 累計 15.8 ms。CPU samples 主要落在時區轉換、occurrence／segment 展開與月格計算。**各 timeline category 可能互相包含，不可加總；CPU sampling 也不能精確拆出每個 native 呼叫。** 這個樣本支持先減少重複計算，沒有證明所有情境的 layout 都很便宜。

`eventTime.ts` 已有每個 timezone 一個 formatter 的快取（DP-081）；後續不能再次把問題當作「沒有 formatter 快取」。可檢查同一 instant／zone 的重複 `formatToParts` 與同一視窗的衍生計算，但維持現有 DST／牆上時間語意，不採固定 offset 算法。

同輪獨立 Node 展開中位數為 1,562.45／4,133.05／5,360.11 ms（53／125／197 週）。其他小型 profile 曾更快，DP-160 當時則更慢；沒有產品變更，這些差異不能稱為改善，也不能與 browser 時間相減推算 DOM 占比。這是單一手機模擬 trace，不是 percentile、真機 FPS 或一般使用者效能結論。

摘要、完整獨立 Node 三次值、相對 source frames 與原始產物 SHA-256 見 [profile JSON](month-performance-profile-2026-10-21.json)。原始 `.cpuprofile`／trace／暫存 probe 留在本機系統暫存目錄，沒有把巨大 trace 或含絕對路徑的 source map 提交。可用 `npm run measure:month-scroll -- --steps=12 --runs=1 --output=output/playwright/month-scroll.json` 重跑一般量測；CPU trace 需按上述區間另接 profiler，該命令本身不會產生 profile。

## 已定案的產品契約

- 月曆仍連續捲動。正常視窗最多 **53 週**，沿用 **12 週**增量，靠近邊界時補入相鄰 12 週並裁掉另一端；同時限制 occurrence／segment 計算範圍與 DOM，不只隱藏已展開的列。
- 以頂端可見日期與列內偏移保住畫面位置，補／裁列在繪製前補償 scrollTop。既有自動／四／五／六週列高、resize 與旋轉的補償也保留。
- 若被裁掉的離屏日期仍實際持有焦點，將焦點移至當前可見日期，使用不觸發捲動的 focus；**選取日期不改，畫面不跳回舊日期**。若焦點在其他控制項或對話框，不搶焦點。月格仍只有一個 roving tabindex，不掉到 body。
- Arrow、Home／End、PageUp／PageDown、週起始日與跨邊界行為保留；鍵盤要到視窗外時先移動視窗，再聚焦目標日期。今天／搜尋導覽超出視窗時重新置中，不建立跨越多年但只使用一端的大 buffer。
- 日期／時區、全天／跨午夜／長事件、重複 COUNT／UNTIL／DST gap、取消／替代與跨日曆例外的結果不變。滑動只改衍生視窗，不能刪除或改寫資料。
- 重用內容限於記憶體且有界；來源 snapshot／顯示時區／日曆顯示／共享可見性改變、換帳號、離開畫面時必須失效。收到的分享不能因快取而在撤權後繼續顯示，也不進持久快取／備份。

## 依序實作與驗證

1. **DP-179：計算重用。** 先量並寫會失敗的重複轉換／衍生計算回歸，再以同一參數重用結果。避免新增無界全域 map 或把舊共享資料留在另一份持久 store；不調整 buffer／焦點或日期演算法。以輸出等價與實際重複呼叫量作回歸，不把抖動的毫秒值設成 CI gate。
2. **DP-180：53 週滑動視窗。** DP-179 合併後才接續。覆蓋雙向長捲、prepend／trim 的日期與 pixel 補償、焦點被裁切／焦點在外、全部鍵盤鍵、今天／搜尋、顯示時區與跨午夜／長事件／例外；增加有界視窗的量測模式，驗證週數與計算範圍固定、日期確實向前／向後走。舊「必須增加 12 列」guard 只適用舊策略，不能為通過它而保留假列。
3. 每項先失敗、實作後通過、反向還原確認會失敗，再恢復通過；各自跑完整品質指令與相關 e2e，最新四項 CI 通過後自主合併。重跑相同假資料／browser 量測，保留來源 commit、原生 timing、實際時區與限制，不拿不同輪的數字宣稱改善百分比。

本項是規劃文件，沒有可反向撤除的產品修正，不新增鏡像文字的測試。原有測試與相關 e2e 仍需跑；以上產品回歸由 DP-179／180 實作 PR 負責。此計畫不宣稱初始 53 週成本已解決；若重用後仍慢，再根據 profile 縮小下一項，不擴成 repository／Auth 重構。

維持 App 0.4.3、user-data v4、18 檔 migration；不改公告、不部署、不動 Supabase 正式資料。DP-032／077 真機與實際家庭帳號驗收仍未完成。

本機驗證：lint、typecheck、1,312 單元＋12 Node、build、check:build 通過；空 Supabase 設定的 JS 734,304 raw／215,605 gzip bytes、CSS 111,244／27,088 與 DP-161 基線相同。月格完整標籤／responsive e2e 手機與桌面 9 passed／3 desktop 不適用 skipped，Node Etc/GMT-8／browser Asia/Taipei 已列印。使用既有 Playwright，Browser plugin 不可用；臨時 browser 與 server 均已關閉。
