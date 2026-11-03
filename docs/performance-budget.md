# Production JS／CSS 產物大小上限

DP-231（2026-11-02）提醒 App 接線：DP-230／main `bed614a` 的 JS＋worker 為 756,768 raw／223,208 gzip；首次加入裝置生命週期、Auth bridge、逐日曆設定／失敗恢復 UI 後為 794,783／234,861，增加 38,015 raw／11,653 gzip，沒有新增套件。原 gzip 上限確實擋下此 build（超過 9,581 bytes）。本段將 JS gzip 從 220 KiB 調至 **235 KiB／240,640 bytes**，保留約 5.6 KiB 空間；JS raw 800 KiB、CSS 與寵物上限、總量計法及所有超限守門不變。功能成本與實際最終數值隨 PR 揭露；不移除確認／隱私保護、不藉拆 chunk 隱藏總量。下方表格保留 DP-119 原始基線。

最終正常 Pages build 為 JS＋worker 795,896 raw／235,263 gzip（較基線 +39,128／+12,055），距新 gzip 上限 5,377 bytes；CSS 121,024／29,600（+1,278／+239），仍沿原上限。後續變更仍須同一個 guard，不代表實機效能或首次下載已驗收。

DP-119 把大小上限接入既有 `npm run check:build`，由 PR／main CI 的相對、`/DayPop/` 與 `/` 三種 base 建置，以及 staging 部署閘門共同執行。配置在根目錄 `performance-budget.json`；超限、配置缺漏／無效或讀取失敗都使檢查失敗。

2026-10-04，以已合併 DP-118 的 `main`（`5e0e060`）、v0.4.2、預設相對 base 的 production build 為基線：

| 類別 | 檔案數 | 原始 bytes | gzip bytes | 原始上限 | gzip 上限 |
| --- | ---: | ---: | ---: | ---: | ---: |
| JavaScript | 2 | 648391 | 190190 | 819200（800 KiB） | 225280（220 KiB） |
| CSS | 1 | 99857 | 25138 | 131072（128 KiB） | 32768（32 KiB） |

agent 依持續開發委託建議這組限制：基線之上保留約 18–31% 的增量空間，讓正常功能迭代可進行，且足以擋下大幅增加依賴或樣式。日後超限先檢查新增內容與載入方式；調高上限須在 PR 說明增加原因及影響，不能因為 CI 紅了就移除閘門。

計量範圍與限制：

- 加總 `dist/` 所有 `.js`／`.mjs` 與 `.css`，包含 service worker 及未來拆出的 chunk，不能只看 `index-*.js`。原始大小使用 Buffer bytes，非字元數；每個檔案獨立以 Node `gzipSync` 的預設設定壓縮後再加總，恰好等於上限時通過。
- source map、字體、圖片、HTML 等不在本項範圍；拆出 lazy chunk 仍計入總量。這個總量不代表首屏下載量、主機實際壓縮格式、完整 App 大小或網路傳輸量。
- 不改 Vite 的既有 500 kB chunk 警告。總量上限與單一 chunk 警告檢查不同的問題；目前主 bundle 的警告仍存在。
- 七項 Node 回歸由 `npm run test` 成功後的 `posttest` 執行，涵蓋多 chunk／worker、中文 bytes、逐檔 gzip、精確邊界、四種獨立超限與配置 fail closed；不改 Vitest 的選檔參數或 App 測試環境。
- 本項只量測建置產物，不宣稱真機啟動、LCP、CPU／記憶體、離線或 DP-034 父任務已驗收。實機效能需要另外量測。
