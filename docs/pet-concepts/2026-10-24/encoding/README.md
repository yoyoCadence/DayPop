# 四態編碼候選與圖片預算評估（DP-191，2026-10-24）

DP-190 的 sleep 直接加入舊三態時，兩款都超過既有每款 **192 KiB＝196,608 bytes**。這一段沿持續開發授權量測編碼，交付可重跑腳本、六個 Q85 減樣候選、原始 [量測／hash／時序](manifest.json)與 [60px 原生播放對照](preview.html)。**App 資產、registry、播放政策與預算不變；候選尚未採用，也不是 sleep 動作品質已經由擁有者驗收。**

## 結果與建議包

| 角色／動畫 | 原 10fps Q85 bytes | 約 5fps 候選 bytes | 候選實際解碼幀 | 總時長 |
| --- | ---: | ---: | ---: | ---: |
| 貓 idle | 112,830 | 52,324 | 20 | 4.4s |
| 貓 look | 37,998 | 21,044 | 9 | 1.6s 單次 |
| 貓 sleep | 107,120 | 50,314 | 20 | 4.4s |
| 噗 idle | 95,760 | 43,598 | 20 | 4.4s |
| 噗 look | 34,894 | 19,670 | 9 | 1.6s 單次 |
| 噗 sleep | 93,440 | 42,828 | 20 | 4.4s |

| 四態包（含三張 PNG） | 月光貓 bytes | 軌道噗 bytes |
| --- | ---: | ---: |
| 三段動畫都用原 10fps | 298,162 | 255,147 |
| 三段動畫都減樣 | 163,896 | 137,149 |
| **建議：idle／sleep 減樣，look 沿原 10fps** | **180,850** | **152,373** |

建議保留短 look 的原始 100ms 微動時序，較慢的 idle／sleep 用減樣候選；四態仍在現有預算內。這是 agent 的接入建議，不是在本段改 App。三張 PNG 是 idle、grab、sleep，分別共 40,214／31,053 bytes；look 的減少動態替代沿用 idle PNG，不重複計數。候選只新增六個 WebP，PNG 與原 look 直接引用既有來源，沒有複製另一套靜態檔。

## 取樣、品質與限制

- 直接讀 [DP-187 原始三態](../../2026-10-23/motion/README.md)與 [DP-190 sleep](../sleep/README.md) 的真實 120px PNG，原 Blender／PNG／原 WebP 都不改。來源 commit 為 DP-190 的 `23f09c4`；PR 前會對齊該段合併後的 main，來源身分保留。
- 原每幀 100ms，每兩幀取一幀並 hold 200ms。look 額外保留原第 15（零起算）幀，最後兩個 interval 各 100ms，完整保留 1.6 秒與真正末幀回原姿態。idle／sleep 仍各 4.4 秒循環。原 22 個取樣槽在相鄰幀相同時被 WebP 合併成 20 個 decoded frames，不能宣稱每個原生幀都固定 200ms。
- **總時長不變不等於全部微動時序相同。** 例如 idle 的原眨眼中心幀會保留，但被 hold 的閉眼姿態可比原先久；因此建議只減樣較慢的 idle／sleep，look 保留原包。減樣看起來會比較分段，應在 60px 原尺寸自行對照；量化檢查不能代替主觀動作品質。
- 每段各試 `minimize_size=False／True` 的 Q85＋alpha quality 100／method 6，選實際 bytes 較小者，選項與兩種大小都記入 manifest。不以壓縮選項名稱推定比較小；不同 Pillow／libwebp 版本重建可能改變 bytes，需整套重跑。
- 品質比較涵蓋**原始每一個 100ms interval**，包括被省略但由上一幀 hold 的時間。將來源／decoded RGBA 合成到 `#f5f3ee`，算整張 120px RGB 平均絕對差／255；最大值必須小於既有試作的 0.008。候選最大約 0.00526（貓 look），建議包的兩段減樣最大約 0.00466。manifest 同時有最大值與按原始時間 interval 加權的平均值。
- WebP 真正解碼後檢查每幀尺寸、120px 至少 8px／實際 LANCZOS 60px 至少 4px 透明、loop、每個 duration、總時長、look 最後一幀 alpha 與真正來源末幀完全相同。包體積重讀所有檔案並套用目前 `performance-budget.json`；不相信手寫 byte 表，也不把 GIF／原幀／預覽 HTML 算成 App 預載。

上述整張平均值包含透明區域，不是 SSIM、感知等價、瀏覽器解碼速度、耗電或真機順暢程度。兩個原生 WebP 的解碼／起播時間也未必同步，互動頁用來看播放；精確 interval 比對以離線 checker 為準。沒有宣稱整體 App 載入或渲染已提升。

## 驗收與重跑

PowerShell repo 根目錄，使用本機既有 Python／Pillow 12.2.0；不需要重跑 Blender：

```powershell
py docs/pet-concepts/2026-10-24/encoding/encode_candidates.py
py docs/pet-concepts/2026-10-24/encoding/check_candidates.py
py docs/pet-concepts/2026-10-24/encoding/test_controls.py
```

依序執行，負控制會暫時改真正候選，不與瀏覽器預覽或重新編碼平行跑。缺檔 checker 先失敗；完成後七項真實檔案負控制均拒絕：缺候選、靜態冒充動畫、錯誤時長、1px 越界、左右鏡像造成品質差、丟掉 look 真正末幀、有效 WebP 加實際尾端 bytes 讓整款超限。最後一項同步修正 metadata 的 byte 數，確保抓到的是實檔總預算。另變造候選 manifest 的來源 hash 亦拒絕：會核對 DP-187／DP-190 已交付的 manifest，不能只重新記錄當下來源就宣稱原檔未變。八輪 finally 精確還原候選／manifest，重新驗收與所有輸入 SHA-256 通過。

Browser plugin not available，沿專案 Playwright 的獨立 Chromium context（390×844／1280×900、實際 `Asia/Taipei`）。兩款三動畫候選有畫面變化，look 單次結束後保持靜止／可重播；grab、靜態與 reduce 用真正 PNG，深色無水平溢出，URL／title／非空白／無 Vite overlay、console／pageerror 通過並查看截圖。第一次桌面飛碟 look 取樣失敗；三次獨立重播皆有變化，首張 screenshot 曾耗 1.5 秒。測試改成等圖片 decode、明確重播再連續取樣後，兩 viewport 完整重跑通過，沒有以改產品計時掩蓋失敗。暫存腳本／截圖在 `%TEMP%/daypop-dp191-*`。

下一段可評估採用建議包與 sleep 觸發政策，各自有 App 整合／失敗與離線回歸；本段維持 App 三態、未改 0.4.3／資料 v4／18 migrations、公告／部署，DP-171／172／041 未結案。

PR #185 已四項 CI 過／審查無發現後合併 `404ba8e`（run `40061845848`；Chromium 271 passed／13 skipped、WebKit 6 passed）。本段發 PR 前已移至該最新 main，保留 `23f09c4` 為實際來源身分，不重送 DP-190。該基底的最終 lint／typecheck、1,382 單元＋24 Node、build／check:build 通過；產品圖片仍貓 177,790／飛碟 151,453 bytes，JS 744,986 raw／219,439 gzip、CSS 112,388／27,272。最新 PR 四項 CI 與審查通過後才依授權合併；接著 DP-192 採用混合包、sleep 先只進 registry，沒有自動部署。
