# Supabase MCP 階段交接 — 2026-08-08

給接手 Supabase MCP 階段的 agent。`tasks.md` 的「建議執行順序」停止點已於 2026-08-08 抵達，專案擁有者確認改由可使用 MCP 的 agent 接手。

這份文件**不重複**已經寫在別處的內容，只記錄交接當下的狀態、你必須先知道的前置與陷阱。canonical 來源仍是：

- [`../AGENTS.md`](../AGENTS.md) — 協作契約、執行模式、範圍控制、安全基線、§0.1 目前技術狀態。
- [`../tasks.md`](../tasks.md) — 任務板與「建議執行順序」表（含每一項的 MCP 使用規則）。
- [`architecture-decisions.md`](architecture-decisions.md) — 跨模組決策；DP-018／027／036 直接依賴 §3 與 §6。
- [`claude-design-source-of-truth.md`](claude-design-source-of-truth.md)、[`prototype-behavior-baseline.md`](prototype-behavior-baseline.md) — UI 不變條件與搬移狀態。

基準 commit：`ac5f564`（PR #28 合併後的 `main`）。

---

## 0. DP-018 完成後更新（2026-08-08）

這份文件的「交接當下」段落保留歷史快照；目前基準已由 DP-018 往前推進：

- 遠端 migration history 與 repo 現在正好是 5 檔；第五檔為 `20260808083912_replace_month_weeks_with_fixed_grid.sql`。它以正式 CLI dry-run／push 套用，沒有透過 MCP DDL 或 Dashboard SQL Editor。
- `user_preferences` 已以 `theme_id` 保存六套外觀、以 `fixed_six_week_grid` 保存 fixed-six／adaptive；數字 `month_weeks` 已移除。Generated DB types 已由遠端 schema 重新產生，security advisor 仍為 0 警告。
- 本機 user-data envelope 已升到 schema v3；v2→v3 保留所有既有偏好、revision 與 timestamp，只補上當時不存在的 `themeId = manga`。ThemeProvider、設定 UI 與連續月格都已接上保存。
- 此機器的 Supabase CLI 2.111.0 在 Codex sandbox 內會以 Bun `TransportError` 卡在 Management API login role；DP-018 的 link／dry-run／push 因此由專案擁有者在自己的 PowerShell 執行。這是該工作階段的 CLI 相容問題，不代表 schema 工作改用 Dashboard。
- `supabase test db --linked` 仍會要求本機 Docker，不能再宣稱 linked pgTAP 不需 Docker。DP-018 改由 MCP 執行 repo 同一份 7 項 rollback pgTAP；transaction 內暫時建立 pgTAP extension、使用固定假 UUID，結束後 extension 與測試帳號均確認不存在。這不是正式 schema DDL，pgTAP CLI 本身未重跑。
- 下一項是 DP-036；已放進 `Next`，但必須等專案擁有者親自合併 DP-018 PR 後才開始。

## 0.1 DP-036 完成後更新（2026-08-08）

- 專案擁有者已親自合併 DP-018；DP-036 從最新 `main` 建立獨立分支。開工前 read-only MCP 確認遠端／repo 同為 5 檔、DP-018 欄位正確、9 張公開表 RLS 全開且 advisor 0，沒有 drift。
- 第六檔 migration `20260808093254_enforce_crud_invariants.sql` 已由專案擁有者在 PowerShell 完成 CLI dry-run／push；MCP 沒有套正式 DDL，也沒有 Dashboard 手改或 remote reset。
- `events.reminder_minutes` 與 `user_preferences.default_reminder_minutes` 現在最多 10 項、每項 0–10080 分鐘且不可含 `null`。九張公開表都有 INSERT timestamp trigger；既有 UPDATE triggers 現在會保留 `created_at`，public client 即使繞過 repository 也不能偽造建立時間。
- 套用後確認遠端／repo 正好 6 檔，constraints、9 triggers、function、RLS 與 schema 均符合 migration；security advisor 仍 0。遠端重新產生的 TypeScript types 與 repo 完全相同，constraint／trigger 不產生型別 diff。
- Repo pgTAP 已擴成 15 項；另以 12 項會在失敗時直接 raise 的 transaction 驗證 reminder 邊界、時間先後、server timestamps、owner RLS、跨帳號 child ownership 與 cascade，最後完整 rollback。固定假帳號／事件另行確認不存在。
- 下一項是 DP-027；已放進 `Next`，但必須等專案擁有者親自合併 DP-036 PR 後才開始。

## 0.2 DP-027 完成後更新（2026-08-08）

- 專案擁有者已親自合併 DP-036；DP-027 從最新 `main` 建立獨立分支。開工前 read-only MCP 確認遠端／repo 同為 6 檔、DP-036 constraints／triggers 正確、9 張 public tables RLS 全開且 advisor 0，沒有 drift。
- 第七檔 migration `20260808100626_validate_event_timezones.sql` 已由專案擁有者在 PowerShell 完成 CLI list／dry-run／push；畫面最後的 Docker 訊息仍只是無法快取本機 pg-delta catalog，遠端 migration 已成功。MCP 沒有套正式 DDL，也沒有 Dashboard 手改、remote reset 或查改正式使用者資料。
- `user_preferences.timezone` 與 `events.timezone` 現在由兩個 write trigger 查詢 PostgreSQL 支援的 timezone；沒有建立錯誤的 immutable CHECK。`validate_daypop_timezone()` 是 security invoker、固定空 `search_path`，並撤銷 public／anon／authenticated 直接 execute。
- 套用後確認遠端／repo 正好 7 檔，兩個 triggers、function security、9 張 public tables RLS 與 schema 均符合 migration；security advisor 仍 0。遠端 generated TypeScript types 與 repo 的 16,501 字元逐字相同，trigger 不產生型別 diff。
- Repo pgTAP 已擴成 24 項，涵蓋合法／非法 preference 與 event timezone、trigger 數量、function security、既有 timestamp／RLS／cascade；完整 rollback 後確認 pgTAP extension、固定假帳號與事件均不存在。`supabase test db --linked` 仍因本機沒有 Docker 而未宣稱通過。
- Domain 已完成 RFC 5545 RECUR validation、DST-safe occurrence expansion、single cancel／replacement、series cleanup 與 ICS inclusive／exclusive round-trip。事件 sheet 控制項與 occurrence UI 仍歸 DP-014，檔案匯入預覽／合併仍歸 DP-056，不得在 DP-024 偷帶。
- 下一項是 DP-024；已放進 `Next`，但必須等專案擁有者親自合併 DP-027 PR 後才開始。

## 0.3 DP-024 完成後更新（2026-08-08）

- 專案擁有者已親自合併 DP-027；DP-024 從最新 `main` 建立獨立分支。開工前 read-only MCP 確認遠端／repo 同為 7 檔、既有 invariants／timezone triggers、9 張 public tables RLS 與 advisor 0 都沒有 drift。
- 第八檔 migration `20260808123919_bootstrap_daypop_accounts.sql` 已由專案擁有者在 PowerShell 完成 CLI list／dry-run／push；畫面最後的 Docker 訊息只表示本機 pg-delta catalog 無法快取，遠端 migration 已成功。MCP 沒有套正式 DDL、Dashboard 手改或 remote reset，也沒有查改正式使用者資料。
- Account bootstrap 現在只有一條 DB 路徑：`auth.users` AFTER INSERT trigger 呼叫 `daypop_private.bootstrap_account(uuid)`，同一交易建立缺少的 profile、canonical preferences 與一個預設 calendar。Helper 使用 account-scoped transaction advisory lock＋conflict-safe insert；重試不重複，migration backfill 只補缺列、不覆寫既有值。
- `daypop_private` 不 exposed，public／anon／authenticated 無 schema usage 或 function execute；helper 是 security invoker，只有 auth trigger handler 是 SECURITY DEFINER 且固定空 `search_path`。它只使用受信任 trigger row 的 `new.id`，不是 client 可傳任意 user id 的 RPC。
- 套用後確認遠端／repo 正好 8 檔、bootstrap trigger 正好 1 個、9 張 public tables RLS 全開、generated TypeScript types 忽略 CRLF／末尾換行後逐字一致，security advisor 仍 0。Repo rollback pgTAP 擴為 36 項並 36／36 通過；暫時 pgTAP extension、固定假帳號、profiles 與 calendars 均確認不存在。
- DP-024 沒有接線 authenticated adapter。下一項是**不使用 MCP**的 DP-062 寫入順序保護；必須等本 PR 由專案擁有者親自合併後，從最新 `main` 開始。DP-062 合併後才進 DP-026 遠端 CRUD。

## 0.4 DP-062 完成後更新（2026-08-08）

- 專案擁有者已親自合併 DP-024；DP-062 從最新 `main` 建立獨立分支，全程沒有使用 Supabase MCP、查詢遠端或變更 schema。
- `DataProvider` 的 screen actions 維持 fire-and-forget，但 repository mutation 現在共用 promise queue，依 UI 呼叫順序逐筆執行。選擇序列化而不是只丟棄 stale response，因為遠端 adapter 使用共享 snapshot；並行 request 仍可能讓 durable store 被較早操作最後覆寫。
- Rejection 會進既有 failure state，但 queue tail 會被消化，使用者已送出的下一筆操作仍會依序執行。Race tests 涵蓋等待前一筆 settled 與 rejection 後續跑；本機 32 files／286 tests、lint、typecheck、build、check:build 全數通過。
- 下一項是需要 MCP 的 DP-026。必須等 DP-062 PR 由專案擁有者親自合併後，從最新 `main` 開始，並先依下方規則做 read-only preflight。

---

## 1. 交接當下已驗證的狀態

**本機五項驗證全部通過**（`main`，工作目錄乾淨、build 無 drift）：

```
npm run lint        ✓
npm run typecheck   ✓
npm run test        ✓  29 files / 259 tests
npm run build       ✓
npm run check:build ✓  7 text assets, no runtime remote dependency, CSP present
```

CI（`.github/workflows/ci.yml`）在 PR 與 `main` 的 push 上跑同樣五項，不使用任何 secret。

**遠端 Supabase**（狀態承自 DP-021／022／029，DP-012 之後**沒有再對遠端下過任何 DDL**）：

- `supabase/migrations/` 有 4 個 migration，皆已套用到遠端，檔名與遠端 migration history 一致：核心 schema、owner RLS、advisor hardening、calendar child `NO ACTION` 對齊。
- 9 張 exposed table 均啟用 RLS 與 owner CRUD policies，`anon` 無 table privileges。
- `supabase/tests/database/daypop_owner_rls.test.sql` 的 5 項 rollback pgTAP 已驗證 owner read/write、跨帳號隔離、child ownership 與帳號刪除 cascade。
- Supabase security advisor：0 警告。
- `src/lib/database.types.ts` 是 generated types，與上述 migration 一致。

**尚未完成、且不屬於 MCP schema 工作的人工設定**（DP-023 剩餘部分）：Google OAuth client、Supabase 的 Google provider 開關、production redirect allowlist。需要時提醒專案擁有者自行設定，**不得要求或輸出任何 secret 值**。

---

## 2. 這台機器的環境限制

- **沒有 Docker。** `npm run supabase:start`／`supabase:reset`／`supabase:test`（local）都跑不起來；目前 CLI 2.111.0 的 `npm run supabase:test:linked` 也會以 Docker prerequisite 終止。可用 MCP 執行 repo 同一份、固定假資料且完整 rollback 的 pgTAP 安全測試，但 transaction 內的暫時 extension 必須一起回滾並另行確認；不可把它寫成「pgTAP CLI 已通過」。安裝容器 runtime 前請先問過專案擁有者。
- **含中文的檔案不要用 PowerShell 讀取－取代－寫回**，Windows PowerShell 5.1 會以 ANSI codepage 讀入並把中文寫成亂碼。用 Write／Edit 工具改檔。
- Playwright 不是專案相依，過去的視覺驗證是從 npx cache 直接 import 的一次性腳本。

---

## 3. 開工前必須先知道的四件事

### 3.1 `SupabaseDayPopRepository` 存在，但**沒有接進 App**

`src/data/supabaseRepository.ts` 已完成並通過 stub client 單元測試，但 `DataProvider` 目前**永遠**使用 `LocalDayPopRepository`。登入只建立 session，資料仍只在本機。把 adapter 依 session 接上是 **DP-026**，不是 DP-024 的順手工作。

它刻意會丟兩種錯：`AccountNotBootstrappedError`（DP-024 後代表遠端 drift、帳號初始化失敗或資料被異常刪除；adapter 仍不做第二條 bootstrap 路徑）與 `RemoteDataError`（伺服器拒絕／失敗，與 domain validation 失敗分開）。不要為了讓畫面跑起來而在 adapter 裡補建預設日曆。

### 3.2 DP-062 已在 DP-026 前完成

`DataProvider` 已採單一 promise queue 序列化所有 repository mutation。這同時保護 React snapshot 與 durable store，不是只在畫面丟棄 stale response；rejection 也不會毒化 queue。`src/data/DataProviderRace.test.tsx` 已釘住呼叫順序與失敗後續跑。DP-026 不得移除此保護或另開並行寫入路徑。

### 3.3 `month_weeks` 暫時相容編碼已由 DP-018 收掉

第五檔 migration 已將 `6` 轉為 fixed-six、`4`／`5` 轉為 adaptive，runtime mapping 現在只理解 `fixed_six_week_grid boolean`。Domain、UI、`buildMonthGrid`、repository 與 generated types 均已更新；後續任務不得重新引入數字列數或用預設覆寫既有主題。

### 3.4 DP-027 已落實 DP-063 定下的時間規則，後續不得回退

跨日順延必須**在目標日期上重新解析同一個牆上時鐘**，不能對 instant 加固定 24 小時 — DST 當晚的本地日是 23 或 25 小時。詳見 [`architecture-decisions.md` §6 的 DP-063／027 實作結果](architecture-decisions.md)。`src/domain/recurrence.ts` 先產生日曆欄位，再逐次經 `wallTimeToInstant()` 解析；「隔天的同一個時間」不是加 86400000 毫秒。回歸測試在 `src/domain/eventTime.test.ts` 與 `src/domain/recurrence.test.ts`，後續 repository／UI 接線不得改回固定位移。

---

## 4. MCP 的使用界線（重述，因為違反的代價最高）

以下規則來自 `AGENTS.md` §10 與 `tasks.md` 的交接表，MCP 階段全程適用：

- **不得透過 MCP 直接執行 DDL。** 所有 schema 變更必須先存在於 `supabase/migrations/` 的檔案，再由可追蹤的 migration workflow 套用。
- **不得對遠端執行 reset**，也不得查詢或修改正式使用者資料。
- MCP 只用於：任務必要的專案狀態檢查、read-only schema／advisor 驗證、安全測試。
- **不得以 Dashboard 手改 schema** 當作事實來源。
- 前端不得持有 `service_role` 或任何伺服器密鑰；只使用 project URL 與 publishable key。
- 永遠不要印出 secret 值 — 只檢查存在性。

---

## 5. 下一段的第一步

1. 不得在 DP-062 PR 合併前開始 DP-026；專案擁有者親自合併後，從最新 `main` 建立 DP-026 的獨立分支。
2. 依 AGENTS.md §8 把 DP-026 從 `Next` 移到 `In Progress`。
3. 開工前先用 MCP 做 read-only preflight：repo／remote 應同為 8 檔、bootstrap trigger 與 private function 權限仍正確、9 張 public tables RLS 全開、advisor 仍為 0；有 drift 就停止。
4. DP-026 使用獨立中文 PR，並明寫 `--base main`；只驗證 authenticated adapter、RLS、重載、裝置快取與跨帳號隔離，不得把 legacy import 或 Storage 附件混入。

## 6. 不需要 MCP 也能做的事

若要先暖身或 MCP 額度需要保留，這幾項不碰遠端：

- **DP-064** — 跨午夜行程在月格衝突偵測與週檢視色塊的呈現（需要產品決策，不是還原原稿）。
- **DP-030** — Playwright e2e。
- **DP-019** — PWA 安裝圖示（PNG／Apple touch icon）。
- **DP-065** — `release-notes.json` 仍停在 v0.2.0，落後整個日曆搬移（需要專案擁有者的發布決策）。
- **DP-035** — 自動版本檢查節流。
