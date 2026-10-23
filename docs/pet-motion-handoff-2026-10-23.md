# Blender 夥伴三態素材交接（2026-10-23，DP-186）

## 接手先看

擁有者因 token 額度要求「先寫交接檔案，給另一個 agent 做」，並要求上 GitHub。**本交接只記錄定案與現況，三態製作尚未開始。** 下一項是 **DP-187：月光貓＋軌道噗 idle／look／grab 素材試作**，不是 App 接入、完整七態或選擇夥伴偏好。

先讀 `AGENTS.md`（含 Mode A／B、canonical 增量原則、scope、分支與任務生命週期）、本檔及 [概念 README](pet-concepts/2026-10-23/README.md)。擁有者已同意以下具體方向，可依此進入 Mode B，不必重新詢問已定案項目。若再改造型或新增產品行為，才先 Mode A。

## Git／PR 現況

- [PR #178](https://github.com/yoyoCadence/DayPop/pull/178)：四款原始 Blender 概念，已合併 `f51dd605bafd502fbf8ec2c8a5a5d589ea70b9e7`。
- [PR #179](https://github.com/yoyoCadence/DayPop/pull/179)：先細修月光貓＋軌道噗，已合併 `0cd76deeb96a28fac3e0206364bcd03ec78fec4c`。此版後來被擁有者認為有詭異感，**不是正式採用造型**。
- [PR #180](https://github.com/yoyoCadence/DayPop/pull/180)：柔化五官／貓坐姿、移除飛碟腿，**已合併**。來源 head `70f66e3b76ae9c5fe1731c884a1acd46b2fa8e24`，main squash **`2708f4cfc1d353aff88919735b805e559037a0c6`**，2026-10-23 14:54（UTC+8）合併。
- #180 的 [CI run 39912012297](https://github.com/yoyoCadence/DayPop/actions/runs/39912012297) 四項一次全過：品質 1m53s、database 2m17s、Chromium 21m17s（**259 passed／13 skipped**）、WebKit 56s（**5 passed**）。自行審查完成，無外部 review，不把 CI 當外部審核。
- 本交接分支為 `docs/dp-186-pet-motion-handoff`，從上述最新 main 建立，只加交接／定案文件。接手先確認此文件 PR 的最新 CI／合併狀態，完成文件 PR 後，再切 main、fetch、fast-forward，從 main 開 DP-187 新分支。不要直接在本交接分支做動畫。
- 擁有者持續授權每段一個中文 PR、檢查與最新 CI 通過且審查完成後自主合併，再做下一段；本輪要求交接，因此本 agent 推送交接 PR 後停止。**部署／migration 套用仍是擁有者工作，合併不等於部署授權。**

## 已確認的造型與範圍

擁有者要求官方 Blender、精緻卡通 3D＋漫畫描邊與固定配色；摩卡只是粗糙範例，不沿用其造型。只要求保留貓，其他可探索非動物（例如太空船生物）。四款探索中選擇先細修月光貓、軌道噗；茶壺／芽芽車暫留原探索紀錄，不繼續擴做。

DP-185 後擁有者明確回覆 **「採用這版，接著規劃動作」**：

- **月光貓**：奶油白／月光紫，小眼、每眼一個小亮點，鼻嘴與腮紅貼合頭部曲面，短前爪接地、自然坐姿，保留月牙／星星項圈／捲尾。
- **軌道噗**：藍頭罩／薄荷環／珊瑚外殼，**無腿、無鞋形腳墊**的懸浮生物，柔和小眼與微笑、星星天線。
- 兩款霧面材質減少塑膠高光，固定配色；不要恢復亮黑大眼、凸鼻嘴、飛碟人形腿／鞋子，也不要再按六套主題改角色顏色。

[最新前後圖](pet-concepts/2026-10-23/friendly-refinement.png)、[十二背景 60px 檢查](pet-concepts/2026-10-23/theme-check.png) 都是真實 Blender 渲染。原檔／PNG 仍是單張 idle，**沒有 rig、動畫、七態或 App 接入**。#180 文件中的「造型待確認」是當時交付狀態，本交接補記其後擁有者已採用，不是要求重新選款。

## 已確認的首批動作計畫

擁有者明確採納 **「首批先做三態」**，且採用先素材、另 PR 接入 App 的順序：

| 狀態 | 月光貓 | 軌道噗 | 節奏／交付 |
| --- | --- | --- | --- |
| `idle` | 坐姿呼吸、眨眼、尾尖微動 | 小幅懸浮、眨眼、天線微動 | 4.4 秒節奏，沿既有 CSS 眨眼週期；循環 |
| `look` | 輕轉頭、耳朵回應 | 頭罩與環帶輕轉 | 約 1.6 秒，單次後回待機 |
| `grab` | 前爪微收、保持放鬆表情 | 環帶微傾、天線後仰 | 先交靜態姿態 |

- 先交 **可編輯 Blender 動畫來源、透明 PNG 幀序列、靜態替代圖與預覽**。可做候選動畫包來量測，但量測前不要把格式或圖片預算寫成已定案。
- 固定每個角色各 clip 的相機、比例與錨點，不能每幀自動取景。貓有坐姿接地參考；無腿飛碟需以穩定的身體／懸浮參考錨點處理，不能硬套「腳底」規則。逐幀檢查透明安全區、裁切、接縫、循環接點與 60px 可辨識性。
- 120×120 素材顯示 60×60；每幀四周至少 8px 透明（60px 至少 4px）。當前已選兩款可見長邊約 50px，不可為追求大幅動作而裁切／拉伸；先縮小動作幅度。
- 準備靜態替代圖，未來 `prefers-reduced-motion: reduce` 顯示靜態；手動拖移沿 DP-170 的直接位置更新。收起、表單暫藏、分頁離開／背景時的動畫生命週期要在後續 App 接入處理，不能只停 CSS 而讓圖片仍播。
- 本批不自動走動／巡遊，不修改使用者保存的位置，不綁完成待辦或 XP，不加新偏好，不直接接 App。FPS／幀數、實際包格式／budget、播放 runtime、正式角色 keys／名稱仍未定案；不要把本檔當成這些項目已獲批准。

後四態只保留方向：`walk`＝貓原地步態／飛碟傾斜滑行；`sit`＝更放鬆坐姿／降低懸浮、環帶放平；`sleep`＝蜷睡閉眼／閉眼與天線垂下；`jump`＝短促彈起／短促上浮。**本批不得一起製作或宣稱完成七態。** DP-171／172／041 父項都未結案。

## 現有製作工具與檔案

所有概念放在 `docs/pet-concepts/2026-10-23/`，不在 public／src，不會進 dist：

- `create_concepts.py`：DP-183 四款原始建模、命名材質／燈光／透明輸出。
- `refine_selected.py`：DP-184 頭耳融合、尾巴／環帶及取景，只更新已選兩款。
- **`friendly_selected.py`：最新 DP-185 builder**，增量重用前兩階段。要重建已採用造型應跑這支；只跑前兩支會回到未採用版本。
- `source/moon_cat.blend`、`source/orbit_ufo.blend`：最新可編輯、未 rig 的來源；36／30 objects，沒有外部貼圖。另兩款 41／33 objects 不動。
- `renders/<id>-768.png`、`-120.png`、`-60.png`：當前靜態透明 PNG。
- `manifest.json`：hash、bytes、bounds 與 `productionReady:false`；`appearanceApprovalPending:true` 是交付當下記錄，後續規劃／新動畫 manifest 應記錄本檔的已採用決策，不能直接宣稱 production ready。
- `make_board.py`、`make_friendly_board.py`：最新比較／背景板；`make_selected_board.py` 保留 DP-183→184 的歷史圖，不能把新渲染套進舊說明。
- `check_assets.py`、`test_asset_checks.py`、`test_selected_sprites.py`、`test_friendly_sources.py`、`check_sources.py`：現有驗收與反向控制，詳見 README。

官方 Blender portable 已核對 zip SHA-256，路徑：

```text
C:\Users\memor\AppData\Local\Temp\daypop-blender-5.2.3\blender-5.2.3-windows-x64\blender.exe
```

實際 Blender 5.2.3 LTS，build hash `e13b728c6880`。來源 [官方 Blender5.2](https://download.blender.org/release/Blender5.2/)，zip SHA-256：`723f08a4401502561eb763cdeacf8745b31e5f3f154d287d3830d97cf75dc2fb`。這是暫存目錄的官方 portable，不是系統 MSI／Start Menu 安裝；被清理後需重新取得官方版。已獲安裝授權，不需再詢問。`py` 可用（Python 3.12.3，含 Pillow），`python` 可能只是 Windows stub。Blender 內建 Python 沒有 Pillow；Pillow 只組版／編碼真實渲染，不替代 Blender 建模。

重建／驗證參考（PowerShell repo 根目錄，**逐條執行**）：

```powershell
$petBlender = 'C:\Users\memor\AppData\Local\Temp\daypop-blender-5.2.3\blender-5.2.3-windows-x64\blender.exe'
& $petBlender --background --factory-startup --python-exit-code 1 --python docs/pet-concepts/2026-10-23/friendly_selected.py
& $petBlender --background --factory-startup --disable-autoexec --python-exit-code 1 --python docs/pet-concepts/2026-10-23/test_friendly_sources.py -- --reverse-control
& $petBlender --background --factory-startup --disable-autoexec --python-exit-code 1 --python docs/pet-concepts/2026-10-23/check_sources.py
py docs/pet-concepts/2026-10-23/test_asset_checks.py
py docs/pet-concepts/2026-10-23/test_selected_sprites.py --reverse-control
py docs/pet-concepts/2026-10-23/check_assets.py
py docs/pet-concepts/2026-10-23/make_board.py
py docs/pet-concepts/2026-10-23/make_selected_board.py
py docs/pet-concepts/2026-10-23/make_friendly_board.py
```

反向工具會暫換真實 PNG／`.blend` 並 finally 精確恢復，**不可彼此平行，或與繪板／hash 驗證同時跑**。比較／負控制需本機 Git 含 `f51dd60`／`0cd76de`。Blender／GPU 取樣不保證逐 byte 再現；沒有需要時不要無故重建已採用的 idle。新動畫最好用獨立輸出目錄、保留已採用靜態來源，避免覆蓋後讓未製作的狀態看似已完成。

## 驗證證據與接手檢查

**DP-186 本交接文件自身**也重新跑過 lint／typecheck、1,365 Vitest＋17 Node、build／check:build，以及相關 Chromium／WebKit 9 passed；17 個本機 Markdown 連結已核對。build／e2e 明確空 Supabase 子環境，Node Etc/GMT-8／browser Asia/Taipei 有實際輸出；本輪 server PID 43844 已核對命令列並停止。這是純文件交接，沒有可先撤除的產品修正，未新增掃文件字串的假回歸；三態的先失敗／反向驗收由 DP-187 實作。本交接 PR 最新 CI 與合併由接手 agent 完成，**不能拿 #180 的 CI 當成本交接 head 的 CI**。

DP-185 本機已跑：lint、typecheck、87 檔 1,365 Vitest＋17 Node、build、check:build、夥伴定位與 WebKit e2e 9 passed。Vitest 使用 `--maxWorkers=2 --testTimeout=30000`；CI 門檻未改。新四組 `.blend` 幾何／材質回歸在舊來源先失敗，完成後暫換舊來源再失敗、精確恢復後通過；既有六項壞圖／檔案移除負控制和四組占比反向驗收通過。

最新靜態尺寸：兩款 120px 合計 **25,812 bytes**（貓 14,669、飛碟 11,143）；60px 合計 **9,719 bytes**（5,525／4,194）。四款 120px 共 53,248、60px 共 19,818 bytes。這些不是動畫包預算；原提案每張 32 KiB／七張 224 KiB 未採用。JS 742,203 raw／218,446 gzip、CSS 112,159 raw／27,225 gzip bytes，概念檔未進 dist。

下一段先寫會失敗的 **動畫專用**驗收，再製作；完成後還原修正驗證真的失敗。要涵蓋實際 PNG 幀／時序、所有幀安全區、固定相機／比例／錨點、循環接點、靜態替代與解碼；不要只掃描生成器字串或把美感當成數字測試。大圖、60px 與十二背景仍要實際看，保留真實 Blender 預覽與 bytes／frame count／duration 量測，不能宣稱 iOS 真機已驗。

每段沿用 lint／typecheck／test／build／check:build 與相關 e2e，CI 四項過後才合併。本機 build／e2e 必須明確空 Supabase URL／publishable key，避免 `.env.local`；PowerShell 的空環境變數可能被刪除，請用 Node 子程序明確覆寫 `env`：

```powershell
node --input-type=module -e "import {spawnSync} from 'node:child_process'; import {dirname,join} from 'node:path'; const env={...process.env,VITE_SUPABASE_URL:'',VITE_SUPABASE_PUBLISHABLE_KEY:''}; console.log('timezone:',Intl.DateTimeFormat().resolvedOptions().timeZone); console.log('Supabase env lengths:',env.VITE_SUPABASE_URL.length,env.VITE_SUPABASE_PUBLISHABLE_KEY.length); const r=spawnSync(process.execPath,[join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),'run','build'],{env,stdio:'inherit'}); process.exit(r.status??1);"
```

同樣的 wrapper 可改跑 `test:e2e -- e2e/pet-placement.spec.ts e2e/webkit-smoke.spec.ts`。需要 dev server 時用隱藏 `Start-Process`、先核對埠再跑，結束依實際 OwningProcess／CommandLine 核對清理。上一段 DP-185 server PID 30220 已停止、4173 無本 agent 監聽；不要殺使用者自己的 5173。`%TEMP%/daypop-dp185-vite.mjs` 是先明確設空 Supabase 再啟動 Vite 的 helper，可讀後重用；不提交這個本機 helper。

Windows 含中文檔用 apply_patch／Node UTF-8 編輯，不用 PowerShell 讀取—取代—寫回。跨時區用 PowerShell 設 `$env:TZ`，印實際 `Intl.DateTimeFormat().resolvedOptions().timeZone`；不要從 Git Bash 傳含 `/` 的 TZ 給原生 Windows 程式。`gh` 本輪 elevated network 正常，不要探查／輸出 token；依擁有者指定 `gh pr create --base main`，建立後核對 baseRefName。

## 保持的產品邊界

App 還是原 CSS 夥伴，只有日曆分頁有角色；DP-170 拖移／鍵盤／收起／safe-area 與裝置保存已完成。三態素材不應改這些行為。`toggleTodo()` 對 UI 仍回傳 void，獎勵必須等保存確認的前置尚未完成，不能用動畫順便接上 XP 或勾選跳躍。

App **0.4.3**、資料 schema **v4**、**18 migrations** 不變。不用 Supabase MCP、不查改正式使用者資料、不部署、不自行改版號／公告。選擇角色的新偏好屬 DP-172，需另外 schema／write barrier／migration，不能用臨時 localStorage 繞過。

格式與快取尚未定案：WebP 可作候選透明動畫包（[官方特性](https://developers.google.com/speed/webp/docs/compression)），但仍需以兩款實測比較。減少動態效果的圖片靜態替代可參考 [Google 指南](https://web.dev/articles/prefers-reduced-motion)。現行 worker 只對 `/assets/`／`/icons/` 執行期 cache-first，app shell 沒有整包寵物；不要因候選圖出現就自行預快取整包或宣稱完整離線。App 接入／正式 keys／fallback／候選包選擇／預算與快取要另段交付。
