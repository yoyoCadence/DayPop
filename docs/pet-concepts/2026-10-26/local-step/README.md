# 保留坐姿的局部步態與模型方案（DP-204）

2026-10-26。依持續開發授權，在獨立分支暫接 DP-203 準備；等它最新四 CI／完成審查合併後才移至最新 main，發自己的 PR。[已記錄方向](../../../pet-motion-handoff-2026-10-23.md) 只定「貓原地步態」，沒有要求站立四肢；本段先保留已採坐姿與模型，量固定頭身尾、只動前爪的方案。仍是素材候選，沒有 App 接入、owner motion approval、新 walk key 或自動位移。

[瀏覽器比較](preview.html) 顯示 [DP-203 全身回應](../../2026-10-25/motion-feasibility/README.md) 與局部 Q85／Q75 的原生 120／60px 循環，附八個原始 PNG 60px、PNG 暫停／重播／reduce／淺深色。[淺底](comparison-light.png)／[深底](comparison-dark.png) 在相同 100／500ms 比較兩種原生來源與局部編碼，皆以 120px 與真正 Lanczos 60px 畫出。動畫各自起播，不能以瀏覽器瞬間截圖當精確 phase 比較。

## 已量測的範圍調整

直接打開發布的 DP-203 `moon_cat.blend`，在 frame 1 保留原模型／材質／base transforms／相機，移除兩個前爪以外的 controls 動畫，保持它們當下的原生姿態。前爪的所有 delta location／rotation／scale 在 frame 1–9 **逐值等於發布來源**，沒有縮小前爪幅度、減取樣或改 phase。其餘 mesh／curve 的 world matrices 在每個取樣都與原 phase 0 相同；只有現有兩個 paw controls 保留 native keys。重新由 Blender 渲染，不是把 PNG 局部貼回去。

輸出八幀，各 100ms，循環 800ms；其中五個姿態唯一，但重複姿態出現在不同時刻，解碼仍保留八個 100ms。第 9 native 幀與第 1 相同，只用於閉環，不多加一幀或延長循環。頭／身體／尾巴固定是動作範圍的變更，不能把其節省宣稱為對 DP-203 全身回應的無損壓縮、感知等價或整體 App 效能改善。

| 局部候選 | WebP bytes | 六態基線＋此 WebP | 192 KiB 剩餘 | 最大 timeline MAE | 結果 |
| --- | ---: | ---: | ---: | ---: | --- |
| Q85／alpha 100 | 5,932 | 191,780 | 4,828 | 0.002933 | 數值過，保守建議 |
| Q75／alpha 100 | 4,928 | 190,776 | 5,832 | 0.003912 | 數值過，留作比較 |

兩者都保留八個原取樣／100ms／loop=0，matched alpha 差 0、淺深底 120／真正 Lanczos 60px normalized 全畫面 RGB MAE <0.008、每幀至少 8／4px 透明。MAE 各自對本段局部原生 PNG 量測，不對 DP-203 全身回應計算；精確數字、durations、最差時間點與 bytes／SHA 在 `manifest.json`。既然 Q85 已容納，保守建議保留較高色彩品質；色彩仍有損，數值過不是擁有者動作驗收。

固定六態算術基線是 [DP-201 五態](../../../pet-loop-encoding-adoption.md)＋[sit RGB128](../../2026-10-25/sit/README.md)，貓 185,848 bytes。加入局部 Q85 為 191,780；飛碟若沿 DP-203 Q85 glide 加 sit RGB128 為 177,869。這僅是兩款七態候選的實檔總量試算，假設 walk 靜態替代共享既有 idle PNG，沒有加入新的獨立替代圖。App 仍五態；沒有改 192 KiB 或制定 App walk 單檔政策，不能宣稱七態產品已完成。

## 模型與產品方案

| 方案 | 已有證據 | 尚未決定／量測 |
| --- | --- | --- |
| 保留坐姿、局部交替前爪 | 本段原檔／八幀、Q85 5,932 bytes，品質與假設總量通過；前爪軌跡不變 | 是否採作最終原地步態、動作品質與 App 播放時機 |
| 保留坐姿、頭身尾也回應 | DP-203 Q85 21,564／Q75 18,078，假設總量都超限；held 品質拒絕 | 本段沒有重新調低品質或刪其他五態補預算 |
| 新站立四肢模型／rig | 尚未試作；現有兩前爪 controls 與融合後肢坐姿體積不足以直接表示四肢行走 | 需另建可分離後肢／髖與步態控制、保留已確認臉／配色／材質，交造型比較；重新驗安全區、姿態交接與實檔預算，不預估會更小 |

優先保留已採坐姿，局部方案可進下一段 **候選七態 typed registry／來源與預算守門**，先使素材可查核、靜態共享與輸出實檔一致；不自動改現有五態播放政策。站立模型只保留選項，不自動重塑。App 如何播放 walk／sit、是否位移、選角、XP 是分開的產品範圍；需要造型改變時再交具體方案供擁有者決定。

## 重跑與驗證

官方 Blender 5.2.3 LTS `e13b728c6880`、Python 3.12.3、Pillow 12.2.0。原檔 [source/moon_cat.blend](source/moon_cat.blend)，八個原生 PNG 在 [frames](frames/)。生成腳本只寫本目錄，DP-203／原五態／App 不動。

```powershell
$blender='C:/Users/memor/AppData/Local/Temp/daypop-blender-5.2.3/blender-5.2.3-windows-x64/blender.exe'
& $blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python docs/pet-concepts/2026-10-26/local-step/create_local_step.py
py -3 -X utf8 docs/pet-concepts/2026-10-26/local-step/pack_local_step.py
py -3 -X utf8 docs/pet-concepts/2026-10-26/local-step/make_preview.py
py -3 -X utf8 docs/pet-concepts/2026-10-26/local-step/check_local_step.py
py -3 -X utf8 docs/pet-concepts/2026-10-26/local-step/test_controls.py
& $blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python docs/pet-concepts/2026-10-26/local-step/test_source_controls.py
& $blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python docs/pet-concepts/2026-10-26/local-step/check_sources.py
```

十三項圖片／metadata 負控制包含缺檔、凍結、有限 loop、錯總長、held 取代八幀、錯 phase、原 PNG alpha=1、偽來源、真實總量超限卻報合格、放寬 policy、假 owner acceptance、錯總量與更換保守建議，全部拒絕並 finally 十三檔逐 byte 還原。八 native 負控制針對前爪軌跡、隱藏頭部動畫、固定頭／身體／尾巴、相機、材質與閉環，拒絕後原 .blend 精確還原。重渲染 checker 在 TEMP 暫存後自動清除；原檔重開，八實幀與閉環幀的 RGBA pixels 已逐像素相同。

Browser plugin not available，使用官方 Playwright CLI。390×844／1280×900 淺深色：14 張圖片原生120px、顯示120／60px，三組原生60px動畫在完整0.8秒週期後仍有幀變化；真PNG暫停不動／重播／reduce恢復、Enter切色／aria-pressed、1項超限／2項數值通過文案、交接連結、無水平溢出或console error／warning。實際browser Asia/Taipei、Node Etc/GMT-8均輸出；四張截圖在OS TEMP `daypop-dp204-{mobile,desktop}-{light,dark}.png`，手機淺色／桌面深色與兩對照板已目視。CLI已關閉，本次Vite PID42192經port／CommandLine核對後停止。lint／typecheck與正向checker通過，產品碼／App資產相對DP-203零差異。

**2026-10-26 優先級調整：** 擁有者要求優先讓不同帳號實際使用行事曆與共同維護事項。此段保存在獨立分支作接手點，尚未發自己的PR／CI；後續寵物封裝與播放政策暫緩，先處理登入／家庭分享的發布與驗收。恢復時先等#198合併、移至最新main，只發本段，不重送前項素材；再跑自己的最新四CI／完成審查。

0.4.3／資料 v4／18 migrations／公告／部署不變，沒有 Supabase 或正式資料操作；DP-171／172／041、擁有者品質與真機未結案。本項最新四 CI／完成審查通過才依持續開發授權合併。
