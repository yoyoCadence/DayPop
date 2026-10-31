# 受保護提醒投遞核心（DP-221）

2026-10-31，接續 DP-220 PR #217 最終 head `e77f336` 的四 CI（`41137809578`）與同 head 完成審查無發現、無未解決討論後合併 `3fa93e6`。資料庫邊界沿 [DP-220](reminder-backend.md)；本段沒有新 migration，仍為二十份。

## 模組與執行流程

`src/reminders/delivery.ts` 提供三個可組合的服務端入口，不建立 client、不讀環境秘密，也沒有實際網路推播 adapter：

- `createReminderTickHandler`：只接受 POST 與格式正確的專用 Bearer token；比較固定長度 SHA-256 結果後才呼叫 runtime factory。未設定 token 回 503，未授權回 401；一般使用者 JWT、公開 key 與格式正確的錯誤 token 都不能啟動工作。body 只接受空白或空 JSON object，不接受 caller 指定帳號、日曆或工作。所有回應 `no-store`，只回彙總／固定錯誤，沒有能力資料或原始錯誤。
- `createReminderStore`：包住 DP-220 的服務 RPC，每個請求有十秒 timeout。client 由受保護 factory 提供；拿使用者 client 呼叫仍會被 DB 拒絕，endpoint token 不會提升其資料庫權限。錯誤回傳固定代碼，不轉印 SDK error、key 或 endpoint。
- `runReminderTick`：按每頁至多 100 台的嚴格 UUID 游標讀取；檢查回應形狀、容量、例外參照及待辦祖先完整性，然後交給既有 canonical planner。單本異常記錄 planning，其他日曆仍繼續；撤權／停用回傳 null 時直接略過。

工作 key 使用 SHA-256，投遞前再次經 DB claim 檢查目前版本／權限與啟用界線。未取得 lease 不呼叫 transport；取得後重讀 clock，以剩餘有效時間算 TTL，並將絕對 expiry 與有界 AbortSignal 交給 adapter。adapter 必須遵守 signal、禁止重新導向，且加密完、真正送出前重新縮短 TTL；這些實際網路條件留給下一段驗證。

payload 固定是 `{v:1,tag:<64字元hash>}`；沒有標題、地點、備註、user／event id 或外部 click URL。service worker 後續只用固定一般提示與自己的 App scope；本段尚未接 worker。provider 回 2xx 且 finish 已確認，才加計 sent；這代表推播服務接受及 ledger 確認，不代表真機已顯示或使用者已閱讀。

| 結果 | 處理 |
| --- | --- |
| 2xx | finish `sent`；相同工作之後不重送。 |
| 404／410 | finish `gone`，由 DB 清理失效訂閱與投遞紀錄。 |
| 408／429／5xx 或網路不明 | finish `retry`，留待之後的 cron 沿同 hash／tag 重試；本輪不連發，次數由 DB 限制。 |
| 其他／無效 status | finish `failed`，不跟隨 3xx，也不把無效 status 當成功。 |
| 服務接受但 finish 回應遺失 | sent 不加計，回報 unconfirmed；不在同輪重送，下一輪沿持久 ledger／lease 確認。 |
| claim 回來時已過期或耗盡本輪時間 | 不呼叫 transport，結束 lease；容量問題回報 capacity。 |

預設每輪 45 秒、最多 10,000 台；達上限會回 503／capacity，不宣稱全量完成。目前沒有持久化的輪次游標；持續超過容量時會從前頁重掃，不能把本段當成已完成大規模公平排程。部署 adapter 前仍需依實際負載驗證容量與執行環境限制。資料／transport／heartbeat 有問題也回 503；heartbeat 只留允許的彙總錯誤類別。

## 驗證

- 76 項新單元，涵蓋驗證先於 factory、匿名 payload、已確認與未確認結果、TTL／expiry／本輪 deadline、狀態分類、裝置啟用界線、失效資料與 graph、游標進度／容量及 endpoint allowlist。
- UTC／America/New_York／Etc/GMT-8 各自實際列印時區；76 項與真正本機 HTTP 每輪都通過。
- 既有通知 HTTP 從 11 增至 14 組，使用正式 repository、GoTrue 密碼登入與 PostgREST。新增保護入口拒絕真實 user JWT／公開 key／指定 recipient；兩個同時 tick 經真實服務 RPC 與 Postgres 只接受一筆，sent ledger 的 attempts=1；使用者 client 不能冒充 sender。transport 只在記憶體記錄呼叫，沒有對任何 push service 發出請求。
- source 負控制分別略過 token 比較、把 TTL 錯改為 300，均被指定的新行為案例抓到，finally 逐 byte 還原；source SHA-256 `22aae22eb8935b467b911ebef6302d46523449e1b41c9ba2968eba7e62fec678`。DP-220 兩個 DB 負控制也沿更新後 14 組驗收通過並精確還原。
- 完整 1,527 單元／93 檔＋39 Node、lint／typecheck／migration 結構、Pages build／check:build 通過，原預算不變。新核心未被 App import，沒有新的 rendered UI，這段不宣稱瀏覽器通知、VAPID 加解密或真機驗收。

CI verify 在完整單元之後執行 `npm run test:reminder-controls`；database 原有 `npm run supabase:test:reminders` 自動跑 14 組。原四項 gate、runner、timeout、既有 pgTAP／負控制／競態／types 檢查不變。自己的最新四 CI 與同 head 完成審查後才合併。

## 接續點

DP-222 接 Edge Function、VAPID 加密與受限 fetch adapter：以本段 factory／store／核心組合，做真正 runtime／加密請求驗證與期限／重新導向限制；伺服器秘密只由受控環境注入。之後才接 App 權限、訂閱／登出撤銷與 worker，再做正式設定與真機收信。

本段沒有 remote migration／正式帳號操作／秘密／cron／部署，也沒有升版或改 0.4.6 公告。配置仍停用；DP-042／DP-034 尚未完成。先完成可審核的部署候選與驗證，再依既有界線請擁有者放行正式操作。
