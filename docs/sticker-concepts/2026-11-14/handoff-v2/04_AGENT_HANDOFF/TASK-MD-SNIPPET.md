# 可直接加入專案 `task.md` 的項目（依 repo 現有格式調整）

## DP-244 自訂漫畫貼圖（目前僅 Phase 1）

**狀態**：Proposal / Phase 1 visual validation，未批准產品整合。

### Phase 0｜Repo 與資料結構盤點
- [ ] 閱讀 AGENTS.md／DP-243／DP-244／sticker-catalog／schema／UI／SW。
- [ ] 查證 4 個 fallback 與 category／asset ID 相容。
- [ ] 記錄 JS bundle 和既有 build／部署基準。

### Phase 1｜4 張圖稿可用性
- [x] `happy`, `gift`, `cake`, `hiking` SVG 草稿與 preview。
- [x] 4 張 SVG 靜態大小均低於 4KB。
- [ ] 10／16／22px 的手機深淺模式目視驗收。
- [ ] SVG 安全檢查與後續正式建置檢查。
- [ ] 圖片外觀／對比修訂並取得擁有者視覺核准。
- [ ] 補全生成來源、權利檢核；授權從 `review-pending` 轉成可發布狀態 **需人工核准**。
- [ ] 在 repo 留 Phase 1 結果與阻擋條件。

### Phase 2｜24 張完整圖檔（待批准）
- [ ] 根據常用紀錄或明確標記的候選排序選 24 個 fallback。
- [ ] 同風格製作／分批 PR／尺寸及授權 QA；≤ 96KB。

### Phase 3｜App 整合（待批准）
- [ ] 資產 registry 與 manifest 驗證。
- [ ] assetKey + glyph 雙存、未知 assetKey/下載失敗 fallback。
- [ ] 四處 UI 接線、SW 離線快取、無障礙名稱。
- [ ] 署名、完整回歸測試、CI、PR／審查、決定發布。
