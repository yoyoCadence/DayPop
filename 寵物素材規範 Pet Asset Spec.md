# App 內浮動寵物小幫手素材規範 — In-App Pet Companion Asset Spec

> **2026-10-25 靜態 PNG 採用（DP-199）：** 六張 App PNG 採 DP-198 RGB128，原 alpha 完全保留、idle PNG 繼續共用，動畫與觸發政策不改。五態各款七實檔 190,980／167,288 bytes，仍每款 192 KiB／PNG 16 KiB。色彩有損、擁有者品質與完整七態仍未完成；詳 [來源、實檔與瀏覽器驗證](docs/pet-static-png-adoption.md)。下方舊體積為各階段歷史。

> **2026-10-25 回饋接線（DP-197）：** 五態現在可由已確認待辦完成觸發 jump，單次 1 秒、解碼後計時；reduce 用 PNG，忙碌／暫藏／背景不補播，沒有 XP／升級或新泡泡。來源、圖片體積及上限沿 DP-196，不代表七態已完成或新動作品質已經擁有者目視驗收。詳 [完成回饋紀錄](docs/pet-completion-feedback.md)，下方四態／無 cue 為歷史。

> **2026-10-25 接入紀錄（DP-196）：** typed registry 已備 idle／look／grab／sleep／jump 五態；jump 新增貓 Q55/A70 與飛碟原 Q85 的完整十幀 1 秒 WebP，靜態共用 idle PNG，各款七實檔 196,286／173,845 bytes。每款仍 192 KiB，新 jump 單檔 32 KiB；App 仍只觸發四態，尚無跳躍 cue、待辦獎勵或 XP。新動作品質未宣稱擁有者已目視驗收，七態尚未完成；完整來源、反向驗證與限制見 [接入紀錄](docs/pet-assets-integration.md)。下方各輪狀態保留為歷史。

> **2026-10-24 現況（DP-192–193）：** 已採 idle／sleep 約 5fps＋look 原 10fps 的混合包，各款六檔為貓 180,850／飛碟 152,373 bytes；每款仍 192 KiB、新 sleep 單檔 64 KiB，舊上限不變。App 月光貓前景閒置 120 秒後 sleep，輸入喚醒、暫藏／背景重新計時、泡泡／look／grab 優先，reduce 使用 PNG。這是依持續開發授權由 agent 採用的政策；sleep 品質仍待擁有者目視驗收，完整七態／選角／XP 未完成。最新見 [播放政策](docs/pet-idle-sleep.md)與 [素材接入](docs/pet-assets-integration.md)；下方試作／歷史狀態不回寫。

> **2026-10-24 sleep 試作（DP-190）：** 兩款固定造型／相機／anchor 的原生閉眼、4.4 秒循環與 88 張透明幀另見 [試作紀錄](docs/pet-concepts/2026-10-24/sleep/README.md)。沿 120／60px 與 8／4px 邊距，舊三態不變；sleep 品質待擁有者目視驗收，未接 App，也未增加既有預算或定睡眠觸發政策。素材段落不代表完整七態完成。

給美術／動畫師的交付規範。角色未來會浮在 DayPop App viewport 上層，可由使用者拖到不擋內容的位置；活動範圍是 App 畫面，不是 Windows／macOS 作業系統桌面。現有 React 介面仍是正常文件流中的 CSS 摘要佔位，浮動層與拖曳會在後續功能實作。

> **2026-10-23 三態接入（DP-188）：** 預設月光貓已在 App 使用 DP-187 的 Q85 WebP＋PNG，軌道噗只登記 registry。idle 循環／關閉泡泡 look 單次／實際拖移或鍵盤移動 grab；泡泡與 reduce 用真正 PNG，暫藏／背景／收起移除圖片，失敗回原 CSS。採用每款 ≤192 KiB、idle ≤128、look ≤48、每張 PNG ≤16；內部 keys 為 `moon_cat`／`orbit_ufo`，未加角色選擇偏好。下方舊四品種、look 循環及尚未接 App 的描述保留為歷史，最新規則與 bytes 見 [接入紀錄](docs/pet-assets-integration.md)。120px／60px／8px 透明邊距不變，七態／XP 仍未完成。

> **2026-10-22 現況補正（DP-170）：** 上段的實作現況已過期；DP-051 已有 60×60 CSS 浮動角色，DP-169 接上對話泡泡，DP-170 加入拖移／24px 靠邊、鍵盤移動及 44px 收起側籤。位置／收起狀態經裝置共用 AppStorage，並避開 FAB、分頁與 safe-area。正式素材與七態仍屬 DP-171；下方尺寸、透明邊距與命名規範不變，詳見 ADR §4。

> **2026-10-23 製作方向（DP-183，擁有者指定）：** 摩卡是粗糙範例，不作為新造型基準。改用官方 Blender 製作精緻卡通 3D＋漫畫描邊，角色固定配色；保留貓咪，其他探索太空船生物等創意非動物。下方四品種與平塗風格是歷史起點，正式清單／keys／線寬仍待概念挑選。先交四款 idle [概念與可編輯來源](docs/pet-concepts/2026-10-23/README.md)，尚未接入 App 或完成七態。120×120／顯示 60×60／透明邊距沿用；每張 32 KiB／七張 224 KiB 的提議未定案，應依試作量測再定，不可當成既定上限。

## 1. 畫布與尺寸

> **2026-10-23 三態試作（DP-187）：** 擁有者已要求本 agent 接回，兩款 idle／look／grab 素材與真實 Blender 來源見 [試作紀錄](docs/pet-concepts/2026-10-23/motion/README.md)。使用 10fps 取樣 idle 44 幀／look 16 幀、grab 靜態；這是候選量測，不把下方建議幀數或本次取樣當正式格式／預算。每角色三態共用相機／比例／錨點，每幀保留 8px 透明（縮 60px 至少 4px），保留靜態替代；未接 App、後四態／正式 keys 待定。

> **2026-10-23 已採用與三態定案（DP-186）：** 擁有者已採用 DP-185 兩款造型，首批只做 idle／look／grab，先素材、另 PR 接 App；格式／圖片預算等量測後再定。其後要求先交接給另一個 agent，三態尚未開始。最新依 [交接](docs/pet-motion-handoff-2026-10-23.md)，下方「待確認」為歷史狀態。

> **2026-10-23 再調整（DP-185，擁有者已採納方向）：** 貓改為小眼／少反光、貼合鼻嘴與短肢自然坐姿；飛碟移除長腿與鞋形腳墊，改成無腿懸浮生物；兩款保留配色／3D 漫畫方向並降低塑膠光澤。最新 idle [前後圖與來源](docs/pet-concepts/2026-10-23/README.md) 已交付，造型仍待再次確認。下方「腳底對齊」不直接適用無腿飛碟；跨動作錨點要在動作規劃另定，目前每款只做單張取景，不宣稱跨姿勢對齊／七態已完成。

> **2026-10-23 選款後（DP-184）：** 擁有者已選月光貓＋軌道噗先細修，造型確認後才擴充動作；[前後圖與原尺寸驗收](docs/pet-concepts/2026-10-23/README.md) 已交付。其他兩款保留探索紀錄，正式名稱／keys、動畫／七態與預算仍未定案；未接入 App。
- **邏輯尺寸**：每個動作幀 **120 × 120 px**（寵物在 App 內預計顯示為 60×60，2× 供高解析度）。
- **對齊**：角色「站立時的腳底」對齊畫布 **底部中央**；左右置中。走動時人物可在畫布內平移，不要超出邊界。
- **安全區**：四周各留 **8 px** 透明邊距，避免角色邊緣被裁切。
- **背景**：**全透明** PNG／WebP（切勿白底）。

## 2. 需要的動作狀態（7 種）
| 狀態 key | 說明 | 建議幀數 | 播放 |
|---|---|---|---|
| `idle` | 待機呼吸／眨眼 | 2–8 | 循環 |
| `walk` | 走動（角色會左右移動，素材本身原地踏步即可） | 4–8 | 循環 |
| `sit`  | 坐下 | 1–4 | 循環或靜止 |
| `sleep`| 睡覺（可含 Zzz） | 2–4 | 循環 |
| `jump` | 跳躍／開心（完成待辦、升級時觸發） | 4–8 | 單次 |
| `look` | 東張西望 | 2–6 | 循環 |
| `grab` | 被抓起（拖曳時） | 1–2 | 靜止 |

## 3. 檔案格式（擇一）
1. **APNG 或 動畫 WebP**（**首選**）：每個狀態一個檔，內含該狀態所有幀與時間軸。
2. **GIF**：可接受，但邊緣透明度較差。
3. **精靈圖 Sprite sheet**：單一 PNG 橫向排列等寬幀 + 一份 JSON（每狀態的幀數、fps）。若採此法請一併提供 JSON 格式範例，我再配合改讀取邏輯。

單張靜態 PNG 也可（無動畫），系統會當作靜止圖顯示。

## 4. 命名慣例
```
pet_<kind>_<state>.<ext>
```
- `<kind>`：貓 `cat`／熊 `bear`／兔 `bunny`／雞 `chick`（見第 6 節，之後新增品種沿用）。
- `<state>`：上表 7 個 key 之一。
- 例：`pet_cat_walk.webp`、`pet_bear_sleep.png`、`pet_bunny_jump.apng`。

## 5. 接入方式（工程）
素材放進專案後，會由 React／TypeScript 的 typed asset registry 依品種與狀態選取；預定結構如下，實際模組會在 DP-040 建立：
```ts
export const PET_ASSETS = {
  cat: {
    idle: '/assets/pets/pet_cat_idle.webp',
    walk: '/assets/pets/pet_cat_walk.webp',
    sit: '/assets/pets/pet_cat_sit.webp',
    sleep: '/assets/pets/pet_cat_sleep.webp',
    jump: '/assets/pets/pet_cat_jump.webp',
    look: '/assets/pets/pet_cat_look.webp',
    grab: '/assets/pets/pet_cat_grab.png',
  },
} as const;
```
- 有素材時由 pet component 顯示對應圖片；缺少狀態時退回 CSS 佔位，可逐一動作漸進替換。
- 多品種一律使用 `PET_ASSETS[kind][state]`，不再接入 generated `support.js` 或舊 prototype constructor。
- 浮動層拖曳位置保存在裝置端，並限制在 viewport safe area 內；素材本身不需處理作業系統視窗邊界。

## 6. 規劃品種
- `cat` 摩卡（尖耳）、`bear` 可可（圓耳）、`bunny` 麻糬（長耳）、`chick` 布丁（鳥喙）。
- 現有 React App 只顯示通用 CSS 佔位；品種選擇與正式素材由 DP-040 接入。
- 之後新增品種沿用同一命名與 7 狀態規範。

## 7. 風格建議
- 對齊 App 的日本漫畫粗線條主題：**粗黑描邊、平塗、少漸層**。
- 線寬在 120px 畫布上約 **4–6 px**。
- 表情鮮明，遠看（60px）仍可辨識。
