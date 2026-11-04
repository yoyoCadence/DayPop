# 提醒與月曆聯合發布驗證（DP-234）

2026-11-04。**0.4.7 已由既有 Deploy staging 發布；提醒後端健康，公開成品與部署 artifact 相同。** 真正舊版原地更新與實體 iPhone 收信仍未完成，不把合併、取消的 CI 或本機替身稱為正式收信。

## 授權與來源

擁有者先選擇「提醒完成後一起發布」，11-04 再針對三份 migration 及 PR #228 已審核的提醒專用秘密、函式、每分鐘排程，明確答覆「授權你依清單代跑三份 migration 並完成提醒正式設定」。這是 ADR §9 原由擁有者 CLI 執行責任的具體委託，不延伸至其他 migration／專案、廣泛秘密、帳號或個人資料操作。

後端來源為已完成四 CI／同 head 無發現審查後合併的 PR #228／main `23916f5`；管理操作 SQL SHA-256 `18653ca507ac6afebb29f4b2468d4bbf8759253c7daec5b386d665960e65ea9c`。依此次具體委託，先完成該已審核來源的後端設定；版本候選不改提醒 runtime 或 SQL，前端發布另等候選自己的完整檢查。

版本候選 PR #229 最終 `a66d0be1ee91e0339e3ad33a1540b12d084cfdc3` 的 CI `41748282546` 四項成功（Chromium 325 passed／19 skipped、20.0 分鐘，WebKit 12、1,802 單元＋39 Node、478 pgTAP／提醒 HTTP 23／scheduler 17，實際 UTC）；同 head 審查 completed、無發現、討論 0 後合併為 `c9526886fbd88f1d7dd7cc0de0cd1a04ecd9f469`。原 `6379da2` 三次達 25 分鐘取消，後兩輪雖全部 344 案例完成仍不算 pass；相同 325 項總測時比前置 PR 多約 18%。DP-235 只調 Chromium job 25→30 分鐘，個別期限、worker、retry、案例與斷言、其餘三個 gate 都不變；實際放行採修正後新 head 的完整成功結果。

11-04 01:01:20 UTC，從上述合併 main 明確 dispatch 既有 Deploy staging `41751090045`，讀回 source SHA 相同；沒有 dispatch 未合併分支或跳過部署自己的 gate。此時 backend 只有一個提醒 job，key-bound heartbeat 仍持續前進且 error 空。

本次無 Supabase MCP tools，沿既有 linked CLI；沒有重新 link、remote reset、repair、額外 migration 或 CLI／依賴升級。

## 實際線上舊版補核

本次部署前補查既有工作流，最近成功部署其實是 2026-11-01 的 `41308146780`、來源 `d17eae5e1fd091066dd53a648497f2f6b8118e52`，仍使用 0.4.6 版號；10-29 的 `40858598356`／`22a0dfb` 是更早一次，不能把公告日期當成最後部署日期。11-04 00:57 UTC 直接讀回公開六成品：主 JS `index-BU-7o4xM.js` 752,589 bytes、SHA-256 `be9fc55a03cec0d44e237737dd042991ee8e71e912da3edeec5462dc2fe043bd`，已含單月翻頁，尚無新提醒設定 UI；實際舊 UI 也成功選取單月模式。舊 workflow artifact 清單為空，沒有宣稱此次完成舊 artifact byte 比對。新發布仍須核對自己此次 artifact。

需要回復前端時以最近一次成功部署的來源 `d17eae5` 為基線，依既有流程建立明確 ref，不誤用 10-29 來源；仍先停用後端排程並保留秘密與資料。此次 0.4.7 提供明確的新版本更新提示，會對上述真正現行舊版做原地更新驗證。

## 正式 migration 與權限 postflight

重新確認 local 22／remote 19、沒有 remote-only。CLI dry-run 只列：

- `20261029123000_reminder_delivery.sql`
- `20261031090000_reminder_runtime_key_binding.sql`
- `20261103000000_reminder_scheduler_extensions.sql`

再次核對相同清單後 CLI push 成功逐份套用；23:44 UTC（11-04 07:44 UTC+8）讀回 local／remote 22，兩邊沒有獨有版本。這是 history 版本對齊，不冒充逐 byte 遠端 migration statements／完整 drift 檢查。

唯讀 metadata 確認：

- pg_cron 1.6.4、pg_net 0.20.4、Vault 0.3.1 已安裝。
- public 16 張實體資料表全部 RLS；四張提醒資料表也逐一 RLS，兩個 schema-private 表不暴露給 Data API。
- `reminder_sender_%` 服務 RPC 對 anon／authenticated 均無 EXECUTE；兩者也無 cron schema USAGE。
- 啟用前 rules／devices／deliveries 皆 0、自己提醒 job 0，配置 disabled、key／heartbeat／error 空。
- 真正公開 client 對 cron、net、daypop_reminders 的三次 GET limit=0 均 406／PGRST106；匿名呼叫只讀 `reminder_sender_configuration` 回 401／42501。未讀取任何個人資料列。
- linked 產生的 `Database.public` AST 與已提交本機 types 相同；排除 generator-only metadata，正規化後 30,122 字元，SHA-256 `c0b0afa5b2d0cd3fbf75834dbfd9f754c5902def605e87f843f8c30d3c8c1c27`。沒有把遠端 `__InternalSupabase` 寫入 repo。

## 秘密、函式與排程

產生一組穩定 P-256 VAPID pair，簽署／驗章確認配對，及一個隨機 32-byte base64url 專用 token。四個 Edge 名稱為 `DAYPOP_REMINDER_TOKEN`、`DAYPOP_VAPID_PUBLIC_KEY`、`DAYPOP_VAPID_PRIVATE_KEY`、`DAYPOP_VAPID_SUBJECT`；subject 為受控的 repo issues HTTPS 聯絡頁。Vault 的 `daypop_reminder_token`／`daypop_reminder_vapid_public_key` 綁同一組值；沒有隱含換 key、使用 VITE_ 或新增 service-role credential。

秘密值沒有輸出、提交或放入前端。專案外 `%LOCALAPPDATA%\DayPop\ReminderAdmin` 僅目前 Windows 使用者及 SYSTEM 可存取、停用 ACL 繼承；`credentials.dpapi` 是 Windows DPAPI 加密備份，已實際解密比對確認可還原，需保留原 Windows 使用者／機器。`binding.json` 只有 project hash／公開 key 短指紋與安裝狀態。成功安裝後 `credentials.env` 與含 Vault 初始化值的 SQL 已明確刪除，沒有在一般 TEMP 留秘密 SQL。

canonical bundle 守門過後，僅部署 `reminder-sender`：ACTIVE、version 1、verify_jwt=false。這是既有自訂專用 Bearer 設計；正式 POST 缺 token、錯誤專用 token、偽造 user JWT 三種均 401。這不是以真實用戶 JWT 或實體裝置測試。

以原審核 SQL 只代入既有 project ref／enable，啟用 `daypop-reminder-minute-v1`（每分鐘、固定該專案 HTTPS sender、空 JSON、55 秒 timeout、Vault 執行時取專用 token）。兩次相隔至少一分鐘的 status 皆 enabled、job 1／active 1、公開 key 指紋 `174fe0d2bcdd`、cron succeeded、last_error 空；真正 key-bound heartbeat 從 `2026-11-03 23:46:02.356001+00` 前進至 `23:47:01.156034+00`。後續持續監看，不把非同步 cron success 當 OS 收信。

正式狀態與回復沿 [受審核操作交接](reminder-release-readiness-2026-11-03.md)。需要回復時先同 SQL disable，只移除自己的相同 job、保留 VAPID／規則／裝置／使用者資料；前端再走既有 Pages rollback，不 drop cron 或提醒表。

## 前端發布與公開成品

Deploy staging [`41751090045`](https://github.com/yoyoCadence/DayPop/actions/runs/41751090045) 從已合併 `c952688` 執行，四個 quality gate、Build for Pages 與 Publish to Pages 六 jobs 全成功。本次接手後沒有再次 dispatch、套 migration、換秘密或登入正式帳號。

部署自己的結果為 1,802 單元／102 檔＋39 Node、478 pgTAP／13 檔、提醒 HTTP 23/23、scheduler rollback 17/17、WebKit 12 passed。Chromium 20.5 分鐘，**324 passed／1 flaky／19 skipped**：mobile reminder-worker 的匿名通知／穩定 tag／冷啟動案例首輪失敗，既有一次 retry 後成功；不能改寫為全部首輪通過。這與 PR #229 的 325 passed／19 skipped 是不同 run 的結果。本次不改 retry、期限、worker 或測試斷言。

11:48 UTC 下載該 run 的 `github-pages` artifact `13287238014`，ZIP SHA-256 `d7b78ac5ea0a41c9b24281c63079bfac941e56c5dc9838575f795f35a57ce5e1` 與 GitHub metadata 相同。公開 17 項成品（index／JS／CSS／worker／version／manifest、五張外部主題圖與六個圖示）逐 byte 等於該 artifact；inline paper hash 也符合既有 manifest。公開版號 0.4.7、日期 11-04、四條公告正確，CSP／Pages scope 與預期公開專案配置正常，Auth health/settings 200、Email／Google／註冊啟用且 Email 需確認；這不代表實際登入或 OAuth 流程通過。**0.4.7 公告自此不可回寫。**

公開 production Chromium QA 於 11:48 UTC 完成，390×844（觸控／mobile）與 1280×900，均實際列印 Asia/Taipei；成品核對程序實際 Etc/GMT-8。Browser plugin 未提供，使用 repo 已安裝的 Playwright 執行 TEMP script：

- 首次公告四條與 CTA、四分頁、遊客提醒說明／停用控制、Email／密碼登入入口、Escape 及觸發鈕回焦通過。
- 自動列數按住滑動期間高度固定，跨月後停穩的週／比例 anchor 保留；這段是 synthetic held-touch 檢查。手機另以 Chromium CDP touch input 驗左右翻月、桌面以前後月按鈕驗往返；模式切換保留月份。
- reload 不重複顯示公告，遊客資料原字串與單月裝置 key 保存、沒有水平溢出；兩種 viewport console errors／warnings 各 0，無 blank page 或 framework overlay。
- 手機／桌面公告、單月與登入入口共六張 TEMP 截圖已目視，未見截斷／重疊；手機尺寸及 Chromium 手勢不能代替實體 iPhone。

11:48:48 UTC 唯讀再查排程：enabled、job 1／active 1、指紋仍 `174fe0d2bcdd`、cron succeeded、last_error 空，key-bound heartbeat 前進至 `2026-11-04 11:48:00.915844+00`。機器可讀證據見 [公開 postflight](deployment-postflight-2026-11-04.json)。

## 真正舊版更新：保留未驗

部署前於 00:58:22 UTC 在真正線上 0.4.6 的獨立遊客階段，以舊 UI 建立「翻月提醒聯合更新保存驗證」、09:00–10:00，選暖陽／深色及單月翻頁。基線為 v4／revision 3／1,000 bytes、SHA-256 `ef1d1e77ff36b61f1ae6f79beafb8fb038985880c5c977ea0dc1afc2640d1c12`、舊 script `index-BU-7o4xM.js`、active worker／無 waiting／只餘 0.4.6 cache、Asia/Taipei；單月 key 由 UI 保存，沒有 seed、init script 或 route mock。

該背景測試只等待三小時，接手時已退出且程序不存在；state JSON 仍停在 `old-client-ready`，沒有 automatic／manual reload 結果。不能由此宣稱真正公開 0.4.6 → 0.4.7 更新或暖陽深色資料保存通過。本次兩 viewport QA 只證明新 0.4.7 階段本身 reload 保存；候選的 0.4.7 → 999 測試也不補足此缺口。需由仍保留舊版的裝置實測，或另做明確標示的隔離舊版升級回歸；後者仍不能冒充正式舊階段。本次不 rollback 公開站來製造測試條件。

## 實體裝置界線

### 首次未收到提醒的診斷（2026-11-04）

擁有者回報約 20:30 設定 20:40 的行程、提前 10 分鐘，未收到通知；因此預定提醒時間其實是 20:30（12:30 UTC）。13:21 UTC 以唯讀 metadata／去識別化計數確認：裝置與日曆規則均已存在、key 綁定正確，但兩者均未在 12:30 UTC 前完成。24 小時 ledger 無投遞記錄；20:25–20:45 的 20 個 sender gateway 回應均 200，heartbeat 持續且 last_error 空。沒有讀取任何行程文字、裝置 endpoint／加密 key、JWT、秘密或 HTTP headers，沒有改寫正式資料或重送通知。

現存記錄符合既有不補發契約：planner 拒絕 fireAt 早於規則 updatedAt／事項 createdAt，controller／DB claim 另拒絕早於 deviceCreatedAt 的工作。這支持「本次碰到排程資格邊界」的判斷，但現存版本無法重建可能已被替換的舊規則／裝置歷史，不宣稱完整還原當時過程或已驗證 OS 收信。既有本機 schedule／delivery 109 項回歸通過、實際 Etc/GMT-8，沒有改程式。已請擁有者維持登入、將同一本日曆提前分鐘保存為 `0`，新增至少五分鐘後開始的指定時間事項，鎖屏後等開始時間加兩分鐘回報；仍待結果，不將 DP-234／042 移 Done。

iPhone 加到主畫面後，以本人帳號開「設定 → 提醒 → 這台裝置的通知」，逐本日曆開啟、提前分鐘填 0 並儲存；建立約五分鐘後的指定時間行程，回主畫面或鎖屏，確認固定匿名通知及點擊。另驗取消／重複、停用／登出，以及自動列數跨 4／5／6 週月份和左右翻月。這部分需要擁有者真機結果；服務健康、provider accepted、本機替身、Chromium touch 或 viewport 都不能代替。DP-042／正式放行仍不得因此提前結案。
