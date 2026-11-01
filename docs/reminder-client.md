# 本人提醒資料服務（DP-227）

2026-11-01，從 DP-226／PR #222 最終 `645e59c` 四 CI `41271057932`、同 head 完成審查無發現且無未解決討論後合併的 `21ef5d3` 接續。這是 DP-223 的資料服務段落；尚未匯入 App UI，公開仍 0.4.6。

## 合約與身分

`src/reminders/reminderService.ts` 定義獨立的 `ReminderService` 與 Supabase adapter，不延伸個人 repository 或 v4 文件。capabilities 可單獨供後續權限 preflight；load 取得能力、本人規則及安全裝置 metadata。規則只走既有 CAS RPC，裝置只走註冊／撤銷 RPC；不呼叫 sender 或直接寫表。

- 每個操作先確認目前 session 的 user id 等於建構時的帳號，再把該次 access token 固定在每個 PostgREST request 的 Authorization header。未修改共用 client 的 header 或 session；token 只存在該次操作。
- 操作完成再核對帳號，拒絕帳號切換後的延遲回應。若共用 client 在送出前換成 B，A 的既有請求仍由 A 的 token 授權，不能悄悄替 B 註冊或改設定。
- 延遲寫入可能已在原帳號提交，拒絕其回應不代表回滾。這個 service 尚未負責撤銷生命週期；DP-228 必須處理進行中的註冊、登出前撤銷、外部帳號切換與無法確認撤銷的狀態，再接 App caller，不能只丟棄回應便宣稱裝置已停用。
- 這是前端身分路由防護；伺服器仍驗證 JWT，RLS／RPC 才是授權邊界。`getSession()` 不是伺服器端授權證據，後續 provider 只能為已確認 session 建立此服務，並丟棄卸載／換帳號的結果；不要在 Auth callback 內等待 Auth 方法。[Supabase getSession 說明](https://supabase.com/docs/reference/javascript/auth-getsession)。
- 對照目前安裝的 SDK，`setHeader` 複製單一 request 的 headers，fetchWithAuth 保留已提供的 Authorization；實際 SDK 序列化與真 JWT 切換回歸都驗證此行為。[SDK PostgrestBuilder](https://github.com/supabase/supabase-js/blob/master/packages/core/postgrest-js/src/PostgrestBuilder.ts)。

## 資料與錯誤

load 明列 owner filter／欄位及上限加一：規則 201、裝置 11，用來拒絕超過既有 200／10 限制的回應。裝置只 select `id,user_id,created_at,updated_at`；endpoint／p256dh／auth_key 不可讀。回傳投影只含 id／時間，移除未知欄位，並拒絕錯帳號、重複、缺欄、無效時區／分鐘／日期時間與超量，不能把故障當空設定。

能力保持後端的 enabled／publicKey／lastTick，不把過期 heartbeat 或殘留 public key 當成已啟用。setRule 保留 expectedUpdatedAt 的原始微秒／offset 字串，首次 null 才省略參數；非空回應必須符合送出的設定。關閉只接受同一本日曆與 null 版本確認，撤權後也能明確關閉本人規則。

裝置能力只作 transient RPC input，不進 snapshot／備份／log。client 與 sender 共用新 `pushEndpoint.ts` 的純允許清單；原政策與 delivery 的既有 export 不變，canonical bundle 只移動該函式位置並精確重建。沒有前端匯入 server runtime。

`ReminderError` 只提供固定文案及 invalid／unavailable／conflict／session／failed。缺少 function／table 的四種既有錯誤碼顯示尚未啟用；其他未知 SQL、provider、網路或能力資料不進錯誤文字／cause／console。request 明確停用 SDK 重試，未確認的 mutation 不宣稱成功、不自動重送。

## 證據

| 驗證 | 結果 |
| --- | --- |
| 新 service 單元 | 60 項，透過真正 supabase-js 與注入 fetch 驗證 select／owner／body／Authorization、回應投影、精確 CAS、關閉與裝置、錯誤、身分切換。UTC／America/New_York／Etc/GMT-8 實際列印，全部通過。 |
| 完整單元 | 1,647 項／97 檔＋39 Node 通過。 |
| 真正本機 HTTP | 原 16 組保留，新增 capability／metadata、規則 CAS／關閉、裝置重試／owner 移除、真正 JWT 切換四組，20/20。個人 repository projection 前後不變，沒有對 Push service 發請求。 |
| 身分競態 | 取得 A 的真 session 後、SDK 取 token 前切成 B；延遲結果被拒，獨立 SQL 確認實際裝置屬 A，恢復 A 後移除。僅使用該次兩個假帳號。 |
| 負控制 | 單元移除本人列、CAS、Authorization 固定；真正 HTTP 移除 CAS、裝置撤銷、Authorization 固定，各被新案例抓到。六輪 finally 精確還原，正常 HTTP 再過 20/20。 |
| sender 共用邊界 | canonical bundle／Deno check、9 項離線加密／key 與 2 項原生 loopback 網路測試過，實際 Etc/GMT-8。三時區 Deno 以自己的 Linux CI 為準。 |
| 本機清理 | 21 migration 逐 byte 對齊並 reset；本機 users／families／calendars／events／todos／rules／devices 各 0、配置停用及 key／heartbeat／error 清空，DayPopReminders stack 已停。未操作其他 stack 或遠端。 |

負控制後 service SHA-256 `4fbf9079916f1b4178ac874a01fb22662eabed27bdf26bc577d8ab954d9dcba7`。控制腳本與紀錄只留 TEMP，不輸出憑證或 subscription 原值。測試 harness 使用獨立 auth storage key，並替每個 HTTP 回應建立不同的 Response；不重用已讀 body 或壓掉 SDK 警告。

lint／typecheck／Pages build／check:build 通過。App 成品維持 `index-Dc_JOwIQ.js`，JS＋worker 756,605 raw／223,151 gzip bytes、CSS 119,746／29,361；與 DP-226 相同，既有上限未調整。這段沒有新的 rendered UI；瀏覽器完整回歸仍由自己的四 CI gate 驗證。

## 後續

自己的最新四 CI／同 head 完成審查無發現及無未解決討論後才合併。DP-228 接裝置能力偵測與明確權限／訂閱／撤銷，再接 canonical 設定 UI；服務目前沒有 App caller，DP-223／042 未完成。沒有 AuthProvider 接線、UI、使用者權限／訂閱、schema／migration、秘密／cron、版號／公告、正式操作或部署，不將本機 HTTP 當成 iPhone 收信驗收。
