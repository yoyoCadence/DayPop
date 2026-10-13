# v0.4.2 部署與資料庫驗收紀錄（DP-149）

2026-10-12 已完成圖片交接所要求的「先推 migration，再部署」。2026-10-13 依專案擁有者明確授權合併 PR #136，並補入此可追溯紀錄。這份文件記錄已完成的動作，本 PR 不再次推資料庫或部署。

## 部署版本

- [Deploy staging 38259974848](https://github.com/yoyoCadence/DayPop/actions/runs/38259974848) 的品質檢查、資料庫、e2e、Pages build／publish 五項均成功；部署的是當時 `main` 的 `e7c95edc45ed5958d007682fb8597f317db29535`。
- 公告閘門確認 0.4.2 取代 0.4.1，0.4.1 公告保持不變。**0.4.2 自此也屬已部署歷史公告，不可回寫。**
- [PR #136](https://github.com/yoyoCadence/DayPop/pull/136) 僅更新任務板，原 [CI 38255329503](https://github.com/yoyoCadence/DayPop/actions/runs/38255329503) 三項成功；2026-10-13 合併 commit 為 `68368bdab49850151859834e9a00647cf273a937`。合併與上述部署是兩件已完成的動作。

## 資料庫

1. DayPop 專案為 ACTIVE_HEALTHY。CLI `migration list --linked` 查到原為 14 檔，確認第 15／16 檔都尚未套用。
2. 正式 CLI dry-run 正好列出 `20260830000000_event_occurrence_rpcs.sql` 與 `20261007000000_delete_calendar_rpc.sql`，再以 `db push --linked` 套用；沒有 MCP 正式 DDL、remote reset、seed 或 roles 更新。
3. 遠端與 repo 同為 16 檔；再次 dry-run 已無待套用 migration。
4. 三支 RPC `cancel_event_occurrence`、`replace_event_occurrence`、`delete_calendar_with_reassignment` 均為 SECURITY INVOKER、空 `search_path`，`anon` 無 execute、`authenticated` 有 execute。公開 schema 的 10 張表全開 RLS。
5. MCP 在單一交易內執行 repo 原有 `delete_calendar` 24 項與 `event_occurrence_rpcs` 15 項 pgTAP，39 項全部通過並完整 rollback；之後固定假帳號／日曆皆為 0，pgTAP extension 與測試 trigger function 不存在。這是隔離假資料測試，沒有登入或查改正式使用者內容；不是 CLI `test db` 的執行紀錄。
6. 遠端 generated types 排除 `__InternalSupabase` 並正規化五個通用 helper alias 的冗餘括號後與 repo 一致，schema／RPC 無 drift；沒有覆寫 repo types。
7. Security advisor 前後皆只有既有的 Auth 洩漏密碼保護未啟用警告，沒有新增 schema 警告，也沒有改 Auth 設定。

## 線上瀏覽器 smoke test

在 [DayPop staging](https://yoyocadence.github.io/DayPop/) 以隔離 Chromium 的 390×844 與 1280×900 驗證：HTTP 200、v0.4.2、六條最終公告、四分頁與 Google 登入入口可見，檢查更新回覆已是最新，沒有水平溢出，console error／warning 與 pageerror 都為 0。手機沒有桌面展示框，兩種尺寸的公告與按鈕均完整可見。

CSP meta 存在，service worker 與 manifest 的 scope／start_url 為 `/DayPop/`，五個 manifest 圖示與 Apple touch icon 均 HTTP 200。手機新增遊客行程再 reload，原始 `daypop.user-data` envelope 逐字相同，公告不重複。部署 e2e 173 passed、7 個既有 skipped；線上兩種尺寸都印出實際 `Intl.DateTimeFormat().resolvedOptions().timeZone = Asia/Taipei`，沒有只依環境設定推定時區。Supabase 不帶 key 的 health endpoint 回應 401，服務可連線。

一次性腳本、完整操作紀錄與六張截圖保存在本機 ignored 的 `output/playwright/pr136/`；這不是 GitHub artifact 下載連結。

**限制：** 沒有真實帳號登入／重新登入的操作，也沒有實機 iOS／Android 驗證。DP-034 正式放行與 DP-032／077 真機限制仍保留；不能將部署成功當成它們已結案。DP-144／145 後續文字修正不在這次部署的 commit 內。
