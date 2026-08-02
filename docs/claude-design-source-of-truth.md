# DayPop Claude Design 設計基準

本文件定義 DayPop 從 Claude Design 原型搬移到 React 時的設計依據。原始設計不是單張首頁截圖；必須把下列三份原檔合併閱讀，並實際渲染 `.dc.html` 核對各頁與互動狀態。

## Canonical source set

| 優先 | 原檔 | 角色 |
| --- | --- | --- |
| 1 | `日曆桌寵 Calendar Pet.dc.html` | 所有畫面、資訊層級、版面、六套主題、元件狀態、文案密度與互動流程的主要設計來源。 |
| 2 | generated `support.js` | 讓 `.dc.html` 正確解析、掛載與執行的唯讀 runtime 參考；不得手改，也不作為正式 React production dependency。 |
| 3 | `寵物素材規範 Pet Asset Spec.md` | 補足 App 內浮動寵物的品種、狀態、尺寸、拖曳與未來素材接入規則。 |

使用者明確提出的新決策高於原檔；若三份原檔彼此沒有答案，先詢問再改變產品設計。單張截圖只能證明某一頁、某一主題與某一資料狀態，不能取代原檔。現有 `src/App.tsx` 是工程骨架，不具有設計決策權。

## 已核對的完整畫面範圍

### 主導覽

- 日曆：月、週、列表三種檢視；今天、前後日期、搜尋、快速新增與兩個新增入口。
- 搜尋：關鍵字欄位、全部／各日曆篩選、搜尋提示、結果與空狀態。
- 綜覽：行程／待辦／貼圖切換，年／月／週時間範圍、前後期、今天、筆數與展開內容。
- 設定：六套外觀主題與淺／深色、AI 區塊、日曆管理、寵物、一般偏好、通知、資料匯入匯出與開發／示範資料控制。

### Sheet、dialog 與浮動層

- 日詳情 sheet：當日事件、待辦、貼圖與新增入口。
- 新增／編輯事件 sheet：日曆、全天、日期時間、重複、提醒、地點、時區、邀請對象、附件與刪除。
- 重複事件作用範圍、日曆編輯、匯入預覽、確認、寵物等級等 dialog。
- 底部導覽、FAB、App 內浮動寵物、寵物對話泡泡與提醒 toast。

以上都是搬移範圍；尚未實作不代表可以刪除、合併成另一種頁面或自行換成新的 dashboard。

## 視覺與互動不變條件

- 新使用者預設採用「漫畫」淺色主題：黑色粗描邊、白底、紅橘強調色、網點與高對比；這也是第一個視覺還原與驗收目標。原檔另含極簡、暖陽、商務、鮮活、像素主題，六套都保留在產品架構中。
- 2026-08-02 已由產品擁有者定案預設為「漫畫」。原稿 `data-props` 原先是像素、seed 是漫畫；本次已將 `data-props.defaultTheme` 校正為漫畫，使全新預覽與重設資料採用相同預設。既有使用者已保存的主題偏好仍優先，不得在更新或 migration 時被預設值覆寫。
- 頂部日期／標題、月週列表 segmented control、快速新增列、月格／時間格、底部四分頁、FAB 與寵物的相對層級必須保留。
- 新增／編輯流程維持從底部升起的 sheet；遮罩、圓角、拖曳提示、固定標題列與可捲動表單不可改成獨立卡片首頁。
- 版面與控制項可以拆成可維護的 React 元件，但不得以「重構」名義改變資訊架構、文案密度、主題性格或核心互動。
- 後端尚未完成的同步、附件、通知、天氣或 AI 功能可停用並清楚標示，但其位置與使用意圖要保留；不可用假的成功狀態代替。

## 手機 App 與桌面預覽外框

- 安裝到手機或以手機瀏覽器開啟時，只渲染 App 內容，使用真實 safe area；不得再畫一層假手機邊框、假動態島或假狀態列。
- 桌面瀏覽器可保留原型的 404 × 824 手機展示框，讓產品維持原設計的展示效果；展示框是 responsive preview chrome，不屬於 App 內容。
- 桌面視窗縮窄到手機寬度時應自動移除展示框，避免重複邊框或壓縮可用內容。

## 寵物基準

- 寵物是 App viewport 內的小幫手，不是 Windows／macOS 桌面程式。
- 原型中的浮動位置、拖曳、對話泡泡、提醒與完成回饋是行為基準；四個品種為摩卡／可可／麻糬／布丁。
- 未來素材依 `Pet Asset Spec` 的 120 × 120、顯示 60 × 60、透明背景與 `idle`／`walk`／`sit`／`sleep`／`jump`／`look`／`grab` 七種狀態接入。
- 正式素材未完成前可使用忠於原型比例與輪廓的 CSS 角色；不可用無關的通用 emoji 或大面積摘要卡取代浮動寵物。

## React 搬移與驗收方式

1. 先抽出主題 token、App viewport／desktop preview shell 與共用控制項。
2. 依日曆 shell → 月／週／列表 → 日詳情／事件 sheet → 搜尋／綜覽／設定 → 其他 dialog 的順序搬移。
3. 每一段同時以原始 `.dc.html` 和 React App 在 390px 手機 viewport 比對；桌面另驗證展示框與無水平溢出。
4. 比對至少涵蓋空資料、示範資料、sheet／dialog 開啟、漫畫淺色與一套深色主題。
5. 只有在相同資料與狀態下，版面層級、控制位置、色彩、字級、間距、邊框與主要互動均一致，才可把該段標記完成。

原始 `.dc.html` 在搬移完成且具備視覺回歸證據前不得刪除；`support.js` 保持 generated、唯讀，正式產品程式不得新增對它的依賴。

## 2026-08-02 handoff 狀態

- 已完成：三份原檔盤點、主要頁面實際渲染、完整畫面範圍與視覺不變條件建檔；原始 `.dc.html` 的新使用者預設主題已由像素校正為漫畫。
- 尚未完成：現有 React App 尚未還原 Claude Design；`src/App.tsx` 與目前紫色卡片版面只能視為功能／架構骨架，不可作為後續 UI 基準。
- 下一步：DP-050 已完成六套 theme tokens 與 canonical App shell（見下一節），接著執行 DP-051 搬移核心日曆。每一段都必須以原始 `.dc.html` 的相同頁面、資料與狀態作比對。
- 必須保留：既有登入、repository、Supabase、PWA 更新與資料安全能力，但應嵌入原稿資訊架構，不可另做一個外觀不同的首頁；其他五套主題不可因漫畫是預設而刪除。
- 不可修改：generated `support.js`；它只用於渲染原始設計，正式 React App 不應依賴它。

## DP-050 交接狀態：App shell 與主題基礎

### 已建立

- `src/theme/themes.ts` 是原檔 `THEMES` getter 的逐值鏡像：六套主題各自的淺／深色 palette、`bd`／`radius`／`radiusLg`、標題字距與大小寫、`head`／`body` 字體堆疊、寵物填色與描邊。`themeCssVariables()` 依原檔 `phoneStyle()` 的相同名稱與順序輸出 25 個 CSS custom property，讓後續搬移的 markup 可以直接沿用 `var(--accent)` 等寫法。修改這個檔案等同修改設計，必須先回原檔核對。
- `src/theme/ThemeProvider.tsx` 只保存在記憶體：DP-050 不改資料模型，也不寫入任何偏好。DP-018 接手時要把 `useState` 的初始值換成已保存的偏好，並保證既有值優先於預設。
- `src/shell/AppShell.tsx` 與 `src/shell/shell.css` 是 App viewport、safe area、頂部狀態區、底部四分頁與桌面手機展示框；`overlay` 與 `dialogs` 兩個 slot 分別給 FAB／浮動寵物（z-index 40–44）與 sheet／dialog（z-index 90）。
- `src/screens/` 目前有三種畫面：`CalendarScaffoldScreen`（DP-010 工程骨架，DP-051 整支替換）、`PendingScreen`（搜尋／綜覽的明確未搬移狀態）、`SettingsScaffoldScreen`（原檔外觀主題區塊 ＋ 保留中的帳號與版本能力）。

### 展示框切換規則

展示框只在 `@media (display-mode: browser) and (min-width: 900px) and (hover: hover) and (pointer: fine)` 出現：安裝後的 PWA、手機與平板都不會拿到假外框，桌面視窗縮到手機寬度也會自動移除。視窗高度不足時是整頁捲動，不是縮小手機，維持原稿預覽的行為。假瀏海與假狀態列屬於展示框，一律 `aria-hidden`，手機上改由真實 `env(safe-area-inset-*)` 負責。

### 已驗證

以 Playwright／Chromium 實際渲染比對原始 `.dc.html`：桌面展示框量得 404 × 824、內層 viewport 384 × 804、狀態列與底部四分頁位置一致，1280px 無水平溢出；390px 手機不渲染外框、瀏海、狀態列與展示框說明文字，tab bar 為 64px，`--accent` 為 `#e4002b`；桌面縮到 420px 展示框自動消失；漫畫淺色、漫畫深色與像素深色（含 scanline 材質）皆正確；console 0 error／warning。

### 已知落差（不在 DP-050 範圍）

- **字體**：原檔用 Google Fonts 載入 Bangers、DotGothic16、IBM Plex Sans、Newsreader、Noto Sans TC、Noto Serif TC、Space Grotesk、Pixelify Sans。DP-015 要移除非必要遠端字型依賴並建立 CSP 相容 build，因此這裡只保留正確的 font stack，沒有加入執行期遠端字型連結。在字體自託管完成前，漫畫主題的標題不會是 Bangers、像素主題不會是點陣字，這是目前唯一已知的主題視覺落差。
- **`theme-color` meta 與 manifest** 仍是舊的紫色骨架色，隨 DP-018 一起改成跟著主題走。
- **尚未搬移畫面的樣式**：日曆分頁與設定分頁中的帳號／版本區塊仍是紫色工程骨架，`shell.css` 末段以獨立的 CSS 變數區塊把它們與 canonical token 隔離。該區塊與 `CalendarScaffoldScreen` 在 DP-051／DP-014 一起刪除。
