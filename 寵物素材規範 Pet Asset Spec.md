# App 內浮動寵物小幫手素材規範 — In-App Pet Companion Asset Spec

給美術／動畫師的交付規範。角色未來會浮在 DayPop App viewport 上層，可由使用者拖到不擋內容的位置；活動範圍是 App 畫面，不是 Windows／macOS 作業系統桌面。現有 React 介面仍是正常文件流中的 CSS 摘要佔位，浮動層與拖曳會在後續功能實作。

## 1. 畫布與尺寸
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
