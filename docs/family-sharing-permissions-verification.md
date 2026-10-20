# 家庭分享權限驗證（DP-049，2026-10-20）

基線是 DP-048 PR #167 合併的 `7c795b9`。其最後提交 `f9773ff` 的 [CI `39342697282`](https://github.com/yoyoCadence/DayPop/actions/runs/39342697282) 三項全過，完整 e2e 245 passed／13 skipped。第 18 檔已由擁有者 CLI 套用；本項只增加驗證、CI 與交接，不改產品程式、schema、generated types、v4、App 0.4.3 或公告，也不部署。

## 身分與權限矩陣

`supabase/tests/database/family_sharing_permissions.test.sql` 使用五個固定假帳號 `...0491`–`...0495`。A 是家庭 owner，B 是日曆 owner／家庭 member，C／E 是 member，D 是非成員。B 有 edit、view、未分享日曆；家庭 owner 與日曆 owner 刻意由不同人擔任。

| 操作 | 日曆 owner B | 收到 edit 的 A／C／E | 收到 view 的 A／C／E | 非成員 D |
| --- | --- | --- | --- | --- |
| 讀取非私人事項 | 可 | 可 | 可 | 不可 |
| 讀取 B 的私人／未分享事項 | 可 | 不可 | 不可 | 不可 |
| 新增／修改／完成／刪除可見事項 | 可 | 可，需版本與完整可寫子樹 | 不可 | 不可 |
| 更改 B 的分享設定或整本日曆 | 可 | 不可 | 不可 | 不可 |
| B 的附件、聯絡資料、貼圖、Storage metadata | 可 | 不可 | 不可 | 不可 |
| 把建立者身分當成私人存取權 | 不適用 | 不可 | 不可 | 不可 |

74 項直接在 Postgres 以 `SET LOCAL ROLE authenticated` 與固定 caller 執行，沒有前端篩選或假 RLS。涵蓋：

- SQL 與 RPC 的非成員／view 拒絕、edit 真實 CRUD、待辦完成與完整子樹刪除、過期版本拒絕。
- family owner 不越權、user-editable metadata 不能升 owner、membership DML／日曆改名與整本刪除拒絕。
- server 決定 owner／author，ownership／作者不可重寫；原作者也不能讀後來設為私人的事項，刪除作者帳號不抹除別人日曆的原列。
- private 待辦祖先／子項、已知私人 parent ID 的新增拒絕、view replacement 使整個重複系列不可寫。
- client-owned 暫時 context 在 definer 寫入前被拒絕，偽造 GUC 無效，可信 context 沒有 client DML grant且綁 caller；internal graph 不可執行。
- 降為 view、關分享、退出、移除分享 owner、解散都依當前 DB membership／grant 判斷，不依賴 JWT refresh；重加不復原本人的舊 outgoing grant。
- 收到的分享不開放 profile／preferences、附件、聯絡資料、貼圖或 Storage object metadata。

## 本機負控制與回歸

本項是驗證既有防護，沒有宣稱發現新的產品缺陷。`scripts/test-family-permissions-control.mjs` 只接受本機 Docker `supabase_db_DayPop`，不接受 URL／linked flags；它把暫時的寬鬆 events SELECT policy 注入**測試 transaction**，不修改 migration 或 baseline 測試檔。

實跑兩輪均為：寬鬆 policy 令相同矩陣 **8 項如預期失敗** → rollback → 未改的 baseline **74／74 通過**。固定 users 與 policy 前後皆 0，extension 狀態不變。這證明矩陣會抓到 RLS 放寬，不是只驗證前端看不到資料；負控制腳本**不得在遠端執行**。

本機已實跑 `supabase:start`（比照 CI 排除 HTTP 服務，只啟動 Postgres）→ `supabase:reset` → `supabase:test`：9 檔 **376 pgTAP 通過**。`supabase:test:permissions` 負控制、家庭最後席位與共享 CAS 的兩個競態腳本均通過並清除假資料。`supabase:types` 重新產生後零 diff，型別以本機為準。

lint、typecheck、完整 1,312 單元＋7 Node、build、check:build 通過。輸出仍為 JS 734,390 raw／215,664 gzip、CSS 111,244 raw／27,088 gzip bytes，沒有提高 budget。相關家庭／分享 e2e 為 **17 passed／1 skipped**，使用明確空的 `VITE_SUPABASE_URL`／`VITE_SUPABASE_PUBLISHABLE_KEY`，瀏覽器實際時區印出 `Asia/Taipei`；最新完整 CI 仍須通過才合併。

## 遠端同份 rollback

只用 MCP 執行 repo **同一份** baseline SQL，不執行負控制腳本。`finish()` 回 `1..74`，沒有 failure diagnostics；整份 BEGIN／ROLLBACK 包住假帳號、Auth bootstrap、家庭、分享、事項、Storage metadata、pgTAP extension 與三個 `pg_temp` fixture helper。

測試前後只查固定假 IDs：五個 users、groups、calendars、events、todos、shares、Storage metadata 皆 0，context／write context／三個 helper 不存在，pgTAP extension 前後皆不存在。沒有查改正式使用者內容、remote reset、migration DDL 或 agent CLI push。

前後 schema metadata 完全一致：18 檔 migration、14 張 public tables 全 RLS、46 policies；remote public types 與新產生的本機檔逐字一致，遠端輸出只放忽略的 output，未提交 Internals。security 仍只有既有 [Auth leaked-password WARN](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)；performance 仍有既有的 [複合 FK covering-index INFO](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)（理由見 handoff §0.13），unused-index INFO 在本次 rollback 後為 6，僅為統計變化，沒有刪改索引。

## 剩餘界線

這是 SQL 權限與既有 UI 流程的驗證，不代表已部署家庭前端。真實帳號／OAuth／真機／staging 尚未驗收；沒有新增 Realtime、離線寫入佇列或自動合併衝突。DP-049 不需 migration 或擁有者再 push；部署仍須由擁有者另行決定，先 migration 再前端的順序不變。
