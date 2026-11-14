# 工程契約｜預期行為，不是已存在的實作

## 必須以實際 repo 驗證

本契約根據 DP-244 提案整理；**沒有讀過 DayPop repo**，下列路徑、資料欄位序列化、SW 行為和 bundle 基準均需新 Agent 驗證。不得憑本文直接修改 production schema。

### 選用圖檔及 emoji 回退的展示邏輯

```ts
// 偽碼，僅定義行為，不要盲目直接貼進產品
function renderSticker(sticker) {
  const imageUrl = sticker.assetKey && registry[sticker.assetKey];
  return imageUrl
    ? imageWithOnErrorFallback(imageUrl, sticker.glyph)
    : glyphOrExistingPlaceholder(sticker.glyph);
}
```

圖檔載入失敗（含 SW 離線 miss、資產 404、SVG 解碼失敗）必須切回 `glyph`；`assetKey` 未知或不在 registry 不能讓畫面空白。不要以瀏覽器暫時載不到圖作為刪除 `assetKey` 或 `glyph` 的理由。

### 寫入契約

- 新圖檔貼圖同時存 `assetKey` + fallback `glyph`，且 `glyph` 必須是 catalog 既有值。
- 只含 `glyph` 的既有 DP-243 內容和備份可正常讀取。沒有 assetKey 的圖也不能被 UI 當錯誤資料。
- ID 一旦被寫入正式貼圖資料，就不得任意更名。若有命名衝突，先做 mapping/遷移相容設計，而不是直接覆蓋。
- 提案稱 `stickers.asset_key` 已存在、`glyph/asset_key` 至少一個非空；需要 repo 實驗證。

### 靜態資產與部署

- SVG 靜態檔單張 ≤4KB；正式 24 張總量 ≤96KB；**不得 import 為 JS bundle**。DP-244 曾估算 JS gzip 約 1.3KB 餘裕，須以實測確認。
- 使用 manifest/registry 追溯 `assetKey → 檔名 → fallback → 來源/授權`，包含 test/build-time validation。
- SVG 安全校驗：拒絕 script、foreignObject、外部連結／載入、事件處理屬性、嵌入圖像、字型和不允許的 CSS／SMIL；不能只靠字串 grep，正式部署需可信任 sanitizer/CSP 或嚴格 XML allowlist。
- SW 更新與離線快取要評估版本與舊 cache 清理；依現有架構實作，避免耗盡不必要的儲存空間。
- 需要新 API／DB migration／後端變更時，先回報架構差異；原始 DP-244 預期不需要 migration。

### 使用介面

- 月格依當日張數，可能顯示 19 / 15 / 12 / 10 CSS px。
- 日詳情：20 CSS px；選擇器：22 CSS px；綜覽：23 CSS px。
- 16px 應能辨認語義，10px 至少辨輪廓；要以 devicePixelRatio 不同的實機測，而不是只看 512px 來源。
- 無障礙名稱從 `manifest.name` 建立，不直接使用檔名或只有裝飾圖像替代文字；遵守原 UI 的 aria/alt 模式。

### 授權

- 只允許已有查核且授權可用於網頁再散布的來源。`review-pending` 不得進發版產物。
- 自製與 AI 輔助素材需記錄工具、日期、來源、編修及擁有者簽核；有第三方引用的則依各授權版本要求保留署名、授權與變更紀錄。
