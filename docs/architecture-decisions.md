# DayPop 架構決策

本文件記錄已確認、會影響多個模組或後續 migration 的設計決策。實際進度與執行順序仍以 [`tasks.md`](../tasks.md) 為準。

## 1. 本機資料必須 fail closed

`daypop.user-data` 是遊客模式的正式資料來源。讀取結果不能只回傳「資料或空值」，而要能區分：

- `ready`：格式有效且 schema version 可由目前 App 讀取。
- `corrupt`：JSON 或 envelope 結構無法解析。
- `future-version`：資料 schema 比目前 App 新。
- `unavailable`：瀏覽器 storage 無法取得、讀取或寫入。

遇到 `corrupt` 或 `future-version` 時，repository 必須拒絕 mutation，不得拿空資料覆寫原值。UI 應顯示持續可見的說明，並提供匯出原始內容、更新 App、重試或由使用者確認的重設流程。重設前若 storage 仍可寫入，先保存備份；備份或匯出成功前不得取代原 key。

storage 不可用時可提供「只維持到本次分頁關閉」的記憶體模式，但必須明確標示為非持久化狀態，不能讓使用者誤認為資料已保存。`QuotaExceededError` 與 storage accessor 例外都屬於這個狀態。

任何本機 schema version 提升前，必須先完成上述 write barrier 與 future-version 回歸測試。

### 實作結果（DP-016／DP-017）

- 備份 key 是 `daypop.user-data.backup.<ISO timestamp>`，不是原先設想的 `.corrupt.`：來自較新 schema 的資料並沒有損壞，用 `corrupt` 命名會誤導。時間戳讓第二次復原不會蓋掉第一次的備份。
- 四個狀態中的 `unavailable` **沒有**做成第四種 read status。`StorageReadResult` 維持 `ready`／`corrupt`／`future` 三態，storage 不可用改由下一層的 `AppStorage` 處理：probe 失敗或中途遭拒就換成 `MemoryStorage`，讀取結果照常是 `ready`。這樣「資料本身有問題」與「這台裝置存不了」是兩個獨立的軸，UI 也能同時呈現（復原畫面＋記憶體模式橫幅）。
- 記憶體模式的警告是版面內、不可關閉的橫幅，四個分頁與復原畫面都顯示；降級後不自動切回持久化，否則同一個 session 會半在磁碟半在記憶體。
- write barrier 與 future-version 回歸測試已完成，schema version 提升的前置解除。

## 2. Domain contract 先於 repository adapter

Guest local adapter 與 authenticated Supabase adapter 必須共用同一套 canonical domain contract；不能讓 UI 同時理解本機簡化模型與資料庫模型。

| 領域 | Canonical contract |
| --- | --- |
| Calendar | 所有 event／todo 都有 `calendarId`；guest bootstrap 也會建立穩定的預設本機日曆。 |
| All-day event | 使用 `startDate` 與 inclusive `endDate`；ICS adapter 負責在邊界轉成 exclusive `DTEND`。 |
| Timed event | 保存 ISO instant 的開始／結束時間與 IANA timezone；DB 與 domain 都要求 end 晚於 start。 |
| Todo | 使用 `calendarId`、`dueDate`、完成時間、排序與 sharing scope；不延續 UI 專用的相對日期字串。 |
| Preferences | 包含 timezone、week start、theme、calendar grid mode、reminders 與 pet preferences。 |

執行順序是：先保護現有 v1 storage，再完成 domain／DB mapping 與 runtime validation，最後才建立兩個 repository adapter。第一次升到 schema v2 時必須保留 v1 fixture、migration test 與 future-version test。

### 實作結果（DP-012）

- Canonical event 改為全天／timed discriminated union；全天使用 inclusive `startDate`／`endDate`，timed 使用 ISO instant `startsAt`／`endsAt` 與 IANA `timezone`。Calendar、Recurrence、EventException、Todo、Sticker、Preferences 皆有對應 runtime validation。
- `src/domain/databaseMapping.ts` 是 domain 與 generated Supabase `Row`／`Insert` types 的唯一 mapping；client insert 刻意不帶 `created_at`／`updated_at`。這層只定義 contract，不在 DP-012 接上網路 CRUD。
- 本機 envelope 已升到 schema v2。首次啟動與 v1 migration 都會立即持久化一個 UUID default calendar，避免每次讀取產生不同 ID；v1 的非 UUID event／todo ID 會在一次性 migration 重建為 UUID 並指向該 calendar。v1 fixture、migration 與 future-version 測試持續保留。
- DP-012 當時的 `month_weeks` 暫時相容編碼已由 DP-018 收掉；歷史值 `6` migration 為 fixed-six，`4`／`5` migration 為 adaptive，runtime mapping 不再理解數字列數。
- Recurrence 在本階段只保存 RFC 5545 rule text；展開 occurrence、DST、單次修改與 ICS round-trip 仍屬 DP-027。提醒上限、DB timezone 受控驗證與 `created_at` hardening 仍依 DP-036／027，不在 mapping 層假裝完成。

## 3. 偏好設定語意

- `theme` 保留，目標行為為 `system | light | dark`。實作時要一起處理 CSS、`prefers-color-scheme`、`meta[name=theme-color]` 與 PWA manifest 顏色，不能只保存欄位。
- `month_weeks` 不作為長期模型。它會由明確的二選一設定取代：固定六列或依當月自動顯示 4–6 列；migration 前採用 `fixed_six_week_grid boolean` 作為資料庫名稱，domain 可用語意化 enum 暴露給 UI。
- `pet_enabled` 保留。浮動寵物可以暫時拖走，也必須可以永久關閉。

### 實作結果（DP-018）

- 視覺主題 id 與色彩模式是兩個獨立偏好：`themeId` 保存六套 canonical theme，`theme` 保存 `system | light | dark`。新資料預設為漫畫淺色；既有本機／DB 的 `theme` 值不因 migration 被覆寫。
- `system` 會即時追蹤 `prefers-color-scheme`；解析後的 palette 同步套用 CSS variables、`meta[name="theme-color"]` 與 `color-scheme`。Manifest 的靜態啟動畫面色改為 canonical 漫畫淺色白底，不能假裝追蹤尚未執行 JavaScript 時的個人偏好。
- Domain 使用 `calendarGridMode = adaptive | fixed-six`；DB 使用 `fixed_six_week_grid boolean`。連續捲動月格在 adaptive 模式依目前月份顯示 4–6 列，fixed-six 一律顯示六列。
- 本機 user-data envelope 升到 schema v3；保留 v1 fixture，另新增 v2 fixture，v2→v3 只補上當時不存在的 `themeId = manga`，其餘已保存偏好與 revision／timestamp 原樣保留。future／corrupt write barrier 不變。

## 4. App 內浮動寵物

寵物是 App viewport 內的 floating companion，不是作業系統桌面程式。現有 React `<aside class="pet-helper">` 只是正常文件流中的摘要佔位；未來 DP-040 才會建立浮動層、七個動畫狀態與拖曳。

`grab` 狀態保留。拖曳位置只屬於裝置 UI state，不進行家庭分享；位置要限制在 viewport 並避開 safe-area，使用者也能透過 `pet_enabled` 關閉寵物。

## 5. PWA 與發布

- 安裝圖示要包含 180×180 Apple touch icon，以及 192×192、512×512 PNG；Safari 26 已支援 SVG Home Screen icon，但為了舊版 iOS 與明確的 `apple-touch-icon` 相容性，SVG 仍只作補充，不取代 PNG fallback。
- 自動版本檢查要節流：定時檢查可維持較長間隔；回到前景或恢復連線的自動檢查，距上次成功／嘗試未滿 5 分鐘時不重送。使用者手動按「檢查更新」永遠可以立即執行。
- release note 在該版本正式部署後視為不可變；後續修正必須使用新版本號與新公告。App release version 與 user-data schema version 持續分開管理。

## 6. 資料庫與日期邊界

- 全天事件在 DayPop domain／DB 使用 inclusive `end_date`；ICS import/export 在 adapter 邊界轉換 exclusive `DTEND`。
- IANA timezone 由 domain validation 與可測的資料庫 trigger／受控寫入邊界驗證，不使用直接查詢 `pg_timezone_names` 的 CHECK，因為該資料來源不適合 immutable CHECK expression。
- `reminder_minutes` 與 `default_reminder_minutes` 要限制元素數量、非負範圍與可接受上限。
- `created_at` 應由資料庫／repository 控制，public client 不應能任意偽造。
- UI 的 23:xx 行程必須正確跨到次日，不能只把小時 `% 24` 後留下同一天日期。

以上 invariant 必須在 account CRUD 接線前完成 migration、generated types 與測試。

DP-012 已完成 domain 的日期／instant／IANA timezone validation、inclusive 全天邊界與 generated DB mapping；既有 DB 的全天／timed shape constraint 也已有對應測試資料。尚未完成的 DB timezone 受控驗證、reminder array 上限與 `created_at` 防偽依 DP-027／036 處理，完成前不得把 account CRUD 視為已可上線。

### 實作結果（DP-063）— 牆上時間位移一律以日曆日重算，不用固定毫秒

上面「23:xx 行程必須正確跨到次日」的 invariant，實作上還有一個更嚴格的條件：**跨日順延必須在目標日期上重新解析同一個牆上時鐘，不能對 instant 加固定的 24 小時。** DST 當晚的本地日是 23 或 25 小時，固定位移會落在錯誤的牆上時鐘 — 實測 America/New_York 2026-03-08 的 23:00–00:30 被存成 23:00–01:30，90 分鐘變成 150 分鐘。

- `src/domain/eventTime.ts` 的 `timedEventFromWallTime()` 是這個規則的唯一實作點，回歸測試在 `src/domain/eventTime.test.ts`。
- `src/domain/date.ts` 的 `daysBetween()`／`weeksBetween()` 以 `Math.round` 取整，同樣是為了讓 23／25 小時的一天仍然算一天。
- 例外只有 `src/storage/localDataMigration.ts`：v1 資料固定錨在無 DST 的 `+08:00`，每一天都剛好 24 小時，因此保留固定位移並在原地註明原因。
- **DP-027 展開 recurrence occurrence 時適用同一條規則**：「隔天的同一個時間」是日曆運算，不是加 86400000 毫秒；每日／每週／每月重複跨越 DST 時，使用者期待的是牆上時鐘不變。
- 全天事件的 `endDate` 是 inclusive 且可以晚於 `startDate`，因此任何編輯都必須讓兩端一起移動（DP-063 修正 `applyEventPatch()`）。DP-026 從 `events` 讀回的多日全天事件就是這個形狀。

**尚未決定：跨午夜行程在檢視層怎麼呈現。** 月格／日詳情的衝突偵測與週檢視的色塊高度都用同日 `HH:MM` 比較，與原稿逐行一致（原檔只存 `HH:MM` 字串才不會遇到）。DayPop 存 instant，因此這是新的產品決策，記在 DP-064，未定案前不要各檢視各改各的。

## 7. 工程治理

- 最小 CI 優先建立：`npm ci` → lint → typecheck → unit test → build；之後再加入 Supabase local reset、pgTAP 與 Playwright。
- CI 同時固定 Node major version；`package.json#engines` 與版本檔應保持一致。
- LICENSE 暫不替專案擁有者做決定。Public repository 在沒有 LICENSE 時仍是保留所有權利；若要接受外部貢獻，再由擁有者選擇授權條款。

## 8. 2026-08-01 review handoff 採納結果

| 提案 | 決定 |
| --- | --- |
| P0 malformed／future schema 資料遺失 | 採用，提升為最高優先；已用探針重現。 |
| storage 不可用時降級 | 調整後採用；只允許有明顯警告的非持久化模式。 |
| theme | 保留並完整接線，不移除。 |
| `month_weeks` | 採用語意修正，改為 fixed-six vs adaptive。 |
| 寵物規範與 `grab` | 採用；更新為 App 內浮動情境並保留七狀態。 |
| CI、domain ↔ DB mapping、PNG icons | 採用並調高任務優先度。 |
| Node pin、更新節流、日期／提醒／時區約束、release note 不可變 | 採用並併入對應任務／規則。 |
| LICENSE | 延後，等待專案擁有者選擇。 |
