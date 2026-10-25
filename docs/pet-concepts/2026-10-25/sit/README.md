# 放鬆坐姿與 walk 可行性（DP-202）

2026-10-25。依持續開發授權，從 DP-171 的剩餘兩態拆出靜態 `sit` 小段；沿 [已採用造型與後續方向](../../../pet-motion-handoff-2026-10-23.md) 的原生 Blender controls，不把新增姿勢當作擁有者已驗收。此段沒有 App 接入、播放政策或自動走動。五態包由獨立 [DP-201](../../../pet-loop-encoding-adoption.md) 採用。本段發布前，PR #196 head `5b5c123` 的 run `40192734289` 四 CI／完成審查無發現、無未解決討論後合併 `0a0f3de`（Chromium 285 passed／13 skipped、18.5 分鐘；WebKit 8 passed），已對齊此最新 main。`sourceCommit` 記公開基底、`preparationCommit` 保留本機準備提交 `250ee98`，輸入 SHA 重新核對，PNG／Blender／編碼 bytes 不變；只送本段素材與交接，自己的最新四 CI／完成審查過才合併。

[互動比較](preview.html) 同時顯示原 idle、原生 sit 與 RGB128，各為真正 120px／60px，可切換淺深底。[淺底板](comparison-light.png)／[深底板](comparison-dark.png) 使用同一批真實 PNG，沒有放大冒充 60px。

月光貓保留已確認的短肢自然坐姿，身體放鬆、前爪略收、頭略垂及眼瞼降低；軌道噗保持無腿懸浮，稍降高度與天線，環帶水平。首輪在 60px 差異過小，因此小幅加深控制值後重新渲染。這是有意克制的靜態狀態，不是閉眼 sleep，也不是凍結原 idle 幀；輪廓變化仍可能需要擁有者修整。

| 角色 | 原生 PNG | RGB128 PNG | 五態固定基線 | 假設加入 RGB128 sit | 192 KiB 剩餘 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 月光貓 | 13,302 | 11,540 | 174,308 | 185,848 | 10,760 |
| 軌道噗 | 10,337 | 8,175 | 152,194 | 160,369 | 36,239 |

RGB128 只將 RGB 做 MEDIANCUT 128 色、無抖色，重新裝回原 alpha；輸出仍是 RGBA PNG。兩候選每檔都 ≤16 KiB、相加都 ≤192 KiB，原生 120px／真正 Lanczos 60px alpha 最大差皆 0，實際非零 alpha 保持四周至少 8／4px，淺深底 normalized 全畫面 RGB MAE <0.008。閘門與既有標準相同；RGB128 有損，不宣稱感知無差。`manifest.json` 保留精確 MAE、實際 bytes／SHA、相機／anchor 與 provenance，`productionReady`／`appIntegrated`／`sitPoseApproved` 皆 false。

## 可編輯來源與重跑

官方 Blender 5.2.3 LTS（`e13b728c6880`，2026-10-22 build），沿發布的 [DP-187 原檔](../../2026-10-23/motion/README.md)，不改 mesh／材質／base transforms／parent hierarchy／相機。輸出在 [source](source/) 與 [frames](frames/)；每款只有 frame 1、`sit static` marker，移除全部 object／shape-key 動畫，沒有外部貼圖。

```powershell
$blender='C:/Users/memor/AppData/Local/Temp/daypop-blender-5.2.3/blender-5.2.3-windows-x64/blender.exe'
& $blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python docs/pet-concepts/2026-10-25/sit/create_sit.py
py -3 -X utf8 docs/pet-concepts/2026-10-25/sit/pack_sit.py
py -3 -X utf8 docs/pet-concepts/2026-10-25/sit/check_sit.py
py -3 -X utf8 docs/pet-concepts/2026-10-25/sit/test_controls.py
& $blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python docs/pet-concepts/2026-10-25/sit/test_source_controls.py
& $blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python docs/pet-concepts/2026-10-25/sit/check_sources.py
```

Python 3.12.3、Pillow 12.2.0。先 native render 再 pack，不能在負控制期間同時產圖。生成器只寫本目錄，不覆寫歷史幀或 App；Blender 安裝路徑按實際環境調整。原檔重渲染在 OS TEMP 短暫輸出並自動清除，沙盒首次拒絕寫入後以相同命令升權通過；兩份實際 .blend 重開後，重渲染 RGBA pixels 與交付 PNG 完全一致。

九項實檔／metadata 負控制：缺 inventory、舊 idle 偽裝 sit（同步刷新 hash）、邊界 alpha=1、內部 alpha 改 1、錯誤尺寸、來源 SHA、偽 palette、實檔超過 16 KiB、偽六態總量；全部拒絕，finally 十一檔逐 byte 還原後正向通過。六項 native 負控制：相機、材質、base anchor、放鬆頭部、眼瞼及隱藏動畫，全部拒絕；finally 兩份 .blend 精確還原、原檔語意檢查再過。模型／材質 hash 來自發布的 DP-194 helper，比對的原始 .blend 自身 SHA 另行固定。

Browser plugin not available，使用官方 Playwright CLI。390×844／1280×900 的淺深底各過：12 張原生 120px 圖片以 120／60px 顯示、sit 與原 idle pixels 不同、瀏覽器 canvas 的原生 sit／RGB128 alpha 差 0；Enter 切色／aria-pressed、reduce 靜態 PNG、交接連結、無水平溢出與 console error／warning。兩 context 都輸出實際 `Asia/Taipei`。四張截圖在 OS TEMP `daypop-dp202-{mobile,desktop}-{light,dark}.png`，手機淺色／桌面深色與兩張對照板已目視；CLI 已關閉，本次 server PID 28196 經 port／CommandLine 核對後停止。

lint／typecheck、五份交接文件的 163 個本機連結與 diff 檢查通過。相對已驗 DP-201，`src`／`scripts`／`e2e`／預算／套件零差異，因此沒有把前段的完整單元與 App e2e 當作新測次；本段自己的最新四 CI／完成審查仍須通過才合併。

## walk 尚未實作的原因與接續範圍

已採用的貓不是站立四肢模型：後側坐姿體積已融合進 body mesh，DP-187 現有 paw controls 只控制兩隻前爪。原地輪流抬前爪可以製作「踏爪」，不能當作完整行走驗收；直接把融合身體拉成站姿也會改變已確認的短肢自然坐姿與輪廓。軌道噗可沿現有 root 做傾斜滑行，沒有這個後肢問題。

下一小段先做 **DP-203 walk 原生可行性試作**：保留發布原檔，另目錄比較貓現有 controls 能支持的原地步伐與限制、軌道噗傾斜滑行；交可編輯來源、實幀與明確命名的候選，不能以「踏爪」宣稱完整四肢步態，也不自動接入 App。若需要站立四肢或新 rig，先交具體模型方案再取得擁有者造型決定。兩款的相機／base anchor、8／4px 邊距與既有 192 KiB 都保留；目前貓只餘 10,760 bytes，必須用實際候選量測，不先保證第七態可容納。

App 何時播放 sit／walk、是否有自動位移、互動優先序屬另一段產品契約，本段沒有決定。仍 App 0.4.3／資料 v4／18 migrations，沒有公告、部署或遠端操作；DP-171／172／041、擁有者品質與真機驗收未結案。
