# 實作路線與完成定義（Agent 可依序執行）

## Phase 0｜進 repo 前先讀與對齊（不修改產品）

- 讀完整 repo 根目錄 `AGENTS.md`（若有）、`README.md`、任務文件、DP-243 / DP-244、`sticker-catalog.md`、Schema、UI/Service Worker 相關檔案。
- 找到真實檔案路徑，不能假設 `asset_key` 在前端層的命名一定是 `assetKey`。
- 查 DP-243 的 240 emoji 現況、分類名稱、fallback emoji 是否存在 catalog，4 張樣本 ID 與既有 ID 是否衝突。
- 確認 bundle 容量基準與部署／發版流程，**禁止把圖片 import 進 JS**。
- 先交付一份現況差異報告（`docs/` 路徑由 repo 決定），有落差先標出，不偷改 schema 或使用者資料。

**DoD**：定位資料結構、路由、UI、SW、測試、license、可用 emoji 清單；記錄差異與阻擋事項。

## Phase 1｜視覺與可用性驗證（本 ZIP 已包含初稿）

- 4 張 SVG：`happy`, `gift`, `cake`, `hiking`，不同語義類別以測試同一風格能否涵蓋角色、禮物、甜點、活動場景。
- 用 `preview.html` 和 `contact-sheet.png` 比較 10 / 16 / 22px；在手機 100% CSS 縮放實看深淺兩種背景。
- 若 16px 看不清、10px 輪廓不明、深淺背景邊緣消失，回頭改 SVG，不降規格；留差異紀錄。
- 核對 fallback 在 DP-243 catalog 內；確認每張圖的授權歸屬與服務條款，`license` 由 `review-pending` 轉為可發布分類須專案擁有者核准。
- 確認每張 ≤4KB、SVG 安全與無外部依賴（見工具）；手機手動驗收不可由程式測試假裝通過。
- 記錄擁有者的「通過／修正／停止」決策；不接 App。

**DoD**：4 張通過視覺、尺寸、基本安全及來源簽核；得到擁有者明確指示是否進 Phase 2。

## Phase 2｜選 24 張並生產素材（未開始）

- 優先看使用資料（例如「最近」的使用頻率），確認清單 24 張和類別涵蓋；如果沒有資料，明確標示人工候選而不是捏造統計。
- 最終 24 張應共用此風格和穩定 `id`；每張有 `fallback` 和可追溯授權紀錄。
- 每 4–8 張一批生成／修正、跑 QA、開 PR，CI 與 code review 通過後按 repo 工作流合併；產物要可回滾。
- 確保每張 ≤ 4KB，總 24 張 ≤ 96 KB，必要時用不含外部依賴的 SVG 路徑優化。

**DoD**：24 張全數通過工具檢查、實測板、授權批准；穩定 ID／fallback 對照表完成。

## Phase 3｜產品工程整合（未開始，須另行批准）

1. 建 asset registry 和生成／建置檢查（ID 唯一、category 正確、fallback 存在、授權、尺寸、安全性）。
2. 貼圖資料寫入時，同時保存 `assetKey` 和 emoji `glyph`；兼容舊資料與舊 App 版本。
3. 四個展示面：月曆格、日詳情、選擇器、綜覽。`assetKey` 可解析就圖檔；否則 `glyph`。
4. 檔案置於靜態資產目錄，非 JS import；由 SW 依站點既有策略預取／快取，不破壞舊快取與離線行為。
5. 關於頁、repo 補來源署名／授權紀錄（若適用）。
6. 對照板、單元／整合／離線／舊資料回歸測試；保留 240 emoji 可選。
7. 用 feature flag 或可回滾機制小規模導入（如現有架構支持）；不要自行擴大發布。

**DoD**：所有端點正確 fallback、離線可用、資產大小與 JS 預算未破、版本相容、CI／Code Review 通過、負責人批准發版。

## 退出條件（任何 Phase）

- 來源與權利無法確認、16px 無法辨識、對比不符、超容量、破壞 DP-243 功能、需要不符架構的 migration 或服務，任一項成立就暫停該階段的部署，先修正或回報。
