# 可靠背景提醒（DP-042）

2026-10-29 擁有者指定先做提醒。既有個人／家庭日曆、v4、十九份 migration 及公開 0.4.6 為起點。以下是依委託採用的第一版範圍，不將尚未接線的段落稱為上線。

## 第一版使用方式

- 每個人自行在每台裝置開啟 Web Push，再逐本選擇要提醒的日曆。自己的及仍有權限的共用日曆皆可選；加入家庭、收到分享、歷史資料中的 reminderMinutes 都不會自動開啟通知。
- 每本日曆設定提前分鐘數（0–10080、最多十個）、日期事項時刻（預設 09:00）及 IANA 時區；待辦可另選一併提醒。空分鐘陣列表示關閉，預設無任何已開啟的日曆。
- 設定套用該日曆中可讀的既有及未來事項。第一版是日曆層級設定；舊 event.reminderMinutes／defaultReminderMinutes 原樣保存，尚不提供逐筆覆寫。
- timed 行程按完整開始 instant 計算；跨日及多日仍只提醒一次開始。全天用起始日及接收者指定時刻／時區，多日不逐日重播。待辦只處理有日期且尚未完成的項目，父子完成獨立。
- 分享者不替接收者開通知；view 也可設定自己的提醒，不改原事項或別人的偏好。撤權、私人事項、私人祖先及私人 replacement 圖必須依當下權限收起，不能只信任前端。

## 執行與時間契約

1. Supabase Cron 每分鐘呼叫受專用服務憑證保護的 Edge Function。後端以新讀取的接收者可見快照計算工作，不依賴網頁 timer。
2. `src/reminders/schedule.ts` 共用 canonical `resolveEventOccurrences`、exception 圖、`eventOccurrenceKey` 及時區轉換，不另寫 RRULE 展開。快照須先由資料庫授權；planner 不是授權邊界。
3. 每輪只接受 `fireAt <= now < fireAt + 5 分鐘`。關閉 App 仍由伺服器排程；停機超過此窗不補發陳年通知。發送 TTL 使用剩餘有效時間，裝置／網路／系統專注模式仍可能造成延遲，不能承諾精確到秒或必達。
4. fireAt 不能早於該日曆最後明確啟用／修改提醒或事項建立時間；每台裝置還需以自己的註冊時間作邊界。不為新啟用或匯入資料回補已過提醒。
5. 全天／待辦的牆上時刻在春季 DST 不存在時略過該次；秋季重複時刻只採 canonical 轉換選到的一次。timed recurrence 沿原 event timezone，不加固定 24 小時。
6. 工作身分包含類型、日曆、source id、canonical occurrence、fireAt 與 offset；標題編輯不創造新的通知，移動到不同提醒 instant 才是新工作。每個接收者／裝置以相同身分持久去重，重試及 lease 恢復也沿用同一 notification tag。
7. 每次發送前重新驗證有效訂閱、提醒設定版本、資料版本、分享與例外／完成狀態；登出／關閉裝置訂閱執行撤銷。推播服務已接受的 OS 佇列不能回收，所以通知不含私人內容。
8. 單本日曆計算無法展開或超過每輪一千個工作時整本 fail closed 並記錄問題，其他日曆繼續；不得截斷後假稱完整成功。

## 資料、隱私與金鑰

- 通知只顯示固定的 DayPop 一般提示；不帶標題、地點、備註、家庭名稱、Email、user id 或 event id。點擊固定回到自己 App scope，不接受 payload 的外部網址。
- 訂閱 endpoint 與加密 key 是秘密能力資料，不輸出到 console、回報或一般備份。只存有 owner RLS 的帳號通知資料，伺服器投遞資料只授權服務角色。不可讓客戶端直接叫跨帳號 sender。
- 通知偏好、裝置訂閱及投遞紀錄不放入 v4 個人文件／個人 JSON；既有資料備份、匯入、分享與 user-data write barrier 不改。新的通知表需獨立 migration、RLS、HTTP 及並行去重測試。
- VAPID private key 與排程服務 token 只留在受控伺服器秘密／Vault；前端只取得 public application key。伺服器只能請求明確允許的瀏覽器推播服務 HTTPS endpoint，不跟隨重新導向到其他服務。
- App 按鈕才請求系統通知權限；未登入、不支援、尚未安裝的 iPhone、拒絕授權、後端未啟用等狀態要明確說明，不能顯示假成功。沒有可靠背景能力的遊客不提供偽提醒 timer。

## 分段與目前證據

- **DP-219 審查修正（2026-10-30）：** PR #216 的同 head 審查指出跨日曆單次修改會丟掉來源系列，讓目的日曆整批提醒消失。planner 現在保留與該日曆相連的完整 exception 圖及來源查找，canonical resolver 展開後才依有效事項日曆選取；不展開不相連的故障日曆。新增 timed／全天雙向選取、來源未啟用、移入時間窗及獨立事項／待辦保留共三項回歸；原隔離案例另修正重複 fixture id。舊 planner 的三項新案例全部失敗，finally 精確還原；最終 33/33 並實際印出 UTC／America/New_York／Etc/GMT-8。完整 1,451 單元＋39 Node、lint／typecheck／build／check:build 過。最終 source SHA-256 `3dba5c1d037fc70f7fe442a096bb96557d529827c6294c9fb02864e180128905`；仍須最新 head 四 CI 及完成審查後才合併，公開提醒尚未接線。
- **DP-219：排程核心完成。** 新模組及三十項單元回歸，實作了時間窗、啟用界線、去重、時區／DST、取消／替換、最大 offset、全天／待辦、容量與資料最小化。測試實際印出 UTC／America/New_York／Etc/GMT-8；停用計算及拿掉 DST 不存在時刻防護均被測試抓到，finally 逐 byte 還原，最終 source SHA-256 `9431ae591f2171c2b0cfea353cbaffcd4911c8f4775bae149d575688c5bd68c7`。完整 1,448 單元／92 檔＋39 Node、lint／typecheck／build／check:build 過；原 budget 不變。尚未有 sender、UI、訂閱、migration 或真實推播。
- **DP-220：訂閱與投遞資料邊界。** 第 20 份 migration 預設停用，四表全 RLS；本人日曆規則與裝置能力分開，服務 RPC 沿既有分享／私人例外圖授權，包含跨日曆來源；五分鐘有效窗、版本／啟用界線、唯一 lease、重試／gone 清理及分頁。通知 59 項／完整 445 pgTAP、11 組真正本機 Auth／HTTP、三組多連線競態與兩個 finally 精確還原的負控制通過，既有家庭 HTTP 17/17。詳 [資料邊界、驗證與限制](reminder-backend.md)。自己的四 CI／同 head 完成審查後才合併，未套遠端 migration 或發通知。
- **下一段：受保護 sender（DP-221）。** 沿此資料邊界接 Web Push transport、服務驗證、去重／重試與失效訂閱清理；不把資料 RPC 當成已發出通知。
- **後續：App 與 service worker。** 裝置權限與訂閱、日曆提醒卡片、登出撤銷、固定通知／安全點擊及真正瀏覽器回歸。之後才準備正式設定、migration、cron、部署與真機收信驗收。

DP-219 不連線改正式帳號、不發通知、不放金鑰、不改資料庫或 0.4.6 公告。每段依擁有者既有授權開 PR，自己的四 CI／同 head 審查完成無發現及無未解決討論後合併。正式 migration／伺服器秘密／排程及前端發布仍需依既有界線，先完成可審核實作才請擁有者放行。

## 官方依據

- [Supabase Cron 與 Edge Function 排程](https://supabase.com/docs/guides/functions/schedule-functions)：可用 pg_cron／pg_net 呼叫伺服器，服務憑證放 Vault。
- [Supabase Edge Function 驗證](https://supabase.com/docs/guides/functions/auth)：區分使用者與服務呼叫，不能用公開 publishable key 授權 sender。
- [Apple／WebKit Home Screen Web Push](https://webkit.org/blog/13878/)：iOS／iPadOS 16.4 起 Home Screen web app 可用 Web Push，權限需由使用者動作觸發；仍採能力偵測。
- [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)：Push service 可喚醒 service worker，endpoint 是需保密的 capability URL。
