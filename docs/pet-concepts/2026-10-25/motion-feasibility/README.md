# 原地踏爪與傾斜滑行可行性（DP-203）

2026-10-25，依持續開發授權，在獨立分支暫接 DP-202 準備。沿 [sit 段落查明的模型限制](../sit/README.md)，貓試作 `paw_step` 原地交替前爪，軌道噗試作 `glide` 傾斜滑行。保留既有 mesh／材質／base transforms／相機，貓沒有站立四肢或後肢 rig；這個試作不能當作完整行走。沒有接入 App、增加 walk key、自動位移、播放政策或 XP。2026-10-26 發布整備：PR #197 head `939e0b0` 的 run `40194574393` 四 CI／完成審查無發現、無未解決討論後合併 `96b3836`（Chromium 285 passed／13 skipped、18.1 分鐘；WebKit 8 passed）。本段已對齊此最新 main，只送 motion 可行性；`sourceCommit` 記公開基底，`preparationCommit` 保留本機試作 `dd10045`。輸入 SHA 重新核對，Blender／PNG／WebP bytes 與已驗提交相同；自己的最新四 CI／完成審查過才合併。

[瀏覽器預覽](preview.html) 包含三個參數候選、真正 120／60px、原始八幀 60px、暫停 PNG／重播／reduce／淺深底；原生動畫各自起播，精確相同時間點比較見 [淺底板](comparison-light.png)／[深底板](comparison-dark.png)。[原始淺底幀表](frames-light.png)／[深底幀表](frames-dark.png) 每個真實 PNG 各以 120px 及 Lanczos 60px 繪製，並未放大冒充小尺寸。

每款原生 8 個取樣、每幀 100ms，循環 0.8 秒；Blender 第 9 幀等於第 1 幀，僅供閉環驗證，不重複輸出到編碼尾端。貓只抬交替前爪、頭尾輕微回應，root 留在原地；飛碟由 root 傾斜及微幅滑行，沒有腿或新幾何。首輪飛碟的正向路徑在真正 Lanczos 60px 的右側只剩 3px，checker 實際失敗；已改為配合傾斜方向的反向微幅路徑，重渲染後全部八幀守住四周至少 8／4px，相機與門檻沒有改。

## 實際編碼與拒絕結果

以下假設包為 [DP-201 五態](../../../pet-loop-encoding-adoption.md) 加 [DP-202 sit RGB128](../sit/README.md)（185,848／160,369 bytes），再只加本動作 WebP；沒有計入新增獨立替代 PNG，也不代表 App 已採六／七態。每款 192 KiB、MAE <0.008 與 8／4px 不變，沒有制定新的 App walk 單檔政策。

| 角色／候選 | WebP bytes | 假設包 bytes | 192 KiB 剩餘 | 最大 timeline MAE | 結果 |
| --- | ---: | ---: | ---: | ---: | --- |
| 貓 Q85 full | 21,564 | 207,412 | -10,804 | 0.003170 | 品質數值過，超限 |
| 貓 Q75 full | 18,078 | 203,926 | -7,318 | 0.004312 | 品質數值過，超限 |
| 貓 Q75 held | 6,572 | 192,420 | 4,188 | 0.009209 | 總量過，品質拒絕 |
| 飛碟 Q85 full | 17,500 | 177,869 | 18,739 | 0.003473 | 數值與假設總量過 |
| 飛碟 Q75 full | 14,444 | 174,813 | 21,795 | 0.004360 | 數值與假設總量過 |
| 飛碟 Q75 held | 7,220 | 167,589 | 29,019 | 0.020034 | 總量過，品質拒絕 |

full 保留八幀／100ms；held 保留原 indices 0／2／4／6，各持有 200ms。每個候選都在原八個時間點，量淺深底 120px／真正 Lanczos 60px 的全畫面 normalized RGB MAE，取四組中的最大值；`manifest.json` 保留每組數字、最差時間點與實際解碼 durations。matched 來源幀 alpha 差皆為 0，held 的中間時刻仍因姿勢持有而與原圖不同，不能用 matched alpha=0 冒充保留完整動作。兩款 held 都超過門檻，明確拒絕；本批貓沒有同時通過品質與預算的候選。

Q75 full 的 120px 仍可看見有損色彩紋理；數值合格不是感知等價或擁有者已接受。沒有為了塞預算再降到更低品質、再減幀，或把原地踏爪改名為完整 walk。所有候選保留供比較，`productionReady`／`appIntegrated`／`fullCatWalkImplemented`／`ownerMotionApproved` 皆 false。

## 原檔與驗證

官方 Blender 5.2.3 LTS `e13b728c6880`、Python 3.12.3、Pillow 12.2.0。發布的 DP-187 原檔 bytes／SHA 固定，兩份可編輯 [Blender](source/) 只新增既有 controls 的 native keys；16 張實際 PNG 在 [frames](frames/)。不改歷史五態來源或 App。原生幀不是由舊 PNG 平移／旋轉製成。

```powershell
$blender='C:/Users/memor/AppData/Local/Temp/daypop-blender-5.2.3/blender-5.2.3-windows-x64/blender.exe'
& $blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python docs/pet-concepts/2026-10-25/motion-feasibility/create_motion.py
py -3 -X utf8 docs/pet-concepts/2026-10-25/motion-feasibility/pack_motion.py
py -3 -X utf8 docs/pet-concepts/2026-10-25/motion-feasibility/make_preview.py
py -3 -X utf8 docs/pet-concepts/2026-10-25/motion-feasibility/check_motion.py
py -3 -X utf8 docs/pet-concepts/2026-10-25/motion-feasibility/test_controls.py
& $blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python docs/pet-concepts/2026-10-25/motion-feasibility/test_source_controls.py
& $blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python docs/pet-concepts/2026-10-25/motion-feasibility/check_sources.py
```

先生成、編碼再做負控制，期間不得同時修改／讀取受測檔。重渲染 checker 在 OS TEMP 暫存並自動清除圖檔；本機升權執行同一有限命令，兩份 .blend 重開後，全部八幀及第 9 閉環幀的 RGBA pixels 與交付 PNG 完全一致。native 另驗原 mesh／材質、base hierarchy／transforms、全部取樣相機／anchor、眼睛、前爪交替／正反傾斜、native keys 與閉環。

十二項圖片／metadata 負控制：缺檔、凍結靜態 WebP、有限 loop、錯總長、相同總長錯 phase、原始邊界 alpha=1、偽貓預算通過、偽 held 品質通過、放寬 policy、偽來源 SHA、把 paw-step 改名 walk、實檔總量超限卻宣稱合格。全部拒絕，finally 27 檔逐 byte 還原後正向通過。八項 native 負控制：動態相機、mesh、base anchor、缺交替前爪峰值、錯閉環、錯 fps、凍結飛碟、材質；全部拒絕，finally 兩份 .blend 精確還原、語意正向再過。

Browser plugin not available，使用官方 Playwright CLI。390×844／1280×900、淺深底：28 張原生圖片以真正 120／60px 顯示，六個候選的原生 60px 動畫超過 0.8 秒完整週期後仍有幀變化；真 PNG 暫停不動／重播／reduce 與恢復、Enter 切色／aria-pressed、各兩項品質拒絕／預算拒絕／數值通過文案、交接連結、無水平溢出或 console error／warning 均過。首輪 reduce 在媒體 change event 處理前即斷言，改為等待可見狀態更新後，整輪通過，沒有改產品或門檻。兩 context 輸出實際 `Asia/Taipei`，Node `Etc/GMT-8`；四張截圖在 OS TEMP `daypop-dp203-{mobile,desktop}-{light,dark}.png`，手機淺色／桌面深色、原幀淺底與同時間點深底板已目視。CLI 已關閉，本次 Vite PID 42468 經 port／CommandLine 核對後停止。

lint／typecheck、本機 Markdown 連結與 diff 檢查通過。相對 DP-202 的 `src`／`scripts`／`e2e`／預算／套件零差異，本段沒有把前段完整 App 單元或 e2e 當新測次；現已對齊依賴合併的最新 main，十二圖片負控制與還原後正向再次通過；自己的最新四 CI／完成審查仍須通過才合併。

## 接續限制

[已記錄的後續方向](../../../pet-motion-handoff-2026-10-23.md) 只有「貓原地步態」，未要求站立四肢；本批不是完整四肢行走，不代表後續必須換模型。若要站立四肢行走，才需另交保留臉／材質／配色的模型／rig 方案供擁有者作造型決定，並重新量動作與安全區。即使只採原地踏爪，這批也沒有滿足現行總量與品質的候選；不能宣稱七態已完成。

下一段 DP-204 先比較保留坐姿的局部前爪動作與站立替代方案的成本，優先用原生小試作量「頭／身體／尾巴固定，只動前爪」能否減少重繪與編碼 bytes；不先保證會通過，也不把較小動作當作完整行走。站立新模型只列方案，不自動換掉已採造型。App 的 sit 播放時機、walk 互動／位移政策與選角仍是分開的產品決策。

0.4.3／資料 v4／18 migrations／公告／部署不變，沒有 Supabase 或正式資料操作。DP-171／172／041、擁有者品質與真 iPhone／standalone 未結案。
