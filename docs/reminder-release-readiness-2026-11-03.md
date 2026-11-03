# 提醒與月曆聯合發布前置（DP-232）

2026-11-03。擁有者選擇提醒完成後與左右翻月／自動列數修正一起發布。PR #227 最終 `14a446e` 的四 CI `41645097826`、同 head 完成審查無發現、討論全解後合併 `9162b49`；Chromium 325 passed／19 skipped（20.1 分鐘）、WebKit 12、465 pgTAP／提醒 HTTP 22。這是後續的排程前置候選；App 仍 0.4.6，user-data v4 不變，沒有部署。

## 當日唯讀前置

| 項目 | 2026-11-03 實際結果 |
| --- | --- |
| 公開站台 | 0.4.6「漫畫手帳新風格」，2026-10-29；沒有發送提醒能力的發布證據。 |
| migration history | 遠端 19、原 repo 21，沒有 remote-only；尚缺 `20261029123000` 與 `20261031090000`。本段另加第 22 份 `20261103000000`。這是版本清單檢查，未冒充遠端 migration bytes／完整 drift 檢查。 |
| Edge Functions | 清單 0，沒有 `reminder-sender`；首次清單暫時失敗後單獨重讀成功。 |
| Edge 秘密名稱 | 四個必要名稱皆不存在；`ECE_KEYLOG` 亦不存在。只讀是否存在，沒有讀取或輸出值。 |
| extension／設定 | Vault 0.3.1 已裝；pg_cron 1.6.4、pg_net 0.20.4 可用但未裝。兩者已 preload，Cron 的資料庫為 postgres；提醒 configuration 尚不存在。 |
| 執行角色 | linked CLI query 的 effective role 為 postgres，供固定的管理者 job 使用。 |
| 正式 Data API | 公開 key 的兩次 GET、正確欄位、limit=0：cron／net 各回 406／PGRST106；未讀取任何資料列或執行函式。 |

沒有查改正式帳號、行程或訂閱內容。CLI 的初始化登入角色沿既有標準流程；SQL 查詢本身均為 read-only transaction。清理過的本機 fixture、未發布候選與 viewport 不代表實體 iPhone 收信。

## 第 22 份 migration 與 API 邊界

`supabase/migrations/20261103000000_reminder_scheduler_extensions.sql` 只安裝 pg_cron／pg_net。沒有 job、Vault 值、VAPID、configuration 啟用或個人資料寫入，也沒有更改原二十一份 migration。

擴充由 Supabase 平台的 supabase_admin 擁有；本機嘗試以一般 migration 撤回 net 的平台 grants 只得到 warning，已從候選移除。保留平台角色模型，App 的 Data API 仍只暴露既有 schema。新增真正 HTTP 回歸，對 anon／A／B 分別呼叫 cron／net，必須以 `PGRST106` 在 schema 邊界拒絕，沒有 job 或 HTTP queue；SQL cron 權限另有回歸。[自訂 schema 的 API 暴露規則](https://supabase.com/docs/guides/api/using-custom-schemas)。不將「平台 SQL 角色可執行 net」說成「App 可呼叫任意網路」。

## 可審核的啟停操作

- `supabase/operations/reminder-scheduler.sql`：單一原子 DO，需由 postgres 執行；project ref／action 未代入即拒絕。enable 要求兩個 Vault 名稱、URL-safe 43–256 token、合法 public key；不隱含換 key、不覆蓋同名的其他 job。同 key／同 command 重跑保留 job id 與健康資訊，停用後再開會重新取得健康狀態。
- job 固定 `daypop-reminder-minute-v1`、每分鐘、明確綁定已連結 project ref 的 HTTPS sender；Bearer 只在執行時讀 Vault，command 不含 token 值。只送空 JSON，55 秒 HTTP timeout 容納既有 45 秒輪次；sender 仍以自己的專用 token 驗證。[Cron／pg_net／Vault 排程](https://supabase.com/docs/guides/functions/schedule-functions)。
- disable 先關配置並清掉健康，僅移除本操作的相同 command；同名其他工作保留。日曆、提醒規則、裝置註冊與秘密不刪除；已被推播服務接受的 OS 佇列不能召回，仍只含匿名文字。
- `supabase/operations/reminder-status.sql`：只讀 enabled、公開 key 的短指紋、heartbeat／錯誤分類、job 計數與 cron 狀態，不讀秘密、HTTP headers／payload 或個人內容。Cron 的 success 只代表送交非同步 HTTP；需要持續更新的 key-bound heartbeat 才能判定 sender 健康。

pg_net 會暫存請求的 Bearer；DB 管理者可見，因此只使用專用排程 token，不能把廣泛的 service_role key 放入 job。App 不暴露 net schema，前端沒有任何 server secret。[官方排程的 queue 說明](https://supabase.com/docs/guides/functions/schedule-functions)。

## 正式執行順序（本段未執行）

依 [ADR §9](architecture-decisions.md#9-家庭群組與分享dp-0442026-10-18-定案)，migration 由擁有者 CLI dry-run／push，先 migration 再前端。提醒秘密、排程、啟用及前端發布需以完成的候選與既有授權具體放行；本段沒有 dispatch 或代推 migration。

1. 等本 PR 與 DP-233 版本候選完成四 CI／同 head 審查並合併後，擁有者在既有專案執行 `git pull --ff-only`、`npx supabase migration list --linked`、`npx supabase db push --linked --dry-run`。確認只多這三份提醒 migration，再執行 `npx supabase db push --linked`；不 reset 遠端、不 link 新專案。
2. 保留一組穩定 VAPID pair 與隨機的 32-byte base64url 專用 token。四個 Edge 名稱為 `DAYPOP_REMINDER_TOKEN`、`DAYPOP_VAPID_PUBLIC_KEY`、`DAYPOP_VAPID_PRIVATE_KEY`、`DAYPOP_VAPID_SUBJECT`；subject 用受控的 HTTPS 聯絡頁或 mailto。秘密放在專案外安全保存的 `.env`，以 `npx supabase secrets set --project-ref <既有 ref> --env-file <私密檔>` 安裝；不輸出值、不貼聊天、不用 VITE_，不設定 `ECE_KEYLOG` 或正式 `DAYPOP_REMINDER_ALLOW_LOCAL`。Vault 另存 `daypop_reminder_token` 與 `daypop_reminder_vapid_public_key`，須與同組 Edge 值相同；不把 private key 存進日曆或 cron command。[秘密管理](https://supabase.com/docs/guides/functions/secrets)。
3. 從合併的同一套 source 執行 `npm run reminders:check-bundle`，再 `npx supabase functions deploy reminder-sender --project-ref <既有 ref> --no-verify-jwt`。gateway 不驗一般 JWT 是既有設計，handler 仍必須驗專用 Bearer；無 token 或一般 user JWT 應為 401，不能用公開 key 充當排程權限。[自訂授權](https://supabase.com/docs/guides/functions/auth)。
4. 將下方模板代入既有 ref／enable 執行，隔至少一分鐘讀兩次 status：同 key 指紋、job 1／active 1、heartbeat 新鮮且持續更新、last_error 空。失敗即 disable，先排除設定問題。這只驗伺服器健康，未證明裝置已收到。
5. 才依已確認的聯合發布候選執行既有 Deploy staging；四 gate／build／publish 全過後，核對公開 artifact、真正 0.4.6 更新、v4 bytes／偏好／模式保存及兩 viewport。沒有把僅合併或本機候選當已發布。
6. iPhone 加到主畫面後，以本人確認帳號明確開通知及選日曆，建立未來幾分鐘的事項，關閉 App 驗收到固定「日蹦 DayPop／有日曆提醒，開啟日蹦查看。」；再驗點擊、重複／取消、停用、登出。另在自動列數快速跨 4／5／6 週月份、左右翻月複驗。需要實機結果才結案對應驗收。

### 由擁有者代入啟用／停用模板

此檔只有 ref 與 action，沒有秘密值；真正 token 只由 DB 讀 Vault。`$reminderAction` 明確選 enable 或 disable。不要手改編譯後 runtime、遠端既有 migration 或廣泛刪除 cron job。

```powershell
$reminderAction = 'enable' # 緊急停用改成 disable
$reminderProject = ([IO.File]::ReadAllText((Join-Path (Get-Location) 'supabase/.temp/project-ref'))).Trim()
if ($reminderProject -notmatch '^[a-z0-9]{20}$' -or $reminderAction -notin @('enable','disable')) { throw '請確認既有連結與操作' }
$reminderSql = [IO.File]::ReadAllText((Join-Path (Get-Location) 'supabase/operations/reminder-scheduler.sql'))
$reminderSql = $reminderSql.Replace('__DAYPOP_PROJECT_REF__', $reminderProject).Replace('__DAYPOP_REMINDER_ACTION__', $reminderAction)
$reminderOperationFile = Join-Path $env:TEMP ('daypop-reminder-' + $reminderAction + '.sql')
[IO.File]::WriteAllText($reminderOperationFile, $reminderSql, [Text.UTF8Encoding]::new($false))
npx supabase db query --linked --file $reminderOperationFile
npx supabase db query --linked --file supabase/operations/reminder-status.sql --output json
```

## 回復與驗證證據

需要回復時先以同模板 disable，確認 enabled=false；正常本操作的 active job 為 0。同名不同 command 會保留並明確 notice，sender 仍由 disabled 配置阻擋，不為了清掉計數而刪除其他工作。保留同組秘密及既有規則、裝置資料，再依既有 Pages rollback 流程處理前端。不要 drop pg_cron（會移除所有 job）、drop 新通知表或刪個人資料。未確認的停用／OS 既有佇列仍沿產品警告，不承諾即時回收。

目前本機證據：專用 DayPopReminders／56321–56322、沒有 link，原 21 migration bytes 相同再加第 22；reset 後 478 pgTAP／13 檔、真實兩帳號 HTTP 23/23，最後兩假帳號清理；public types 27,140 字元（只正規化換行）完全相同。SQL 操作 17/17（含 postgres 管理者、最大 token、未綁 key 恢復、LF／CRLF），實際操作中亦重放第 22 份 migration，job id／健康不變。所有 Vault／configuration／cron fixture 均在明確 rollback transaction，拒絕來源中的 commit／rollback；不曾提交 job 或送出 HTTP。撤掉 token 檢查、key 旋轉 guard、job 衝突 guard、停用配置四個控制均在指定案例失敗，finally source bytes 精確還原，最終操作 SQL SHA-256 `18653ca507ac6afebb29f4b2468d4bbf8759253c7daec5b386d665960e65ea9c`。

lint／typecheck／22 檔結構檢查、完整 1,802 單元／102 檔（113.40 秒）＋39 Node、Pages build／check:build／canonical bundle 過。本機 JS＋worker 795,818 raw／235,202 gzip、CSS 121,024／29,600，沿現有預算；此隔離工作區沒有正式 Supabase env。App source、PWA template、版號與歷史公告相對合併 main 零差異。新 database step 只執行本機 rollback 操作回歸；自己的最新四 CI／完成審查仍需通過。

最後以實際 CLI 執行單一 SELECT 的 status 與安全 disable；enabled=false、job／active job 0、健康與 key 指紋空。獨立 SQL 確認 users／families／calendars／events／todos／rules／devices／deliveries／jobs／HTTP queue／測試 Vault 各 0、configuration 全部還原，專用 stack 已停止。正式環境只做前述唯讀 metadata／GET limit=0，沒有執行這份啟停操作。

驗證設定曾修正兩個前置：CLI test 的相對路徑由 cwd 解析，改在 ASCII stack 目錄執行；pg_prove 只掛載測試目錄，不以無法讀到的跨目錄 `\ir` 假測冪等，改由 Node 載入實際操作 SQL。另修正 PostgreSQL 正規式 repeat 上限，以明確 length 配合 URL-safe 字元檢查實作相同 43–256 邊界，最大值／超長值皆實跑。隔離 worktree 最初用共用 node_modules junction，canonical 比對發現 28 行 dependency 路徑註解不同；精確還原探測產物並改用相同 lockfile 的獨立 npm ci 後，原守門通過。沒有升級 CLI 或依賴、改 user-data schema、既有公告、UI、timeout／worker／retry；database gate 只新增本機 rollback 操作步驟，仍四個 jobs、沒有外部秘密。
