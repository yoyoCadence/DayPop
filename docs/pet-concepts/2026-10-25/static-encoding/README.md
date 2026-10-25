# 靜態 PNG 編碼與剩餘預算評估（DP-198）

2026-10-25。只交六張已發布靜態替代的 24 個編碼候選、實際像素驗收、失敗對照與 [互動比較頁](preview.html)。App 尚未採用候選，原 PNG／動畫／Blender、每款 192 KiB、App 0.4.3／user-data v4／18 migrations／公告／部署都不變。

製作分支由當時 main `dcd8986` 建立，暫接 registry `e9d40a5` 與完成回饋 `b8c4c9b`；registry PR #191 已四項 CI／完成審查無發現、無未解決討論後合併 `4ef75ce`。DP-197 PR #192 head `c35979b` 的 run `40164518454` 四項全過（Chromium 285 passed／13 skipped、21.5 分鐘；WebKit 8 passed），完成審查無發現、無未解決討論後合併 `c38e7b4`。本段已對齊此最新 main，不重送既有產品碼或 App 素材。`sourceCommit` 保留實際讀取的 registry 提交；自己的四項 CI／審查仍須通過才合併，沒有部署。

## 結果與採用界線

月光貓目前五態包只餘 322 bytes。本輪保守建議 `rgb128`：先用 Median Cut 將 RGB 縮為最多 128 色，再放回**原本逐像素 alpha**，輸出仍是 RGBA PNG。色彩有損，PNG 格式的無損壓縮不代表量化過程無損；細節與漸層仍待擁有者目視驗收。

| 角色 | 原三 PNG 合計 | rgb128 三 PNG | 可省 bytes | 假設採用後五態包 | 192 KiB 餘裕 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 月光貓 | 40,214 | 34,908 | 5,306 | 190,980 | 5,628 |
| 軌道噗 | 31,053 | 24,496 | 6,557 | 167,288 | 29,320 |

idle PNG 同時供 look／jump 使用，按唯一檔案只算一次。表中五態包含現有四張動畫與三張 PNG，**不是七態預算**；walk／sit 尚未製作，不能從餘裕推論能放入。此段沒有新增素材狀態、觸發政策、自動走動、選角或 XP，後續採用應另 PR。

## 四種候選

Pillow 12.2.0，全部不使用 dithering，PNG `optimize=True`。`indexed256`／`indexed128` 用 RGBA Fast Octree 輸出索引 PNG；`rgb256`／`rgb128` 用 RGB Median Cut 後還原原 alpha，輸出 RGBA PNG。

| 方案 | 貓假設五態 bytes | 飛碟假設五態 bytes | 貓最大 MAE | 飛碟最大 MAE | 最大 alpha 差異（貓／飛碟） | 本輪結果 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| indexed256 | 166,013 | 151,312 | 0.00466531 | 0.00342692 | 29／30 | 不採，alpha 改變 |
| indexed128 | 164,361 | 149,444 | 0.00518092 | 0.00421668 | 45／56 | 不採，alpha 改變；飛碟 grab 邊距不足 |
| rgb256 | 192,943 | 169,045 | 0.00163889 | 0.00170788 | 0／0 | 通過，保留比較 |
| rgb128 | 190,980 | 167,288 | 0.00248221 | 0.00245861 | 0／0 | 技術建議，尚未採用 |

MAE 是在淺底 `#f5f3ee`、深底 `#111827`，分別以 120px 與真正 Lanczos 60px 合成後，整張 RGB 絕對差除以 `width × height × 3 × 255` 的最大值。沿用 0.008 品質門檻，沒有以平均透明面積宣稱感知等價。本輪 PNG 替代另要求兩尺寸的 alpha 逐像素完全相同，以及四周 120px 至少 8px／60px 至少 4px 透明。

索引方案雖通過整張 MAE，仍因 alpha 不相同而不合格；飛碟 grab 的 indexed128 在 60px 右界達 x=57，只餘 3px。生成流程首版在此不安全候選中斷，後改成保留實測失敗資料並標 `eligible=false`，採用門檻與 8／4px 規格不變。不能用不合格索引方案的較小 bytes 當作可用預算。

## 可重現來源與守門

`contract.py` 直接查 DP-187 motion／DP-190 sleep 已發布 manifest 的靜態檔 SHA。固定五態包由 DP-194 的歷史四態計算器，加貓 DP-195 `fullQ55A70` 或飛碟 DP-194 Q85 jump 重建，逐檔核對發布來源；不依賴未來可變的 App PNG 或 performance-budget。原包固定為 196,286／173,845 bytes。

```powershell
py -3 -X utf8 docs/pet-concepts/2026-10-25/static-encoding/build_candidates.py
py -3 -X utf8 docs/pet-concepts/2026-10-25/static-encoding/check_candidates.py
py -3 -X utf8 docs/pet-concepts/2026-10-25/static-encoding/test_controls.py
```

checker 核對精確 24 檔 inventory、固定 source／output 路徑、來源及候選 bytes／SHA、PNG 單幀／120px／P 或 RGBA mode／RGB 色數、實際像素／alpha／安全區、eligible 與推薦方案，以及每 PNG 16 KiB／每款 192 KiB。失敗方案只作資料保留，推薦方案必須三 PNG 都合格並符合整款上限。

八項循序真實負控制全被拒絕：缺檔、偽造來源 hash、錯 PNG mode、邊界 alpha=1、內部 alpha 只改 1、把索引候選偽標合格、實檔超單檔上限、三檔各追加 2,000 bytes 後超整款上限。涉及實檔變造的案例同步實際 bytes／hash／量測／包總量，避免只被過期 metadata 擋下；`finally` 將 25 檔逐 byte 還原，正向驗收再次通過。

## 畫面驗收

[淺底對照](comparison-light.png)／[深底對照](comparison-dark.png) 將真正 60px 樣本以 nearest 放大兩倍，標示每檔 bytes；原圖與兩種 RGB／索引方案皆保留，不作新的原幀。兩張對照板已目視。

Browser plugin not available，使用專案 Playwright CLI。390×844 與 1280×900 各驗四方案六組原圖／候選，原生 PNG 解碼、120／60px 顯示、方案選單、淺／深色、無水平溢出與 console 通過。browser 實際時區均回傳 `Asia/Taipei`；canvas 直接讀取原生解碼的 alpha，RGB 兩方案六張均為 0，索引差異與離線數據相同。首輪 `getByLabel` 找不到含選項文字的 label，改用 AX 已確認的 combobox 角色定位；另補空 favicon 消除文件頁的 404，沒有忽略 console 錯誤。手機淺色／桌面深色截圖已目視，四張圖位於 OS TEMP `daypop-dp198-{mobile,desktop}-{light,dark}.png`。

本段沒有產品 runtime 變更；DP-197 同一產品碼的 1,402 單元＋29 Node、44 相關 e2e passed／2 既有 skipped、lint／typecheck／build／check:build 已通過，這裡不把它們當成新一輪測次。本段重新執行 lint／typecheck、候選 checker、五份 Markdown 的 142 個本機連結與 `git diff --check` 通過，產品來源／e2e／scripts／預算及套件相對 DP-197 零差異。Playwright 命名 session 已關閉；port 4173 的 PID 38768 經 listening port 與 Vite command line 核對後停止。發 PR 前仍要確認最新 main，自己的四項 CI／完成審查通過才合併。Windows／Linux 模擬器不代替真 iPhone／standalone 驗收；DP-171／172／041 未結案。
