# 網頁版與本機寵物工作交接（2026-11-05）

擁有者 11-05 表示網頁版先製作了三款寵物，要求使用 Blender，並決定請該網頁任務繼續完成。本機先保存下列候選；沒有重設 main 或覆寫網頁分支。

本輪 GitHub fetch 找到 `codex/signature-toon-pets-20261105`，當時它與 `main` 同為 `c9526886fbd88f1d7dd7cc0de0cd1a04ecd9f469`，diff 為空，尚無新增造型的提交；這不能推定網頁任務沒有產物，只表示尚未推到此遠端分支。下一位接手時先重新 fetch 該分支／PR，依擁有者的最新造型繼續。

## 已推送候選與順序

| 分支 | 範圍 | 狀態 |
| --- | --- | --- |
| `fix/dp-236-mobile-viewport-dialogs` | installed 固定外層、頂部實底、縮放限制與手機表單寬度 | head `72d141e`；本機驗證過，真正 iPhone 系統模糊／鍵盤仍待發布複驗 |
| `feat/dp-238-pet-collection` | 棉花貓／蜂蜜熊／蜜桃兔三款 Blender 原生七態 | head `78cce61`；素材／source／provenance／registry 已保存 |
| `feat/dp-239-pet-choice` | canonical 選擇偏好、v5、備份 v2、本人欄位 migration、設定 | head `c35b7fe`，接素材分支；本機 RLS／真實 HTTP／production 驗證過 |
| `feat/dp-240-pet-autonomy` | 三款新夥伴前景活動、暫停、位置交接、睡眠 | 接選擇分支，提交 hash 以遠端最新為準；詳活動文件 |
| `feat/dp-234-reminder-joint-rollout` | 已發布 0.4.7 的事後驗證與真機通知回報 | head `b281e0c`，純發布／驗收交接，與寵物候選分開 |

原本每段 PR／四 CI／同 head 完成審查／討論全解後合併的要求保留。Chrome browser bridge 持續回報 unavailable；原生瀏覽器操作亦因無法可靠驗證網址被安全機制停止，所以本機沒有假稱 PR 已建立、合併或發布，也沒有改成直接推 main。可由網頁環境依序建立／驗證 PR，避免在 main PR 混入整串未合併差異；堆疊候選的 base 應先對前段 feature branch，前段合併後重新確認 base。

## Blender 與整合契約

本機三款是實際 Blender 原生建模／動畫，交付 [cat.blend](pet-concepts/2026-11-04/source/cat.blend)、[bear.blend](pet-concepts/2026-11-04/source/bear.blend)、[bunny.blend](pet-concepts/2026-11-04/source/bunny.blend) 與可重建腳本、150 張影格、27 份封裝、重新開啟來源的 proof／hash，詳 [素材交付](pet-concepts/2026-11-04/README.md)。保留作可編輯來源及比較，不代表擁有者已採納此三款作為網頁版的最終造型。

新網頁造型整合時仍應交付真正可編輯 `.blend` 與動作資料、實際渲染影格；App seven-state registry、60px footprint／120px 素材、透明邊界與原每款 192 KiB 及個別限制需共同驗證。WebP 的播放時長沿打包 manifest，Blender timeline 保存幾何動作樣本。不要直接替換歷史素材、偽造 provenance 或把靜態圖片的 CSS 移動當成原生走路動畫。

如最終品種 key 不同，先調整未發布的 canonical enum／遷移／SQL CHECK／mapping／fixtures 與產生 types，再跑資料保護、HTTP 及 production 驗證。不得另開臨時 storage 存選擇，活動路徑不得改寫手動保存位置。新三款才接 walk／sit 活動，原月光貓／軌道噗維持五態。

## 正式界線

目前公開仍 0.4.7／user-data v4；三款新素材、選擇與活動、手機外層修正都尚未發布。DP-239 第 23 份 migration 只在本機隔離庫 reset／驗證，正式仍須 owner 明確放行、先 migration 再 v5 前端。既有提醒三份 migration／sender／cron 的正式授權不延伸至新偏好 migration，也不延伸到未來部署。不要回寫 0.4.7 已公開公告。

完整證據：[手機候選（DP-236 分支）](https://github.com/yoyoCadence/DayPop/blob/72d141e/docs/mobile-viewport-dialogs.md)、[選擇／v5](pet-selection.md)、[自主活動](pet-autonomy.md)。DP-234 已記錄擁有者 iPhone 真正收信、匿名內容與點擊回 App 均正常，其餘真機項目不能當成已完成。
