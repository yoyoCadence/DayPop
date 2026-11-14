# DP-244 原始規格整理（非逐字原文）

來源：專案擁有者於 2026-11-14 提供的「圖檔貼圖素材規格（提案，未定案；DP-244）」。**本頁是摘要，若與原 repo 文件不一致，請回查原文與最新決議。**

- DP-243 既有 240 個系統 emoji，DP-244 是可選圖檔貼圖提案，原本沒有任何 UI 接線。
- 三個正式選項：A 繼續系統 emoji、B 開源 emoji 圖檔、C DayPop 自訂漫畫貼圖。
- C 強調同作者同素材包、黑墨線、平塗、3–4 主色、少量網點、白色剪貼邊、透明 1:1、無文字與數字。
- 月格有 19/15/12/10px；日詳情 20px；選擇器 22px；綜覽 23px。16px 有意義辨識、10px 輪廓可辨。
- SVG 優先：純路徑、不得包含 script/圖片/字體/外部連結；或 PNG 512×512 以上透明。部署上限單張 4KB、24 張 ≤ 96KB。
- manifest 欄位：`id,name,category,fallback,file,author,source_url,license,license_url,modified`。
- 類別：`mark`, `mood`, `celebrate`, `work`, `money`, `health`, `travel`, `food`, `home`, `fun`, `weather`。
- fallback 應存在 `sticker-catalog.md`；ID 正式上線後不可變更。
- 商用與再散布權利要可查；禁止個人使用限定、無授權來源或侵害第三方 IP。AI 輔助自製亦須核查服務條款及相似性風險。
- 原始預期不需 migration：`stickers` 表有 `asset_key`，約束 `glyph` 與 `asset_key` 至少一者不為空。
- 新資料應有 assetKey 與 glyph 雙欄位，四處 UI 有資產就顯示，否則 fallback，SW 快取離線可用，關於頁／repo 保留署名。
- 亮暗模式、手機驗收、授權、大小與不破壞舊版都是發布門檻。

**修訂補充**：原提案把部分開源授權的連帶效果簡化，正式採用第三方圖示時必須逐套依原始授權條款與實際使用方式核對，不能把此摘要當法律意見。
