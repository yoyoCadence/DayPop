# Blender 創意夥伴概念試作（DP-183）

2026-10-23 擁有者要求使用 Blender 製作精緻角色，明確指出摩卡只是粗糙範例；選擇「精緻卡通 3D＋漫畫描邊」與固定配色。只保留貓咪為必須項，其餘由 Codex 提案，不再預設全部是動物，太空船生物也是可探索方向。圖片體積預算先保留，待試作量測後定案。

本目錄交付四款 **idle 概念**、可編輯來源與實際尺寸檢查，不是正式 App 素材、不代表四款都獲選，也沒有完成七種動作、動畫、rig 或狀態機。舊 `cat / bear / bunny / chick` 是先前規劃；本次新 id 只用於概念檔案，不是新偏好欄位或正式 registry key。

![四款 Blender 概念與原尺寸比較](concept-board.png)

| 概念 | 造型提案 | 768px 透明圖 | Blender 原檔 | 120px PNG | 60px PNG |
| --- | --- | --- | --- | ---: | ---: |
| 月光貓 `moon_cat` | 奶油白、月光紫、月牙額飾、星星項圈與捲尾；重新建模，沒有放大原本 CSS 角色。 | [大圖](renders/moon_cat-768.png) | [可編輯 .blend](source/moon_cat.blend) | 13,784 bytes | 5,033 bytes |
| 軌道噗 `orbit_ufo` | 有生命的飛碟；藍色頭罩、薄荷環、珊瑚外殼、柔軟觸腳與星星感覺器。 | [大圖](renders/orbit_ufo-768.png) | [可編輯 .blend](source/orbit_ufo.blend) | 12,294 bytes | 4,591 bytes |
| 星茶壺 `cloud_teapot` | 雲朵瓷壺、蜂蜜金壺口、彎嘴、把手，蒸氣裡冒出小星星。 | [大圖](renders/cloud_teapot-768.png) | [可編輯 .blend](source/cloud_teapot.blend) | 13,468 bytes | 4,965 bytes |
| 芽芽車 `sprout_rover` | 植物與機器人的混合；螢幕表情、輪腳、珊瑚手套、土壤與帶露珠的幼苗。 | [大圖](renders/sprout_rover-768.png) | [可編輯 .blend](source/sprout_rover.blend) | 13,968 bytes | 5,134 bytes |

120px 四款合計 **53,514 bytes（52.26 KiB）**，單張 12.01–13.64 KiB；60px 合計 **19,723 bytes（19.26 KiB）**。這只是四個靜態 idle 的實測值，不能外推動畫、七態總包、下載成本或真機解碼時間。原先每張 32 KiB／七張 224 KiB 都尚未定案，沒有加入 `performance-budget.json`。

## 可重跑來源

實際使用 [Blender 官方 5.2.3 Windows portable](https://download.blender.org/release/Blender5.2/)；依同目錄官方 `blender-5.2.3.sha256` 核對 zip：

```text
723f08a4401502561eb763cdeacf8745b31e5f3f154d287d3830d97cf75dc2fb
```

工具解壓於本機系統暫存目錄，不提交 Blender 執行檔、不改系統設定。原檔由本目錄的 `create_concepts.py` 使用可編輯 meshes、curves、命名材質與三盞柔光建成，沒有外部模型、貼圖或生成圖片。概念板只把實際 Blender 渲染排版，沒有另外重畫或修飾角色。

在 repo 根目錄執行（PowerShell，路徑改成自己安裝的 Blender）：

```powershell
$petBlender = 'C:\path\to\blender.exe'
& $petBlender --background --factory-startup --python-exit-code 1 --python docs/pet-concepts/2026-10-23/create_concepts.py
& $petBlender --background --factory-startup --disable-autoexec --python-exit-code 1 --python docs/pet-concepts/2026-10-23/check_sources.py
py docs/pet-concepts/2026-10-23/check_assets.py
py docs/pet-concepts/2026-10-23/test_asset_checks.py
py docs/pet-concepts/2026-10-23/make_board.py
```

`check_assets.py` 只需 Python standard library；`test_asset_checks.py`、`make_board.py` 需要 Pillow，本機 Python 3.12.3 已有。概念板使用本機 Windows `msjh.ttc`，字體檔不隨 repo 散布，其他作業系統需自行指定支援中文的字體。這些是離線概念工具，不是 App 相依或 npm build 的一部分；本 PR 沒有新增 CI 執行它們的步驟。檔案 SHA-256、尺寸、非透明範圍與 bytes 見 `manifest.json`。Blender 可能因 GPU／版本／取樣產生少量像素差異；重建會重新量測與更新雜湊，不能承諾逐 byte 可再現。

四份壓縮 `.blend` 均已由官方 Blender 重開：分別 44／39／41／33 個 objects，可編輯 meshes／curves／材質，沒有外部貼圖。相機為正交、背景透明，輸出路徑相對於 source 指向 `../renders/`。相機先依實際 alpha 輪廓取景，避免只看保守幾何 bounds 造成角色過小；曲線端點封閉，描邊殼不投影，避免首輪自陰影雜訊。

## 驗收與限制

- 先寫 acceptance checker，缺少產物時失敗。第一輪也抓出取景過小，沒有降低非透明面積門檻。
- 最終八張 120／60px PNG 皆為 8-bit RGBA、四周至少 8／4px 全透明，不是白底；不是空圖，保留材質色階。每款各自取景，**跨動作腳底 registration 尚未定案**，不得直接當成完整七態。
- 六項負控制通過：空圖、白底、幾乎透明但被裁切的邊緣、失去材質的剪影、錯誤尺寸均被拒絕；暫時移除真正交付的貓咪 120px 檔會失敗，finally 逐 byte 還原後完整 checker 再通過。
- 十二組背景的 60px 圖已實際查看；主要輪廓與表情可辨識，星星、腳趾等細節在 60px 會簡化，後續選定造型還需調整。`theme-backgrounds.json` 是本次從 `src/theme/themes.ts` 取出的 bg／fg 快照，不是另一份產品色盤。
- [背景檢查圖](theme-check.png) 是靜態素材辨識檢查，沒有把新角色放進 App；不能當成 axe、整體 UI 或 iOS 真機驗收。描邊寬度、動畫、所有姿勢的一致腳底與 reduced-motion 靜態替代，留到造型選定後處理。

專案驗證：lint、typecheck、87 檔 1,365 單元＋17 Node、build／check:build 全過；相關 Chromium 手機／桌面夥伴操作與 WebKit smoke 共 9 passed。本機 Vitest 最初 sandbox 啟動時 `spawn EPERM`、未執行案例，同指令在可啟動子程序的環境通過（`--maxWorkers=2 --testTimeout=30000`，CI 不改）。build／e2e 的 Node 子環境明確設空 Supabase URL／publishable key；Node 印出 Etc/GMT-8，browser 印出 Asia/Taipei。JS 742,203 raw／218,446 gzip、CSS 112,159 raw／27,225 gzip bytes，沿原有預算；概念圖未進 dist。測試伺服器 PID／命令列已核對並清理。最新 PR 四項 CI 全過後才依既有授權合併，CI 結果見 PR。

![60px 素材在十二組背景](theme-check.png)

下一段建議先細修「月光貓＋軌道噗」，待擁有者實際選定後再規劃七態。正式角色清單、名稱／keys、狀態觸發、動畫格式、圖片預算及快取／預載仍待定案；DP-171、DP-172、DP-041 均未結案。App 0.4.3、資料 v4、18 migrations、公告及部署不變，沒有 Supabase MCP 或正式使用者資料操作。
