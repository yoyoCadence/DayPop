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

- **字體**：DP-052 已自託管六套顯示字體，詳見下一節；中文仍使用系統字體。
- **`theme-color` meta 與 manifest** 仍是舊的紫色骨架色，隨 DP-018 一起改成跟著主題走。
- **尚未搬移畫面的樣式**：日曆分頁與設定分頁中的帳號／版本區塊仍是紫色工程骨架，`shell.css` 末段以獨立的 CSS 變數區塊把它們與 canonical token 隔離。該區塊與 `CalendarScaffoldScreen` 在 DP-051／DP-014 一起刪除。

## DP-051 交接狀態：漫畫主題核心日曆 shell

### 已搬移

- `src/screens/calendar/CalendarScreen.tsx`：header（今日日期列、`--font-head` 30px 期間標題、今天、搜尋）、‹ › 與月／週／列表 segmented control、快速新增列。
- `src/screens/calendar/MonthView.tsx`：週標題列與**連續捲動的月格**。原檔不是一頁一個月，而是渲染一段滾動中的週緩衝、在兩端動態延長，並由最上方那一週推導 header 月份標籤 — 這是設計本身，所以照樣重現，沒有換成 6×7 分頁。列高由可用高度除以 `WEEKS_SHOWN`（4）得出，與原檔同一條公式。
- `src/screens/calendar/PetLayer.tsx`：App 內浮動寵物的**位置**與 60 × 60 尺寸。
- FAB 與底部升起 sheet。
- `src/domain/lunar.ts`、`src/domain/quickAdd.ts`：農曆／節日與快速新增解析器，皆自原檔逐行移植並補單元測試。

### 座標換算

原檔把 FAB 釘在 phone root 上方 80px、寵物層 78px，而那個座標系包含 64px 的 tab bar。`.cal-screen` 是 app body，也就是同一塊空間扣掉 tab bar，所以等效偏移是 80 − 64 與 78 − 64。實測結果與原檔完全一致。

### 尚未搬移（DP-014）

週檢視、列表檢視、日詳情 sheet 與完整的新增／編輯事件 sheet。週／列表保留在 segmented control 的原位並明講尚未搬移，不顯示假內容。點月格目前只選取該日，原檔會開日詳情 sheet。

### 過渡措施（DP-014 移除）

- **快速新增直接建立行程。** 原檔是把解析結果交給事件 sheet 讓使用者確認。DayPop 的 sheet 還沒搬過來，若只做到「開一個未搬移的畫面」會失去現有的新增能力，所以先直接建立，並在讀到 重複／地點／提醒 但存不下來時明講，不靜靜丟掉。
- **FAB sheet 只有現有資料模型存得下的欄位**，其餘欄位列名而不放假輸入框。
- **待辦是 sheet 裡的一個模式。** 原檔是從寵物對話泡泡新增待辦（DP-040）。在泡泡搬過來之前把待辦放在這裡，是為了不讓既有能力消失，不是它的正式位置。
- 每日事件的色塊目前一律用 `--accent`；Calendar 與 event `calendarId` 已由 DP-012 完成，原檔的逐日曆顏色顯示待 DP-014／026 接線。
- 月格的貼圖已由 DP-055 接上：依當日數量調整字級（1／2／3／4+ → 19／15／12／10px），以 `margin-top:auto` 置底並置中換行，與原檔的 `stkSize` 一致。

### 已驗證

以 Playwright／Chromium 與原始 `.dc.html` 並排比對：桌面展示框中 header 量得完全相同的 `x:448 y:104.5 384 × 180.59`，月格捲動區 `486.41` 高度一致，FAB 與寵物位置與原檔逐像素相同；390px 與 1280px 皆無水平溢出，console 0 error／warning。空資料與示範資料（經快速新增建立）都比對過，含全天事件排最前、`+N` 收合、時間重疊的紅點、農曆與節日（七夕、中元）標示，以及漫畫深色主題。

已知差異一項：月格列高在桌面展示框中為 121px，原檔量到 123px。兩者用同一條 `max(58, floor(可用高度 / 4))` 公式，可用高度也相同（486.41px）；原檔的 123 來自它在版面尚未定案時就先量過一次。

## DP-053 交接狀態：週檢視與列表檢視（DP-014 第一段）

### 已搬移

- `src/screens/calendar/WeekView.tsx`：7 欄時間格。36px 時刻軌、07:00–22:00、每小時 44px、格子總高 676px、欄寬 60px、內層 `min-width: 456px`。今日欄位頭套 `--today-bg`／`--today-fg`，目前時間線只在本週且時間落在軌道範圍內才畫。
- `src/screens/calendar/AgendaView.tsx`：向後 16 天的每日分段；今天與明天即使沒有安排也會出現，之後的空日略過。
- `src/domain/timeGrid.ts`：時間格的所有常數與計算（區塊定位、15 分鐘吸附、移動、調整長度、跨欄換日、目前時間線），逐行取自原檔並補 20 個單元測試。
- `src/screens/calendar/EventSheet.tsx`：原本的 `AddSheet` 改名，因為它現在同時負責新增與編輯。編輯模式會帶入既有值、隱藏行程／待辦切換，並提供原檔的「刪除事件」按鈕。
- `LocalDayPopRepository` 新增 `updateEvent`／`deleteEvent`。兩者只改既有欄位，沒有動 schema，`schemaVersion` 維持不變。

### 週檢視的互動

拖曳區塊改時間、拖曳底部邊緣調整長度、橫向拖曳換日，皆吸附 15 分鐘；按下但沒有移動則開啟該事件（原檔的 `wkUp` 就是這樣分辨的）。指標事件掛在 `window` 上，快速拖曳離開區塊仍能追蹤。

原檔在拖曳重複事件的單一次發生時會把它拆成獨立事件；Recurrence／EventException 模型已由 DP-012 完成，但 occurrence expansion 與單次修改語意仍待 DP-027，所以拖曳暫時只更新 base event。

### 刻意未搬移

- **天氣**：原檔在每日標題右側顯示天氣，但那是原型的假功能（`weather()` 依日期取固定字串）。依 `docs/prototype-behavior-baseline.md` 的規則，假功能維持停用，版面位置（flex spacer）保留但不顯示假資料，等產品決定資料來源。
- **全天列**：原檔的週檢視格子本身也不畫全天事件；獨立的全天列屬 DP-014 後續。
- **日詳情 sheet**：點月格仍只選取該日，日詳情留給 DP-014 下一段。

### 與原檔的差異

原檔的待辦只有 `when=today|tomorrow` 兩種，所以列表檢視只在第 0、1 天顯示待辦。DayPop 存的是真實日期，因此待辦顯示在它實際到期的那一天 — 這是同一個意圖在更完整資料模型下的對應寫法，不是新設計。

### 已驗證

以 Playwright／Chromium 與原始 `.dc.html` 並排比對：週檢視格子量得完全相同的 `x:484 y:336.09 420 × 676`，時刻軌 36px、欄寬 60px、內層 456px、標籤 07:00–22:00 共 16 條。區塊定位正確（09:00 → top 88px、14:00 → 308px、19:30 → 550px）。拖曳 88px（兩小時）後 09:00 晨會變成 11:00 並吸附正確，列表檢視同步更新；點擊未移動則開啟「編輯行程」sheet 並含刪除按鈕。390px 下整頁無水平溢出，時間格自身橫向捲動（456 > 390），與原檔行為一致。漫畫淺色與深色皆比對，console 0 error／warning。

## DP-057 交接狀態：日詳情 sheet（DP-014 第二段）

### 已搬移

`src/screens/calendar/DayDetailSheet.tsx`：點月格開啟的日詳情。sheet 外框、grip、`M月D日 週X` 標題與「完成」、行程區段（全天顯示「全天」、其餘顯示 `start–end`、時間重疊顯示紅色色條與「衝突」標籤、空狀態「這天沒有行程」）、＋ 新增事件、待辦清單區段（勾選、刪除、新增）皆依原稿完成。z-index 65，位於 tab bar 與浮動層之上、事件 sheet（90）之下，兩層可同時開啟。

這同時收掉 DP-051 的一項過渡措施：點月格不再只是選取該日。

### 保留位置但尚未實作

貼圖列與貼圖選擇器已由 DP-055 搬移：點既有貼圖即刪除、`＋ 貼圖` 展開 63 個 glyph 的選擇器、選一個後關閉，換一天開啟時選擇器也會關閉（對應原檔 `openDay()` 重設 `stickerPick`）。

原稿的日詳情還有兩件事需要 DayPop 還沒有的操作介面，一律保留版面位置並標示負責任務，不放假的控制項：

- 待辦子項 → canonical `parentId` 已完成（DP-012），操作 UI 待 DP-014
- 待辦拖曳排序 → canonical `sortOrder` 已完成（DP-012），操作 UI 待 DP-014

事件列目前仍不顯示地點；domain `location` 已由 DP-012 完成，顯示與事件表單接線待 DP-014。

### Escape 由畫面統一處理

事件 sheet 可以疊在日詳情之上。兩個元件各自在 `window` 上監聽 Escape 會讓一次按鍵同時關掉兩層，所以改由 `CalendarScreen` 持有唯一的 Escape handler，只關最上層。之後新增任何 sheet／dialog 都應該接進同一處，不要各自監聽。

### 已驗證

以 Playwright／Chromium 與原始 `.dc.html` 並排比對：sheet 錨點與寬度相同（`x:448 width:384`，底部對齊 viewport，padding `8px 16px 22px`）。四筆示範資料下，全天事件排最前且顯示「全天」，兩筆時間重疊的事件都出現「衝突」標籤；空日顯示「這天沒有行程」。從 sheet 新增待辦、勾選（刪除線＋`--faint`）與刪除皆正常；＋ 新增事件與點事件列分別開啟新增與「編輯行程」。日詳情 z-65、事件 sheet z-90，可同時開啟且 Escape 只關最上層。390px 無水平溢出，漫畫淺色與深色皆比對，console 0 error／warning。

## DP-058 交接狀態：搜尋與綜覽（DP-014 第三段）

### 已搬移

- `src/screens/SearchScreen.tsx`：標題、含放大鏡的搜尋欄、日曆篩選 chip 列、結果卡片（色點＋標題＋副標）、閒置提示與「找不到『X』的相關結果」。
- `src/screens/OverviewScreen.tsx`：標題與「共 N 筆」、行程／待辦／貼圖切換、‹ 期間標籤 ›、年／月／週切換與「今天」、年檢視才出現的全部收合／展開、可折疊的分組卡片與項目列。
- `src/domain/search.ts`、`src/domain/overview.ts`：純函式的搜尋與分組邏輯，共補 17 個單元測試。
- 分頁佔位元件 `PendingScreen` 已刪除，四個分頁都有真正的畫面了。

### 跨分頁開啟

原稿的搜尋結果與綜覽項目會直接開啟事件 modal。DayPop 的 sheet 屬於 `CalendarScreen`，所以 `App` 多了一個 `calendarFocus` 狀態：點結果時設定 focus 並切到 日曆 分頁，`CalendarScreen` 掛載時把它讀成初始 state。分頁切換會 unmount，所以不需要 effect；直接點 tab bar 會清掉 focus，避免下次進日曆時又彈出 sheet。待辦沒有自己的編輯畫面，改為開啟它所屬那天的日詳情。

### 保留位置但尚未實作

- **日曆篩選 chips**：原稿一個日曆一個 chip。Calendar 模型已由 DP-012 完成，目前仍只留「全部」，旁邊標示 `依日曆篩選待 DP-014`，避免在設定／CRUD 接線前顯示無作用 chip。
- **綜覽的貼圖分頁**：DP-055 已接上。貼圖列以 glyph（23px、26px 寬）取代事件／待辦的色條，時間欄留空、標題固定為「貼圖」，點一列開啟該日，與原檔 `mapItem()` 一致。
- 搜尋只比對標題；domain 已有地點與備註，擴充搜尋比對與欄位 UI 待 DP-014。

### 已驗證

以 Playwright／Chromium 與原始 `.dc.html` 並排比對：兩頁的 header 與控制項排列一致。行為逐項確認 — 搜尋閒置提示、`客戶` 命中事件與待辦（副標為 `09:00 · 8月2日`、`待辦 · 8月2日`）、無結果訊息；點事件結果會切到 日曆 分頁並開啟「編輯行程」且帶入正確標題。綜覽月檢視 `共 5 筆`、依日分組並顯示 `週X` 與筆數、全天事件排最前；待辦分頁 `共 2 筆`；貼圖分頁顯示說明；年檢視依月分組並在組內標日期，全部收合／展開有效；週檢視 `8/2 – 8/8` → 下一期 `8/9 – 8/15` →「今天」回到 `8/2 – 8/8`。1280px 與 390px 皆無水平溢出，漫畫淺色與深色皆比對，console 0 error／warning。

## DP-052 交接狀態：主題字體

### 自託管範圍

`src/theme/fonts.css` 是唯一的字體清單，由 `src/main.tsx` 在 `styles.css` 之前載入。六套顯示字體全部從 npm 官方 registry 的 Fontsource 套件取得（皆為 OFL-1.1），由 Vite 打包成同源 `assets/*.woff2`，production build 沒有任何執行期第三方字型請求，也不需要放寬 CSP。字重與原檔的 Google Fonts `<link>` 完全一致：Bangers 400、DotGothic16 400、IBM Plex Sans 400／500／600／700、Newsreader 400／500／600／700、Space Grotesk 400／500／600／700、Pixelify Sans 400／600／700。

匯入的是**每個字重的進入點**（`400.css`）而不是具名 subset（`latin-400.css`）。只有前者帶 `unicode-range`，也就是原檔 Google Fonts stylesheet 的行為 — 畫面上出現對應字元時才下載該切片。具名 subset 檔沒有 `unicode-range`，同一字重匯入兩個會互相覆寫。

唯一例外是 DotGothic16：它的字重進入點把 CJK 切成約 170 條 `@font-face`，單獨就是 106 KB 的 render-blocking CSS。改用單一 `japanese-400.css`，Latin、假名與漢字都在同一個 396 KB woff2，且只在使用像素主題時下載。

### 中文字體的決定

**Noto Sans TC 與 Noto Serif TC 不自託管。** 它們的完整 Fontsource subset 分別是 65 MB 與 78 MB，不是 mobile PWA 可接受的體積。中文改用平台系統字體（iOS／macOS 的 PingFang TC、Windows 的 Microsoft JhengHei、Android 的 Noto Sans CJK），因此中文字形會與原檔有平台相關的細微差異，這是刻意接受的取捨。像素主題不受影響，因為 DotGothic16 本身就涵蓋所需漢字。若日後要連中文一起自託管，必須先解決 subset 與體積問題，記於 DP-015。

### font-synthesis

`styles.css` 的 `:root` 設了 `font-synthesis: none`，但原檔沒有。Bangers 與 DotGothic16 只有 400 一個字重，而 markup 會要求 700–900，關閉合成會讓這兩套主題明顯比原稿細。`shell.css` 在 `.dp-preview` 上還原 `font-synthesis: weight style`，只影響 App viewport 內。

### 已驗證

以 `document.fonts.load()` 明確載入後再用 `document.fonts.check()` 確認字元覆蓋：Bangers 400、Pixelify Sans 400／700、DotGothic16 400（Latin 與「設定日曆綜覽搜尋」皆涵蓋）、Space Grotesk 500、IBM Plex Sans 600、Newsreader 700 全數通過。網路側只觀察到同源 `woff2` 請求與 Supabase auth settings，沒有 Google Fonts 或 unpkg。像素主題實際渲染確認中文也是點陣字。

> 註：用文字寬度差異判斷是否套用字體對 CJK 無效 — 幾乎所有字體的漢字都是 1em 等寬。判斷覆蓋率請用 `document.fonts.check()`，並先 `await document.fonts.load()` 避免量測搶在下載之前。

## DP-016／DP-017 交接狀態：非原稿的資料狀態畫面

原稿假設 `localStorage` 永遠可用、永遠讀得回來，因此沒有這兩個狀態的設計。以下兩個畫面是為了不謊報保存結果而加的，都用 canonical theme tokens 建構，**不得在後續搬移中被移除或改成可關閉**。

### 復原畫面（DP-016）

`src/screens/DataRecoveryScreen.tsx`。本機資料解析失敗或來自較新 schema 時，取代所有分頁渲染（`AppShell hideTabBar`）。先備份、備份成功才開放重設；`resetUserData()` 在沒有備份時直接拒絕。

### 記憶體模式橫幅（DP-017）

`src/shell/StorageWarningBanner.tsx`，經 `AppShell` 的 `banner` prop 固定在 App body 之上，四個分頁與復原畫面都會顯示。

- **佔版面而非浮層**：警告會存在整個 session，浮層會擋住日曆內容。
- **不可關閉**：關掉之後使用者會在半路忘記自己的編輯不會保存。
- **兩種原因文案**：儲存空間已滿、瀏覽器不允許使用本機儲存空間；兩者都接同一句「只留在這個分頁，重新整理或關掉之後就會消失」。
- 記憶體模式下復原畫面的備份文案會改寫，因為此時只有下載的檔案是真備份。

### 已驗證

以 Playwright／Chromium 在 390px 逐項確認：封鎖 `localStorage` accessor 後 App 仍正常開啟、橫幅顯示、分頁可用、快速新增可見、重新整理後編輯消失且橫幅仍在；session 中途 `setItem` 丟 `QuotaExceededError` 時橫幅即時出現、既有位元組與第一筆編輯完全未變、重新整理後只剩第一筆且橫幅消失；四個分頁皆顯示橫幅；資料損壞＋無法保存時復原畫面與橫幅同時存在且原始位元組不變。水平溢出 0px，console 0 error／warning。
