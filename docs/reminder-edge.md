# 提醒 Edge runtime 與加密 adapter（DP-222）

2026-10-31，從 DP-221 PR #218 最終 head `efced11` 四 CI（`41169465507`）／同 head 完成審查無發現及無未解決討論後合併的 `c18cafb` 接續。這是可審核的服務端候選；公開仍為 0.4.6，提醒配置仍停用。

## 組合與邊界

`supabase/functions/reminder-sender/index.ts` 使用既有保護 handler。專用 `DAYPOP_REMINDER_TOKEN` 驗證成功後才讀取服務環境、驗證 VAPID pair、建立 service client；public key、一般 user JWT 及 Supabase service key 本身都不是這個入口的授權 token。只接受沒有 caller 選擇對象的 POST。gateway 的 `verify_jwt=false` 是為此自訂授權，不能移除 handler 的 token 驗證。[Supabase 自訂驗證說明](https://supabase.com/docs/guides/functions/auth)。

`runtime.ts` 拒絕公開 client key、任意 DB URL、錯誤 VAPID pair、停用配置及與 DB 不符的 public key。正式 DB URL 限 Supabase HTTPS project root；本機特例須明確設定 `DAYPOP_REMINDER_ALLOW_LOCAL=true`，且仍限制 host／port。服務金鑰沿 Supabase 的 server-only 環境，VAPID／專用 token 使用 `.env.example` 的空白名稱；沒有 `VITE_` 秘密。[Supabase 環境與秘密](https://supabase.com/docs/guides/functions/secrets)。

canonical recurrence／planner／投遞核心由 `src/reminders/edgeCore.ts` 經 Vite 產生單一無外部 import 的 `core.generated.js`，保留 rrule 套件完整授權聲明，不另寫一份 recurrence。`reminders:check-bundle` 比對精確重建結果；此檔固定 LF，避免 Windows checkout 造成假差異。修改來源後須跑 `npm run reminders:bundle`。前端沒有 import 這個 Edge entry。

每個 function 的 `deno.json`／`deno.lock` 固定 SDK 2.111.0、web-push 3.6.7 與實際 transitive integrity；型別固定 @types/web-push 3.6.4。Deno 檢查工具固定 2.9.6，測試使用 frozen lock。採用 npm 已發布版本，不以 GitHub moving branch 代替。[Supabase function dependencies](https://supabase.com/docs/guides/functions/dependencies)。

## 加密與網路

production 加密及 VAPID ES256 由固定的 web-push `generateRequestDetails` 產生；網路只走自己的 fetch adapter，沒有呼叫套件的 sender。[套件 API](https://github.com/web-push-libs/web-push)。

- 目的地沿 canonical HTTPS provider allowlist，不接受 caller URL。
- 僅重新編碼 `{v:1,tag:<64字元hash>}`，不直接加密 caller 的原始 JSON bytes；重複 key 也不能隱藏私人文字。
- `aes128gcm`、一般 urgency、topic 為 hash 的前 32 字元。加密前後重讀 clock，TTL 只會縮短；不足一秒不送出。沿核心的 AbortSignal 限制請求時間。
- fetch 使用 `redirect:'manual'`，不跟隨 3xx；狀態交回核心分類。provider body 丟棄、不解析或記錄；已知成功 status 不因 body cancellation 失敗而變成重試。
- 固定依賴 http_ece 有 `ECE_KEYLOG=1` 診斷模式；若模組載入時啟用，runtime 與 transport 都拒絕工作，避免衍生 key 寫入 log。

2xx／sent 仍只代表 provider 接受並完成 ledger，未宣稱手機已顯示。既有五分鐘有效窗、每輪 45 秒／10,000 台、四次嘗試及無持久輪次游標的限制保留，見 [DP-221](reminder-delivery-core.md)。尚未做實際負載容量驗證；尤其不能由零裝置冷啟動推論大規模吞吐。[Supabase runtime limits](https://supabase.com/docs/guides/functions/limits)。

## 第 21 份 migration

`20261031090000_reminder_runtime_key_binding.sql` 新增 service-only `reminder_sender_configuration()`，heartbeat 改為必帶 `p_public_key`；`createReminderStore` 也綁定同一把 public key。

配置啟用狀態或 public key 改變時，trigger 清掉 last_tick／last_error。heartbeat 只更新目前 enabled 且 key 相同的配置，舊 in-flight runtime 無法讓新配置顯示 ready。原二十份 migration 保持原檔；目前遠端十九份尚未套用這兩份提醒 migration。types 由本機重建的 public schema 產生，沒有手改；個人 envelope 仍是 v4。

## 驗證與重跑

| 驗證 | 本機結果／範圍 |
| --- | --- |
| Deno 離線測試 | 9/9；獨立收件端 WebCrypto 依 RFC 8291／8188 解密，驗證 VAPID aud／sub／exp／簽章，改 ciphertext 必須失敗；key pair／DB key／授權／TTL／匿名 bytes／診斷模式。測試 deny-net。 |
| 原生 fetch | 2/2；真正 127.0.0.1 server 的 307 不被跟隨，進行中請求遵守 abort。Deno 僅 allow-net=127.0.0.1；production 無 URL rewrite。 |
| Edge 負控制 | 移除 DB key 比對、加入私人加密欄位、允許 follow，各由指定案例抓到；finally runtime 精確還原，SHA-256 `2f6339f9400cd9eeecb661d9b4e4b0a30d6063a9bec86a10bb3fe756cf131a45`。 |
| 實際 Supabase Edge 容器 | 真正 functions serve 冷啟動、錯誤／公開／service token 拒絕、caller recipients 拒絕、停用 503、相符配置 200 並寫入真實 RPC heartbeat、換 key 清健康且舊 runtime 503。零裝置、零 delivery；短期 VAPID／token 僅 TEMP，finally 還原／清除／停止。 |
| 本機 DB | 21 檔精確相同、沒有 link；從零 reset，全部 461 pgTAP／12 檔，含 16 項新 key 綁定測試；generated types 一致。 |
| 既有行為 | 通知真正 Auth／HTTP 15/15、三組競態與原兩個 DB 負控制；核心 token／TTL／deadline 三項負控制還原後，109 核心測試在 UTC／America/New_York／Etc/GMT-8 通過並列印實際時區。 |
| App | 1,527 單元／93 檔＋39 Node、lint／typecheck／Pages build／check:build；JS 747,193 raw／220,244 gzip、CSS 119,236／29,242，與原版相同，門檻不變。沒有新 rendered UI。 |

首次本機高並行完整單元有五個逾時及一個後續 UI 斷言失敗；以 `npm run test -- --maxWorkers=4` 重跑全數通過，沒有改測試或 timeout。Windows Deno 2.9.6 本輪即使 PowerShell 設 TZ=UTC，實際仍印 Etc/GMT-8 並被時區斷言抓到；因此不當成 Deno 跨時區通過。Node 的三時區證據如上；CI Linux 在 UTC／America/New_York／Etc/GMT-8 跑相同 Deno 測試並列印實際時區，以自己的最新 head 結果為準。

Edge 本機測試曾在重用已停止容器時失敗，另一次真正冷啟動在 matching runtime 階段回 HTTP 502，原因未確認；最終相同程式連續兩次真正冷啟動通過。不把重用容器當成已證實的唯一原因，也沒有替 502 加重試或降低驗收。永久腳本要求 runtime 容器原本不存在，不重用／替換既有容器，finally 停止且移除本次容器；失敗只輸出固定類別計數，完整 log 僅 TEMP、秘密 env 仍刪除。Linux 的實際冷啟動仍須自己的 CI 通過。

本機重跑：先啟動沒有 link 的測試 stack 並 reset；`reminders:check-bundle`、`reminders:check-edge`、`reminders:test-edge`、`reminders:test-network`、`reminders:test-controls`。DB 另跑 `supabase:test:reminders`、`supabase:test:reminder-concurrency`、`supabase:test:reminder-controls`、`supabase:test:reminder-edge`。專用本機可設 DAYPOP_HTTP_WORKDIR／DAYPOP_REMINDER_DB_CONTAINER；腳本拒絕不同 origin／非指定 stack／已安裝配置或既有裝置，從不印 CLI startup／runtime log／key。

CI 保留原四 gates／runner／timeout；verify 加可重建 bundle、Deno／原生網路及三負控制，database 加真正 Edge 冷啟動，其餘 pgTAP／HTTP／競態／types 不省略。自己的最新四 CI／同 head 完成審查無發現及無未解決討論後才合併。

## 接續

DP-223 接 App 權限／本人規則／裝置註冊、帳號切換與登出撤銷、固定匿名 service worker 通知與 App scope 點擊；逐頁對照 canonical 原稿並驗證瀏覽器行為。完成可審核候選後才整理正式 migration／秘密／cron／部署放行及真機收信。

本輪沒有遠端 migration、正式帳號操作、真 Push、cron、秘密安裝或部署，0.4.6 與歷史公告不變；DP-042／DP-034 尚未完成。
