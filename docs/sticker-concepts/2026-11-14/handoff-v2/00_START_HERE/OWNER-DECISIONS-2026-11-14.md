# Owner Decision — DP-244, 2026-11-14

**優先級：本檔高於此交接包較早的「未決」敘述，但不能凌駕 GitHub repo 的 `AGENTS.md`、正式 schema、安全／發布 gate。**

## 查核 repo（2026-11-14）

- 倉庫：`yoyoCadence/DayPop`，public；主分支 `main`。
- `tasks.md`: DP-243 Done（240 emoji, 11 類）；DP-244 Backlog（未接上貼圖檔）；DP-245 是 0.5.0 發布工作；不要混淆。
- `src/domain/stickerGlyphs.ts` 為清單真實來源，並在 `docs/sticker-catalog.md` 列出；存在 😊、🎁、🍰、**⛰️**，**不存在 🏔️**。原 ZIP 的 hiking fallback 有錯，此 v2 manifest 已修。
- `docs/sticker-asset-spec.md` 為 DP-244 原始提案，不可把它誤當已完成工程。
- `supabase/migrations/20260801092905_daypop_core_schema.sql` 已有 `asset_key`，目前設計預計不需 migration，但 Phase 3 仍需真實驗證。
- 依 `AGENTS.md`：JS gzip 剩約 1.3 KB；素材不能打包進 JS；`deploy-staging.yml` 手動觸發；未授權不得部署或重寫已發布公告。

## 七項決策

1. **可讀性：目前不通過，要求修改後重驗，不停止專案。** 以 `preview.html` 的 100% CSS 實際尺寸 10／16／22px × 白／深背景實測。`gift`、`cake` 先保留候選；`happy`、`hiking` 必須簡化。16px 能直接辨識內容，10px 至少分得出主色與基本輪廓，且必須放回實際月格測。手機實機核可前不能標 PASS。
2. **happy 重繪：採臉部大特寫。** 讓五官與臉至少佔主要視覺面積，避免小身體、手腳與裝飾；以 😊 為 fallback，不新增 emoji。保留原創漫畫臉設計，但不模仿現有角色。
3. **hiking 重繪：以山峰當主體，拿掉背包與過小細節。** 以簡潔山形＋日光（可選）呈現；fallback 必須是清單中的 `⛰️`，不是 `🏔️`。控制色數最多 4 個主色；若 16px 仍無法分辨，繼續降低細節。
4. **色彩：最多 4 個主色，允許同一主色的小幅明暗變化，但不准藉色階偷渡複雜漸層。** 統一線寬、色彩語言、貼紙白邊與對比。增加用色並非提高 10px 識別率的主要方法。
5. **素材權利：同意原創 SVG 做本專案的商用及公開使用候選，但此決議不是法律查核已過。** 根據本包 `asset-provenance.md`，SVG 為 ChatGPT 輔助撰寫，概念海報另由 ChatGPT 圖像生成；日期 2026-11-14。保存 service/version if known、日期、製作流程、人工修改、原檔 SHA256、OpenAI 條款頁（含查核日期）與經人工核對的第三方相似性風險。不要假稱人工手繪、獨家 copyright 或已合法清權；manifest 先留 `review-pending`，QA 與權利查核通過後才准依專案授權格式最終更新。
6. **公開：允許公開 repo 保留正式成果與非機密的設計／授權證據；不公開完整私人對話、敏感資訊或未審查第三方素材。** GitHub 是 public，提交即可能被看見；未核准素材先留工作區或保護分支之外，不要藉 PR 將 `review-pending` 素材公開。保留原有開源授權與所有歷史 release note 不變。
7. **Phase 2：條件式批准。** Phase 1 四張達 16px／10px 深淺背景與真實月格 QA、掃描、安全、license gate 後，可開始**製作補充 20 張**，總共 24 張；不需要蒐集使用者行為才開始。現有「最近」是依貼圖紀錄推算，沒有全體使用頻率統計；24 張的選擇須標註「人工的產品優先假設」，先覆蓋 11 分類常用情境，不得說是資料驅動排名。Phase 3 上線、DB／部署仍須獨立 QA 與擁有者核可。

## Agent 立即待辦

1. 核對 `src/domain/stickerGlyphs.ts`，寫測試要求每筆 `fallback` 在正式清單內，尤其 `hiking=⛰️`。
2. 重新做 happy / hiking SVG；更新 `manifest.csv`、對照板、檢查檔、hash 與可預覽頁，避免舊圖與新圖不同步。
3. 在本地與手機看 10／16／22px 深淺背景、真實月格；證據未取得不可宣稱驗收通過。
4. 輸出素材權利審核表，記錄真實來源與發現，不要草率把 `review-pending` 改成 `owner-original`。
5. 維持 Phase 1 階段，直到上述 gate 全過；達標才進 Phase 2 製作候選 20 張；不部署、不修改既有 240 emoji、不提高 JS 預算、不改 Auth 或 schema。

## Links

- [GitHub repo](https://github.com/yoyoCadence/DayPop)
- [DP-243 catalog](https://github.com/yoyoCadence/DayPop/blob/main/src/domain/stickerGlyphs.ts)
- [DP-244 original spec](https://github.com/yoyoCadence/DayPop/blob/main/docs/sticker-asset-spec.md)
- [tasks](https://github.com/yoyoCadence/DayPop/blob/main/tasks.md)
- [OpenAI terms](https://openai.com/policies/terms-of-use/)
