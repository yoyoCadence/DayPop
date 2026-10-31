# 提醒訂閱與投遞資料邊界（DP-220）

2026-10-31 從 DP-219 PR #216 合併 `de39957` 接續。第一版產品與時間契約沿 [提醒設計](reminders.md)；本段只有可重建的資料庫及驗收腳本，沒有 sender、App 權限入口、真正推播或發布。

## 資料與權限

第 20 份 migration `20261029123000_reminder_delivery.sql` 獨立新增四表，皆開 RLS；個人 v4、JSON／ICS、既有十九份 migration 與 0.4.6 公告不變。

| 資料 | 存取與生命週期 |
| --- | --- |
| `calendar_reminder_settings` | 每個接收者／日曆一列，以本人 RLS 讀取；僅經 `set_calendar_reminder` 寫入。當下仍可讀的 view／edit／本人日曆均可自行開啟；空 offsets 關閉且撤權後仍能刪除自己的設定。最多 200 本，offset 0–10080／最多十個，時區沿既有 DB 驗證。 |
| `reminder_push_devices` | 每人最多十台；client 只可讀自己的 id／user_id／時間，不能 SELECT endpoint 或任何加密 key，直接 DML 也拒絕。註冊只接受指定 HTTPS push host 與有界 key 格式，需有已啟用且五分鐘內 heartbeat 的後端。 |
| `daypop_reminders.configuration` | 私有 schema、預設 disabled；不含 VAPID private key 或排程 token。登入者只能透過 capabilities 得知可用狀態／public key。未收到 heartbeat 不顯示 enabled。 |
| `daypop_reminders.deliveries` | 私有 schema，裝置＋SHA-256 工作 hash 唯一。只保留 fire／expiry、status、lease／attempts，不留事項文字／id 或 endpoint 歷史；裝置刪除 cascade，heartbeat 清掉過期超過一天的紀錄。 |

設定寫入以 account advisory lock＋expected updated_at 拒絕舊版本。端點註冊另鎖 endpoint，原裝置同帳號重試沿用 id／啟用界線；切換帳號必須提供一致的 endpoint、p256dh 與 auth 能力，再建立新 id／註冊時間並 cascade 舊投遞。僅知道 endpoint 不能接管；舊帳號不能撤銷新帳號的 id。

## 服務 RPC

`reminder_sender_page` 每頁最多 100 台並可用 UUID 游標續讀。`reminder_sender_context` 依 DB 所有的接收者暫設授權身分，沿既有 `calendar_access`／event graph／todo ancestry 判斷，完成或例外時還原原身分。保留整個跨日曆 replacement 圖，沒有啟用來源日曆也不會漏掉移入事項；私人／未分享節點沿原規則隱藏整組，私人父待辦的後代亦隱藏。

快照只含排程必要欄位，標題固定 `DayPop`、地點／備註 null；不查附件或聯絡資訊。每本超過 5,000 events／10,000 exceptions／5,000 todos 拒絕，不截斷假稱完整。版本 hash 包含快照的更新版本、提醒設定與裝置界線；標題雖剝除，其 updated_at 仍可使舊版本失效。

`claim_reminder_delivery` 重新取得當下授權與版本，檢查五分鐘有效窗、裝置／設定啟用界線，再以唯一鍵取得 30 秒 lease。等待裝置鎖之後才讀 clock，不能用鎖前時間接受已過期工作。sent／failed 不重送，sending／retry 只在 lease 到期後重取，最多四次。`finish_reminder_delivery` 只接受當前 lease 的結果；gone 移除失效訂閱，舊 worker 不能刪掉新 lease。claim／finish 都按裝置→ledger 鎖序，服務不持有 DB transaction 等待網路投遞。

以上 sender RPC 只授權 `service_role`，並另檢查呼叫 role；使用者 id／JWT claim 不會授予 sender 權限。claim 把能力資料回傳給受信任服務端，後續 sender 必須使用真實 planner 工作、立即 claim、再受限送出並回報結果。這些 RPC 本身不計算 RRULE、不發送 HTTP，也不保證 push service 已接受的 OS 佇列能撤回。

## 驗證與本機指令

- 獨立 `DayPopReminders` stack（API 56321／DB 56322），沒有 linked project；從二十份 migration reset 成功，本機 public types 真正重新產生。
- 通知 59 項 pgTAP；連既有共 11 檔 445 項通過，皆 rollback。覆蓋 RLS／column grants、disabled／heartbeat、資料約束、CAS、私人／跨日曆圖、送達終態、重試、key rotation、撤權與 gone 清理。
- 11 組真實本機 Auth／PostgREST：兩個隨機已確認假帳號真正密碼登入，正式 family／repository 建立共用與單次移動，服務快照送進真正 planner；再驗證版本／完成／私人／撤權／帳號轉移。完全沒有向 push endpoint 發出請求。日期時刻用同一完整 UTC instant，包含 UTC 午夜邊界。
- 三組獨立連線競態：兩個已阻塞 sender 只取得一份持久 lease、兩個舊設定只一筆提交／另一筆 conflict、等待鎖跨過 expiry 不產生投遞。
- 分別移除「版本比較」及「目前日曆權限」後，HTTP 在指定的獨立案例失敗；finally 精確還原 DB function 定義，再恢復正常驗收。負控制腳本不改 source file，不接受遠端 DB 名稱。
- 完整 1,451 單元＋39 Node、lint／typecheck／migration 結構／Pages build／check:build 過，原預算不變；既有家庭 HTTP 17/17 通過。

CI database job 沿同一個無 secret 的本機 stack，加入以下 scripts；原四 gate／runner／逾時／既有 RLS 負控制與競態不變：

```powershell
npm run supabase:test
npm run supabase:test:reminders
npm run supabase:test:reminder-concurrency
npm run supabase:test:reminder-controls
npm run supabase:types
```

本機若使用專用 stack，HTTP 的 `DAYPOP_HTTP_WORKDIR` 與 `DAYPOP_REMINDER_DB_CONTAINER=supabase_db_DayPopReminders` 必須成對；腳本同時核對 API port 與 DB 名稱。CLI status 只在 Node 記憶體解析，local admin key 不輸出、不寫入 repo。假帳號在 finally 清除，設定還原為 disabled。這些命令需要已啟動的 Docker；正常 `npm test` 不需要 Docker。

## 接續與正式啟用界線

2026-10-31 更新：DP-220 PR #217 的最終 head `e77f336` 四 CI（`41137809578`）與同 head 審查 completed 無發現、無未解決討論後合併 `3fa93e6`。DP-221 已將受保護入口與投遞核心接到這些 RPC，HTTP 增至 15 組；實際 Edge／VAPID／網路 adapter 另列 DP-222，詳 [核心交接](reminder-delivery-core.md)。下方是本段原交接界線，正式操作仍未執行。

DP-220 自己的四項 CI、同 head 完成審查無發現且沒有未解決討論後才合併。接續 DP-221 是受保護 sender：受限網路、VAPID／服務驗證、剩餘 TTL、穩定 tag／hash、重試分類、容量與不含敏感資料的錯誤，再接 App／worker。

本段沒有套用遠端 migration、設定秘密、cron 或 deploy。公開仍為 0.4.6／遠端仍沿既有十九份對齊證據，未做新的 remote drift 或帳號查改。正式啟用前需另準備 migration workflow、必要秘密與排程、前端訂閱／登出撤銷、真實瀏覽器及真機收信驗收，再依既有界線具體放行；DP-042／DP-034 尚未完成。
