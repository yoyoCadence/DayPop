# DayPop DP-244｜給接手開發 Agent 的完整啟動 Prompt

請接手 **DayPop 的 DP-244「自訂圖檔貼圖」Phase 1**，本次隨附資料夾 `DayPop_DP244_Phase1_Handoff_v2`。**方案 C 的 Phase 1 已核准**，但 4 張草圖未通過可讀性驗收；這不是圖檔接線或發布批准。請先閱讀 `00_START_HERE/OWNER-DECISIONS-2026-11-14.md`，該檔優先於本包其他較早文件。

## 工作前提與不變條件

- DP-243 已經有 **240 個系統 emoji**；這個功能要繼續可用，**不得替換／刪除／破壞**。
- DP-244 只想解決跨裝置圖像一致與 DayPop 自有風格；採用 C 原創漫畫圖檔做 **4 張 Phase 1 MVP 視覺驗證**。
- 若 Phase 1 通過，Phase 2 才補齊 **24 張最常用貼圖**；Phase 3 才是 registry、UI、fallback、SW、署名及發版。這三階段**不得混為同一個已核准任務**。
- 本包的 4 SVG 只是草稿，`manifest.csv` 授權是 `review-pending`；不能當作發版批准。
- 任何圖片素材不得注入 JS bundle，單張部署檔 ≤ 4KB，24 張總計 ≤ 96KB，不能為了通過任意放寬規格。
- Phase 1 四張通過指定 Gate 後，准許**開始規劃並製作** Phase 2 另外 20 張；Phase 3（圖檔接產品）與部署必須另行通過獨立審核，不得自動發布。

## 第 1 步：先讀，不要動手改 code

依序閱讀：
1. repo 既有 `AGENTS.md`、`README`、專案約定與 task/roadmap。
2. 本包 `00_START_HERE/README.md`、`01_DECISIONS_AND_PLAN/*`、`03_QA_AND_TOOLS/*`。
3. repo 的 DP-243、DP-244、`sticker-catalog.md`、schema（尤其 `stickers.asset_key` 和 `glyph`）、貼圖 UI 四個位置與 SW。
4. 本包 `02_ASSETS/manifest.csv`、4 張 SVG、`STYLE-GUIDE.md`、`preview.html`、`asset-provenance.md`。

若 repo 內容與本包說法有衝突，以最新 repo 實際狀態及專案規範為依據，並列出差異與原因。不能假設文件中描述的實作已存在。

## 第 2 步：完成 Phase 1 可驗收工作

A. 先提出 repo 現況與差距表（已存在／待完成／有衝突），已知 `happy` 😊 / `gift` 🎁 / `cake` 🍰 / `hiking` ⛰️ 均在正式 catalog，仍須由你的程式檢查四筆 manifest 的 `fallback`、ID 是否衝突、原 schema 是否支援雙欄位，並標出是否需要額外 migration。

B. 執行本包 `03_QA_AND_TOOLS/audit_assets.py`，並用 repo 的工具補做真正的 SVG 安全與建置約束檢查，記錄各 SVG bytes、違規項、對照修正。

C. 依風格規範檢查 4 張在 10／16／22 CSS px、`#FFFFFF` 和 `#111111` 背景的表現，修正明顯的比例、筆觸、白框、雜訊問題。產出可在手機 100% CSS 縮放查看的預覽，不要用放大圖冒充 16px 真實體驗；實機肉眼是否通過由擁有者判定。

D. 保留 `review-pending` 的授權狀態，列出完成權利與來源審核所需證據；**不可自行改成 `owner-original` 並宣稱已簽核**。

E. 在 repo 規範允許的文件區建立／更新 DP-244 Phase 1 的驗收紀錄、後續 Phase 2/3 roadmap，避免把此 ZIP 當作唯一知識來源；但不先接產品執行路徑。

## 第 3 步：交付與 PR 工作流

- 本次完成的是 **Phase 1 審查與素材整理**。不得順手擴張 scope。
- 若 repo 工作方式允許，建立專用 branch、提交 docs + assets + 檢查程式、測試並開 PR。合併應以 CI、review、專案規範為條件；若沒有權限或 review 不通過，不得宣稱已合併。
- 將完成項、測試證據、資產大小、未決風險與需擁有者驗收事項寫成簡潔交接報告。
- 把 Phase 2/3 待辦記入 repo 既有 task 規範，不在本次直接執行。**不得自行部署 production**。

## 不可忽略的細節

- 新貼圖上線時應保存 `assetKey` **以及** `glyph`。`assetKey` 未識別、404 或離線 miss 一律 fallback emoji。
- Phase 3 的月格／日詳情／選擇器／綜覽四處都要驗證，但本次不實作。
- 不更改使用者既有資料與登入／權限設定；不依賴付費第三方圖庫或有歧義的授權。
- 若發現重大 blocker，先整理原因與可選方案；可持續完成不受 blocker 影響的 Phase 1 文件、測試與視覺修正。

### 本次最後輸出格式

1. **現況差距**：repo 具體檔案位置、原提案與實際差異。
2. **Phase 1 已完成**：檔案、SHA／大小、測試證據、PR/commit（如果有）。
3. **未通過 Gate**：問題與改法，不能假裝已驗收。
4. **待擁有者決策**：風格、授權、是否升 Phase 2。
5. **後續最小步驟**：下一個 Agent 開工必需動作。
