# DP-244 Phase 1｜四張漫畫貼圖驗收紀錄（2026-11-14）

> **狀態：Phase 1 驗收通過，授權仍是 `review-pending`。** 擁有者 2026-11-14 用手機看過第二輪四張的實寸預覽，答覆「通過」；QA、掃描、安全檢查都通過；權利審核表沒有發現阻擋問題（[`rights-review.md`](rights-review.md)）。依擁有者決策 7，下一步是 Phase 2（DP-246）製作補充 20 張。
>
> **這裡沒有任何貼圖檔。** 依擁有者決策 6，授權未核准的 SVG 不提交到公開 repo。repo 只保存 manifest、SHA-256、檢查程式與結果；SVG 與實寸預覽另交給擁有者保管，用 [`asset-hashes.json`](asset-hashes.json) 比對是不是同一份。**沒有接入 App**：沒有 registry、UI、service worker、schema、版號、公告或部署變更，DP-243 的 240 個系統 emoji 不受影響。
>
> 擁有者的第二版接手包原樣保存在 [`handoff-v2/`](handoff-v2/00_START_HERE/README.md)，本次的決策依據是其中的 [`OWNER-DECISIONS-2026-11-14.md`](handoff-v2/00_START_HERE/OWNER-DECISIONS-2026-11-14.md)。第一版接手包含有草稿圖檔，已從 repo 移除（見 §6）。

## 1. Repo 現況與接手包的差距

| 項目 | 接手包的說法 | Repo 實查（2026-11-14，main `d514449`） | 判定 |
|---|---|---|---|
| 資料欄位 | `stickers.asset_key` 已存在，`glyph`／`asset_key` 至少一個非空 | `supabase/migrations/20260801092905_daypop_core_schema.sql`：`glyph text`、`asset_key text`、`stickers_content_present` 檢查兩者至少一個非空；兩欄可同時有值。domain `Sticker.assetKey`（`src/domain/types.ts`）、驗證（`validation.ts` `validateSticker`）、DB 對應（`databaseMapping.ts`）、JSON 備份與 JSON 取代 RPC 都已帶著 `asset_key` 走 | **已存在，不需要 migration** |
| 寫入 | 新貼圖同時存 `assetKey` 與 fallback `glyph` | `NewStickerInput` 只有 `glyph`，`createStickerFromInput()` 固定寫 `assetKey: null`（`src/domain/mutations.ts`） | 待做（Phase 3） |
| 4 個 fallback 在 DP-243 清單內 | 第一版用 🏔️；第二版改為 ⛰️ | 😊（心情）、🎁（慶祝）、🍰（美食）、⛰️（出遊）都在 `src/domain/stickerGlyphs.ts`；**🏔️ 不在** | **通過**：hiking 固定為 ⛰️，由 [`stickerAssetManifest.test.ts`](../../../src/domain/stickerAssetManifest.test.ts) 把關 |
| fallback 與分類一致 | — | manifest 分類與 fallback 在清單中的分類一致（mood／celebrate／food／travel） | 通過 |
| ID 衝突 | 未核對 | repo 沒有任何 asset registry，程式沒有寫過 `assetKey`；只有匯入的備份可能帶任意 `assetKey` 字串 | 無衝突；正式 key 的命名規則留給 Phase 3 定（見 §7） |
| 顯示位置 | 月格、日詳情、選擇器、綜覽四處 | 月格 `MonthView.tsx`（`<span>{sticker.glyph}</span>`）、日詳情 `DayDetailSheet.tsx`、選擇器 `StickerPicker.tsx`（只列清單 emoji）、綜覽 `OverviewScreen.tsx`／`domain/overview.ts`（`glyph ?? ''`）。**目前只有 `assetKey`、沒有 `glyph` 的貼圖會畫成空白**（例如從別處匯入的備份） | 待做（Phase 3） |
| 圖片不進 JS | 規格要求 | **Vite 8 預設 `assetsInlineLimit` 4096**：實測 `import x from './happy.svg'`（1.5 KB）會被內嵌成 `data:image/svg+xml` 寫進 JS bundle；CSP 的 `img-src 'self' data:` 也允許它，所以不會報錯 | **衝突**：Phase 3 必須排除內嵌（見 §7） |
| Service worker | 依現有策略快取 | `pwa/sw-template.js` 只對路徑含 `/assets/` 或 `/icons/` 的 GET 做 cache-first，**不預先下載**；`public/` 下其他路徑（例如 `/stickers/`）完全不快取 | 待做（Phase 3）：放在 `/assets/` 才有離線，且第一次看過才有 |
| JS 預算 | 約剩 1.3 KB | 0.5.0 的 Pages 建置實測 JS gzip 239,309／240,640，剩 **1,331 bytes** | 屬實；圖檔絕不能進 JS |

## 2. 兩輪修改

### 2.1 第一輪（只動比例）

第一版接手包的 4 張以 Chromium 在 960px 量不透明範圍（含白色外框），長邊占畫布 81.5%（gift）～93.8%（hiking），大小不一致。以 [`normalize_svg.py`](normalize_svg.py) 把每張包進一個 `<g transform="translate() scale()">`，等比縮放置中到長邊 92%，viewBox 仍是 `0 0 96 96`，形狀與色彩不變。擁有者看過後的決策 1：**gift、cake 保留；happy、hiking 不通過，要簡化。**

### 2.2 第二輪（重繪 happy、hiking）

兩張都由 Claude Code 依擁有者決策重新寫 SVG，沒有沿用第一輪的形狀：

- **happy（決策 2，臉部大特寫）**：整張只有一張臉。圓臉、棕色頭髮與鋸齒瀏海、兩道粗的閉眼彎線（線寬 4.6）、張開的嘴、腮紅；沒有身體、手腳或裝飾。頭髮與臉各有一層白色外框，在深色背景上看得到輪廓。
- **hiking（決策 3，山峰為主＋日光）**：大小兩座山峰，大的有雪頂，太陽貼在小山後方而不是獨立漂在角落；拿掉背包與小細節。fallback 固定為 ⛰️。

四張的主色（決策 4，最多 4 個，同一主色的小幅明暗不另計）：

| 檔案 | bytes | 主色 | 明暗變化 | 長邊 | 不透明面積 |
|---|---|---|---|---|---|
| `happy.svg`（第二輪） | 1,005 | 棕 `#80554D`、紅 `#FF747A`、奶油 `#FFE6CA` | — | 91.7% | 65.3% |
| `gift.svg`（第一輪） | 926 | 紅 `#FF747A`、黃 `#FFD44F` | `#FF8A8A`（紅） | 92.1% | 67.6% |
| `cake.svg`（第一輪） | 1,193 | 紅、黃、奶油 | — | 92.1% | 59.8% |
| `hiking.svg`（第二輪） | 686 | 綠 `#76BA79`、黃 `#FFD44F`、奶油 `#FFE6CA` | `#65A76B`（綠） | 91.7% | 48.9% |

墨線 `#261C22` 與白色外框不算主色。四張共 3,810 bytes（單張上限 4,096、24 張上限 98,304）。

## 3. 檢查

- **[`check_stickers.py`](check_stickers.py)**：fallback 與分類直接讀 `src/domain/stickerGlyphs.ts`（240 個、11 類）；SVG 只允許 SVG 命名空間內的白名單元素與屬性，拒絕註解、DTD、CDATA、processing instruction、其他命名空間、`style`、事件屬性、`url()`／`data:`／`javascript:`、非十六進位色值、文字節點與非 `0 0 96 96` 的 viewBox。另外檢查主色：填色必須是色票色，或與某個色票色的 RGB 距離 ≤ 40（算作那個主色的明暗）；主色超過 4 個就失敗。每個檔案都必須與 `asset-hashes.json` 的 SHA-256 相同。不給 `--assets` 時只檢查 manifest。第二輪結果見 [`check-results.json`](check-results.json)：**0 錯誤**，授權待簽核所以 `publishable: false`。
- **負控制**（[`negative_controls.py`](negative_controls.py)，在 repo 外的暫存目錄改壞再跑）：18 組全部符合預期。未修改的基準組與「第 4 個主色」通過；其餘 16 種破壞全部被擋下：第一版的 🏔️、分類不符、不明授權值、改了檔案卻沒更新 hash、`<script>`、xlink `<image>`、`url()` 填色、外來命名空間、`onload`、`style`、XML 註解、DOCTYPE、非 96 viewBox、超過 4,096 bytes、色票外的新顏色、5 個以上主色。改 SVG 的那幾組會重算 hash，確定擋下它的是目標規則而不是 hash。
- **單元測試**（[`src/domain/stickerAssetManifest.test.ts`](../../../src/domain/stickerAssetManifest.test.ts)，`npm run test` 的一部分）：每個 fallback 都在 DP-243 清單且分類相同、hiking 是 ⛰️、id 唯一且與檔名一致、授權值只能是 `review-pending` 或已知的可發布值。把 manifest 改回 🏔️ 時有 2 項失敗，改回後通過。
- **實際解碼**（[`measure_stickers.mjs`](measure_stickers.mjs)，Chromium）：四張都以 96×96 解碼成功，數據與 hash 見 [`measure-results.json`](measure-results.json)。WebKit／Safari 沒有跑。

靜態檢查不能取代正式的 sanitizer：Phase 3 進建置流程時，要把同一套白名單變成 `check:build` 的一部分。

### 3.1 放進真正的月格

[`month_cell_harness.mjs`](month_cell_harness.mjs) 用真正的 App（dev server，空的 Supabase 設定，遊客模式）跑，不改任何產品程式：

1. 在 Asia/Taipei 的昨天到後天四天，分別放 1、2、3、4 張系統 emoji 貼圖（😊🎁🍰⛰️）；
2. 讓 App 用自己的 CSS 排版，月格字級依張數是 19／15／12／10px，日詳情 20px；
3. 把每個貼圖 `<span>` 的文字換成同字級大小的 `<img>`，在淺色與深色漫畫主題各截圖一次（390×844，DPR 3）。

結果：月格實際字級 `19／15,15／12,12,12／10,10,10,10`，日詳情 20px，水平溢出 0，console 沒有錯誤或警告，瀏覽器實際時區 Asia/Taipei。截圖目視：10px 四張排得下一行，臉、禮物、蛋糕、山都還分得出來；深色主題的白色外框看得到。**這是在 DOM 裡替換，不是 Phase 3 的接入**，看不出載入、快取與 fallback 的行為。截圖含圖檔，與 SVG 一起交給擁有者，不提交。

## 4. Gate 狀態

| Gate | 狀態 | 證據 |
|---|---|---|
| SVG 可解析、白名單、無外部引用 | **通過** | `check-results.json`、18 組負控制 |
| 單張 ≤ 4,096 bytes | **通過** | 686–1,193 bytes |
| 1:1、透明底、viewBox `0 0 96 96` | **通過** | 檢查程式＋Chromium 解碼 |
| fallback 在 DP-243 清單且分類一致，hiking 是 ⛰️ | **通過** | 檢查程式、單元測試 |
| 最多 4 個主色 | **通過** | 每張 2–3 個主色 |
| 四張比例一致 | **通過** | 長邊 91.7–92.1% |
| 16px 認得出、10px 分得出主色與輪廓、深淺背景 | **通過** | 擁有者 2026-11-14 手機實寸預覽答覆「通過」 |
| 真實月格 | **通過** | §3.1 |
| 權利審核 | **審核表完成，沒有阻擋問題；授權未核准** | [`rights-review.md`](rights-review.md)；`license` 維持 `review-pending` |
| 不影響 240 emoji、舊資料、離線、JS 預算 | 未開始（Phase 3） | 這次沒有任何產品程式變更 |

擁有者只在手機上看過實寸預覽；真實月格的截圖是 agent 在 Chromium 跑的，iPhone 實機的月格要到 Phase 3 接入後才看得到。

## 5. 授權

詳見 [`rights-review.md`](rights-review.md)。要點：

- 四張的 `license` 都是 `review-pending`，agent 沒有、也不會改成 `owner-original`。
- happy、hiking 由 Claude Code（Anthropic）寫出；gift、cake 由 ChatGPT（OpenAI）輔助寫出。兩家條款都把輸出權利轉給使用者，但都寫「if any」，也都不保證不侵權。
- 待擁有者補：OpenAI 條款存檔（這個環境連不到 openai.com）、確認用的是哪個 Claude 方案、與常見 emoji 圖集目視比對、最後的簽核。
- Phase 2 的 license gate 解讀為「審核表完成且沒有阻擋問題」，已滿足；把任何一張改成已核准的 gate 仍是擁有者簽核（審核表 §6）。

## 6. 圖檔放在哪裡

| 內容 | 位置 |
|---|---|
| 四張 SVG、實寸預覽 HTML、真實月格截圖 | repo 之外；交給擁有者保管。核對：與 `asset-hashes.json` 的 SHA-256 相同 |
| manifest、hash、檢查程式與結果、本頁、審核表 | 本目錄 |
| 第二版接手包（文件、清單、稽核程式，沒有圖檔） | [`handoff-v2/`](handoff-v2/00_START_HERE/README.md) |

**第一輪的草稿圖已經公開過。** 本 PR 第一次推送時（分支 commit `8b41de2`）提交了第一版接手包（四張草稿 SVG、`contact-sheet.png`、`preview.html`）與第一輪修正版 SVG。擁有者決策 6 要求核准前不公開，所以本次推送已從分支移除。但 repo 是公開的，那個 commit 仍可從 PR 的推送紀錄看到，從 git 移除也收不回已公開的內容。第二輪的 happy、hiking 沒有提交過。

## 7. Phase 3 的設計前置（不在這次做）

Phase 3 需要擁有者另外批准（含 QA、DB 與部署）。

- **不能用一般的 `import` 載入 SVG**：Vite 會把 4 KB 以下的檔案內嵌進 JS。可行做法是把貼圖放在 `src/assets/stickers/`，並把 `build.assetsInlineLimit` 改成函式，對這個目錄回傳 `false`，讓它們輸出成 `/assets/*.svg`。這樣現有 service worker 的 `/assets/` cache-first 就能涵蓋，不必改 SW；但只有看過一次的貼圖才能離線，沒看過的離線時顯示 fallback emoji。
- **尺寸**：同樣的 CSS 尺寸下，系統 emoji 畫得比框大（Chromium 的 Noto 字型在 16px 時每個 emoji 寬 19.97px、約 1.25 倍；iOS 的字型寬度未量）。§3.1 的替換直接用 `stickerFontSize()` 的數字，10px 四張排得下一行。圖檔要用同樣的數字還是略放大來對齊 emoji，會牽動 `monthCellLayout.ts` 的高度計算與 `month-cell-fit` e2e，要在 Phase 3 一起決定。
- **「最近」**：`recentStickerGlyphs()` 只看 `glyph`，圖檔貼圖會以它的 fallback emoji 出現在「最近」，需要另外處理。
- **只有 `assetKey` 的資料**：四處都要在認不得 key 時退回 `glyph`，兩者都沒有時不能畫成空白格。
- **`check:build`**：比照寵物素材，加上每張 4 KB／總量 96 KB 的上限、manifest 授權欄位與本頁的 SVG 白名單；只有授權已核准的檔案可以進建置。
- **正式 key**：建議 `assetKey` 加上套組前綴（例如 `daypop-manga/cake`），日後換畫風可以並存；一經寫入資料就不能改名。

## 8. 與接手包不一致的地方

| 接手包 | 實際 | 處理 |
|---|---|---|
| 第一版 hiking fallback 🏔️ | 不在 DP-243 清單 | 第二版已改為 ⛰️；單元測試與檢查程式都會擋 🏔️ |
| 第一版 `STYLE-GUIDE.md` 說 manifest 暫以 `owner-original` 登錄 | manifest 實際是 `review-pending` | 以 `review-pending` 為準 |
| 「主體約 88% 畫布」 | 第一版原稿 81.5%–93.8% 不一致 | 統一到含白框約 92%，主體（不含白框）約 84–88% |
| 第二版 manifest 的作者欄「ChatGPT 輔助」適用四張 | 第二輪的 happy、hiking 是 Claude Code 寫的 | manifest 的作者與 `modified` 欄已分開記錄 |
| 預估 JS 餘裕約 1.3 KB | 實測 1,331 bytes | 一致 |

## 重跑

SVG 不在 repo 裡，以下的 `ASSETS_DIR` 是擁有者保管的那個資料夾（四個檔名與 manifest 的 `file` 欄相同）。在 repo 根目錄執行：

```bash
python3 -I docs/sticker-concepts/2026-11-14/check_stickers.py --assets ASSETS_DIR
```

只檢查 manifest（不需要圖檔）：

```bash
python3 -I docs/sticker-concepts/2026-11-14/check_stickers.py
```

```bash
node docs/sticker-concepts/2026-11-14/measure_stickers.mjs ASSETS_DIR
```

預覽輸出必須在 repo 之外，程式會拒絕寫進 repo：

```bash
python3 -I docs/sticker-concepts/2026-11-14/build_preview.py ASSETS_DIR OUT_DIR/preview.html
```

負控制需要一個 repo 外的暫存目錄（會被刪除重建）：

```bash
python3 -I docs/sticker-concepts/2026-11-14/negative_controls.py "$PWD" ASSETS_DIR WORK_DIR
```

真實月格需要先在另一個終端機啟動 dev server（空的 Supabase 設定）：

```bash
VITE_SUPABASE_URL= VITE_SUPABASE_PUBLISHABLE_KEY= npm run dev -- --host 127.0.0.1 --port 4180
```

```bash
node docs/sticker-concepts/2026-11-14/month_cell_harness.mjs ASSETS_DIR OUT_DIR
```

需要用預先安裝的 Chromium 時，在 node 指令前加上 `CHROMIUM_PATH=/opt/pw-browsers/chromium`。
