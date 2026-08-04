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

## 3. 偏好設定語意

- `theme` 保留，目標行為為 `system | light | dark`。實作時要一起處理 CSS、`prefers-color-scheme`、`meta[name=theme-color]` 與 PWA manifest 顏色，不能只保存欄位。
- `month_weeks` 不作為長期模型。它會由明確的二選一設定取代：固定六列或依當月自動顯示 4–6 列；migration 前採用 `fixed_six_week_grid boolean` 作為資料庫名稱，domain 可用語意化 enum 暴露給 UI。
- `pet_enabled` 保留。浮動寵物可以暫時拖走，也必須可以永久關閉。

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
