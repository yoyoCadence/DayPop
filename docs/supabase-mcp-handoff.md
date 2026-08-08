# Supabase MCP 階段交接 — 2026-08-08

給接手 Supabase MCP 階段的 agent。`tasks.md` 的「建議執行順序」停止點已於 2026-08-08 抵達，專案擁有者確認改由可使用 MCP 的 agent 接手。

這份文件**不重複**已經寫在別處的內容，只記錄交接當下的狀態、你必須先知道的前置與陷阱。canonical 來源仍是：

- [`../AGENTS.md`](../AGENTS.md) — 協作契約、執行模式、範圍控制、安全基線、§0.1 目前技術狀態。
- [`../tasks.md`](../tasks.md) — 任務板與「建議執行順序」表（含每一項的 MCP 使用規則）。
- [`architecture-decisions.md`](architecture-decisions.md) — 跨模組決策；DP-018／027／036 直接依賴 §3 與 §6。
- [`claude-design-source-of-truth.md`](claude-design-source-of-truth.md)、[`prototype-behavior-baseline.md`](prototype-behavior-baseline.md) — UI 不變條件與搬移狀態。

基準 commit：`ac5f564`（PR #28 合併後的 `main`）。

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

- **沒有 Docker。** `npm run supabase:start`／`supabase:reset`／`supabase:test`（local）都跑不起來。要對已連結的專案驗證，用 `npm run supabase:test:linked`（需先 `npx supabase link --project-ref <ref>`）。安裝容器 runtime 前請先問過專案擁有者。
- **含中文的檔案不要用 PowerShell 讀取－取代－寫回**，Windows PowerShell 5.1 會以 ANSI codepage 讀入並把中文寫成亂碼。用 Write／Edit 工具改檔。
- Playwright 不是專案相依，過去的視覺驗證是從 npx cache 直接 import 的一次性腳本。

---

## 3. 開工前必須先知道的四件事

### 3.1 `SupabaseDayPopRepository` 存在，但**沒有接進 App**

`src/data/supabaseRepository.ts` 已完成並通過 stub client 單元測試，但 `DataProvider` 目前**永遠**使用 `LocalDayPopRepository`。登入只建立 session，資料仍只在本機。把 adapter 依 session 接上是 **DP-026**，不是 DP-024 的順手工作。

它刻意會丟兩種錯：`AccountNotBootstrappedError`（帳號沒有預設日曆 — 建立預設資料是 DP-024 的責任，adapter 不做第二條 bootstrap 路徑）與 `RemoteDataError`（伺服器拒絕／失敗，與 domain validation 失敗分開）。不要為了讓畫面跑起來而在 adapter 裡補建預設日曆。

### 3.2 **DP-062 必須在 DP-026 之前決定**

`DataProvider` 的寫入是 fire-and-forget，兩筆同時在途時**最後 resolve 的會覆蓋畫面**，即使它比較早發出。本機 adapter 依呼叫順序 resolve 所以現在不會發生，**遠端 adapter 一定會遇到**。`src/data/DataProviderRace.test.tsx` 已用 characterization test 釘住現況。要在接遠端前決定策略（序號丟棄過期結果，或改為序列化寫入），不要讓它預設帶著這個行為上線。

### 3.3 `month_weeks` 目前是暫時相容編碼，DP-018 要收掉

`src/domain/databaseMapping.ts` 現在把 DB 的 `month_weeks` 編碼成 domain 的 `calendarGridMode`：`6` → fixed-six，`4`／`5` → adaptive，寫回 adaptive 暫用 `4`。DP-018 要以 migration 改成語意明確的 `fixed_six_week_grid`，同時更新 domain、UI 與 `buildMonthGrid` 測試，並**重新產生 generated types**。既有使用者已保存的偏好不得被預設值覆寫（AGENTS.md architecture constraints）。

### 3.4 DP-027 要沿用 DP-063 定下的時間規則

跨日順延必須**在目標日期上重新解析同一個牆上時鐘**，不能對 instant 加固定 24 小時 — DST 當晚的本地日是 23 或 25 小時。詳見 [`architecture-decisions.md` §6 的 DP-063 實作結果](architecture-decisions.md)。recurrence occurrence 展開適用同一條規則：「隔天的同一個時間」是日曆運算，不是加 86400000 毫秒。回歸測試在 `src/domain/eventTime.test.ts`，請不要在重構時把它改成固定位移。

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

## 5. 建議的第一步

1. 讀 `tasks.md` 的「建議執行順序」表第 6 列之後，以及 Backlog 中 DP-018／036／027／024／026／025／028 的完整描述。
2. 依 AGENTS.md §8 把 DP-018 從 `Next` 移到 `In Progress` 再開始。
3. 先用 MCP 做 **read-only** 的專案狀態核對（migration history 是否仍與 repo 的 4 個檔案一致、advisor 是否仍為 0 警告），確認交接狀態沒有漂移，再動手寫 migration。
4. 一個任務一個中文 PR，`--base main`，等專案擁有者親自合併後再開始下一段。

## 6. 不需要 MCP 也能做的事

若要先暖身或 MCP 額度需要保留，這幾項不碰遠端：

- **DP-064** — 跨午夜行程在月格衝突偵測與週檢視色塊的呈現（需要產品決策，不是還原原稿）。
- **DP-030** — Playwright e2e。
- **DP-019** — PWA 安裝圖示（PNG／Apple touch icon）。
- **DP-065** — `release-notes.json` 仍停在 v0.2.0，落後整個日曆搬移（需要專案擁有者的發布決策）。
- **DP-035** — 自動版本檢查節流。
