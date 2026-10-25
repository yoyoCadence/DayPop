# idle／sleep 編碼參數與剩餘預算（DP-200）

2026-10-25。四段既有循環動畫、各四種 WebP quality／alpha quality，共 16 個候選。只做編碼評估、[原生比較頁](preview.html)、[淺底](comparison-light.png)／[深底](comparison-dark.png)與可重現量測；App 尚未採用，沒有新增 walk／sit 或修改動畫／觸發政策。每款 192 KiB、App 0.4.3／user-data v4／18 migrations／公告／部署不變。

本機由當時 main `4ef75ce` 的獨立分支暫接 DP-197–199 製作；`preparationCommit` 保留當時本機提交，只作製作追溯。PR #194 head `72c9841` 的 run `40167373443` 四項 CI 全過（Chromium 285 passed／13 skipped、22.0 分鐘；WebKit 8 passed），完成審查無發現、無未解決討論後合併 `1cbbc5b`。本段已移至此最新 main，重新核對發布輸入的 SHA 後，以此公開提交記為 `sourceCommit`；候選 bytes 不改。只送本輪候選與評估，不重送前項素材／產品碼，自己的最新四 CI／完成審查仍須通過才合併。固定輸入直接查已發布素材 manifest／SHA，不依賴可變的 App 資產或 performance-budget。

## 結果與保守建議

DP-199 的五態包為貓 190,980／飛碟 167,288 bytes，貓只餘 5,628。先量目前占較多空間的 idle／sleep，沿 DP-191 相同 22 個 held slots、合併後 20 個解碼幀與 4.4 秒循環；沒有再次減幀、改 look／jump、降低尺寸或增加預算。

| 編碼方案 | 貓 idle／sleep bytes | 貓假設五態包 | 飛碟 idle／sleep bytes | 飛碟假設五態包 | 兩款最大 matched alpha 差 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 目前 Q85／A100 | 52,324／50,314 | 190,980 | 43,598／42,828 | 167,288 | 0 |
| **建議 Q75／A100** | **43,862／42,104** | **174,308** | **35,966／35,366** | **152,194** | **0** |
| 比較 Q55／A100 | 39,924／38,494 | 166,760 | 32,460／32,118 | 145,440 | 0 |
| 比較 Q55／A70 | 31,170／29,736 | 149,248 | 25,690／25,274 | 131,826 | 11 |
| 僅數值合格 Q35／A50 | 27,006／25,650 | 140,998 | 21,766／21,230 | 123,858 | 16 |

四方案數值都通過原始時間點淺深底 MAE <0.008 與 8／4px 安全區，但最小的 Q35 在 120px 貓臉與陰影可見斑駁。比較板保留這項取捨，預覽明示不作建議；沒有為了 bytes 把它當作品質已合格採用。Q55 兩方案保留比較，**本輪保守建議 Q75／A100**，matched 原取樣幀的 alpha 差為 0，不改原 alpha quality，色彩仍有損。

假設另 PR 採用 Q75／A100，貓可省 16,672 bytes、餘 22,300；飛碟省 15,094、餘 44,414。這仍是五態七唯一檔案，靜態 PNG 共享只算一次，不能保證七態能裝入。擁有者色彩／動作品質驗收仍未完成，整張 MAE 不是感知等價或真機效能。

| 建議候選 | 120／60px、淺／深底最大時間點 MAE |
| --- | ---: |
| 月光貓 idle | 0.00454848 |
| 月光貓 sleep | 0.00368946 |
| 軌道噗 idle | 0.00527724 |
| 軌道噗 sleep | 0.00454857 |

## 重現與守門

Pillow 12.2.0，method 6；每方案實試 minimize_size False／True，保存較小的實檔與兩者 bytes，不從選項名稱推定大小。最終生成腳本完整重跑，16 個 WebP 逐 byte 重現、checker 再過；沒有只手改 metadata 充當可重現輸出。編碼器／Pillow 版本改變可能改 bytes，應重跑全部驗收。

```powershell
py -3 -X utf8 docs/pet-concepts/2026-10-25/loop-encoding/build_candidates.py
py -3 -X utf8 docs/pet-concepts/2026-10-25/loop-encoding/make_preview.py
py -3 -X utf8 docs/pet-concepts/2026-10-25/loop-encoding/check_candidates.py
py -3 -X utf8 docs/pet-concepts/2026-10-25/loop-encoding/test_controls.py
```

原幀是 DP-187 idle 與 DP-190 sleep 各款各 44 張真實 120px PNG，逐檔核對已發布 SHA。現行參照直接讀 DP-191 Q85-half manifest，來源與 22 個 slot 的 indices／durations 固定；候選 decoded durations 必須與參照完全相同，loop=0、總長 4,400ms。預算由 DP-198 固定歷史五態包換入已發布 RGB128 三 PNG 重建，等於 DP-199，沒有改寫來源母檔或已發布 manifest。

真實解碼後，按原 44 個 100ms 時間點（含 held 的未取樣幀）、120px／真正 Lanczos 60px，在 `#f5f3ee`／`#111827` 合成，逐時間點求 RGB 絕對差／`width × height × 3 × 255`。記錄最大值、時間平均與最差時間點；全畫布包含透明區，不能推論細節感知完全相同。`maxMatchedFrameAlphaError` 比對解碼段起點的真正原幀；它為 0 不代表 held 的中間時間點與原 10fps alpha 全相同。

checker 重讀精確 16 檔、來源／輸出路徑與 bytes／SHA、動畫格式／尺寸／loop／時序、實際像素與安全區、eligible、保守推薦及唯一檔案包總量。idle 128 KiB／sleep 64 KiB／每款 192 KiB 不變；較小 Q35 的 eligible 僅代表數值合格，推薦規則另固定 Q75／A100 與 matched alpha=0。對照板取 Q35 在 120px 深底最差的原始時間點，五欄均為同一時間，120px 與原生 60px，不是重新製作原幀。

十一項循序負控制涵蓋缺檔、偽造原幀 SHA、靜圖冒充動畫、錯 loop、錯總長、總長相同但 phase 改變、單一邊界 alpha=1、逐幀鏡像、真實 sleep 超 64 KiB、偽造 eligibility 與包總量。涉及像素或 bytes 的變造同步 hash／量測／eligibility／總量，避免只被過期 metadata 擋下；最初三個結構案例只撞 hash 的測試前置已補同步後重跑，真正由格式／loop／duration 拒絕才列為證據。`finally` 17 檔逐 byte 還原並正向再過。

## 畫面驗收與接續

Browser plugin not available，沿專案 Playwright CLI。390×844／1280×900、實際 `Asia/Taipei`，四方案各四段候選在原生 60px 都有幀變化；Q75 在超過完整 4.4 秒後另取多個時間點仍有變化，PNG 暫停／重播／reduce、方案選單、淺深色、無水平溢出、console／pageerror 通過。首輪循環 QA 用 4.7 秒後單張是否不同推論循環，碰到重複姿態；改成週期之後的多點取樣才列為證據，不更改素材 loop 或門檻。比較板與手機淺色／桌面深色原尺寸卡片已目視，四張截圖位於 OS TEMP `daypop-dp200-{mobile,desktop}-{light,dark}.png`。CLI session 已關閉，本次 port 4173 的 PID 29544 經監聽與 helper CommandLine 核對後停止；之後才執行最終十一負控制與正向驗收。

本段沒有產品 runtime 變更，相對 DP-199 的 src／e2e／scripts／預算與套件零差異。DP-199 的 1,402 單元＋29 Node 與 36 相關 e2e 不當作本段新測次；本段另跑 lint／typecheck、候選 checker、五份 Markdown 的 150 個本機連結與 diff 檢查通過。發 PR 前核對最新 main、自己的四項 CI／完成審查通過才合併。真 iPhone／standalone、擁有者品質確認、七態／選角／XP 與 DP-171／172／041 均未結案。
