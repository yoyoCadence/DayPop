# 提醒與月曆聯合發布驗證（DP-234）

2026-11-04。**提醒後端已設定並持續取得健康 heartbeat；前端仍是 0.4.6，0.4.7 尚未發布。** 本文件會依實際發布結果接續，不把合併、取消的 CI 或本機替身稱為正式收信。

## 授權與來源

擁有者先選擇「提醒完成後一起發布」，11-04 再針對三份 migration 及 PR #228 已審核的提醒專用秘密、函式、每分鐘排程，明確答覆「授權你依清單代跑三份 migration 並完成提醒正式設定」。這是 ADR §9 原由擁有者 CLI 執行責任的具體委託，不延伸至其他 migration／專案、廣泛秘密、帳號或個人資料操作。

後端來源為已完成四 CI／同 head 無發現審查後合併的 PR #228／main `23916f5`；管理操作 SQL SHA-256 `18653ca507ac6afebb29f4b2468d4bbf8759253c7daec5b386d665960e65ea9c`。PR #229 的 `6379da2` 只有 release version／公告／生成版本資產／交接，審查已完成無發現且討論 0；前兩輪 Chromium 均達 25 分鐘取消，第一輪到第 326 個案例，第二輪全部 344 個案例已結束（325 通過標記／19 略過，零失敗標記），但 job 取消仍不能算 pass。與前置 PR 相同 325 項的總測時由 1,221.188 秒增至 1,436.866 秒，約慢 18%，分布在多個檔案；原設定的第三輪執行中，沒有調整 timeout／worker／retry／斷言。同一後端來源已完成審核，故於候選重跑期間依本次明確委託完成後端；**前端發布仍等候選自己的四 CI／審查並合併**。

本次無 Supabase MCP tools，沿既有 linked CLI；沒有重新 link、remote reset、repair、額外 migration 或 CLI／依賴升級。

## 實際線上舊版補核

補查既有工作流後，最近成功部署其實是 2026-11-01 的 `41308146780`、來源 `d17eae5e1fd091066dd53a648497f2f6b8118e52`，仍使用 0.4.6 版號；10-29 的 `40858598356`／`22a0dfb` 是更早一次，不能把公告日期當成最後部署日期。11-04 00:57 UTC 直接讀回公開六成品：主 JS `index-BU-7o4xM.js` 752,589 bytes、SHA-256 `be9fc55a03cec0d44e237737dd042991ee8e71e912da3edeec5462dc2fe043bd`，已含單月翻頁，尚無新提醒設定 UI；實際舊 UI 也成功選取單月模式。舊 workflow artifact 清單為空，沒有宣稱此次完成舊 artifact byte 比對。新發布仍須核對自己此次 artifact。

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

## 前端候選與發布（待完成）

PR #229 新 head 完成自己的 CI／審查後才合併、執行既有 Deploy staging。預先保留真正線上 0.4.6 的獨立遊客工作階段：於 11-04 00:58:22 UTC 以舊 UI 建立「翻月提醒聯合更新保存驗證」、09:00–10:00，選暖陽／深色，並由實際頁首選單選「單月翻頁」；先前用來準備腳本的 baseline 已退役不混用。active worker 已接管、無 waiting、只餘 0.4.6 cache。個人 envelope v4／revision 3／1,000 bytes、SHA-256 `ef1d1e77ff36b61f1ae6f79beafb8fb038985880c5c977ea0dc1afc2640d1c12`，實際 Asia/Taipei，舊 script `index-BU-7o4xM.js`。模式 `daypop.month-navigation.v1=paged` 也是由 UI 保存；沒有 seed、init script、route mock 或 localStorage 注入，更新後不 reseed。驗證先判斷 App 自行 reload／載入新 script，再回設定讀版本與偏好，最後才手動 reload，兩段各自即時保存 metadata。

待驗部署自己的六 jobs、公開 artifact 逐 byte 相同、App 真正自動 reload、資料與偏好／單月 key 精確保存及手動 reload；新訪客手機／桌面公告、四分頁、左右翻月／自動列數、登入入口／焦點／console 與畫面。

## 實體裝置界線

iPhone 加到主畫面後，以本人帳號開「設定 → 提醒 → 這台裝置的通知」，逐本日曆開啟、提前分鐘填 0 並儲存；建立約五分鐘後的指定時間行程，回主畫面或鎖屏，確認固定匿名通知及點擊。另驗取消／重複、停用／登出，以及自動列數跨 4／5／6 週月份和左右翻月。這部分需要擁有者真機結果；服務健康、provider accepted、本機替身、Chromium touch 或 viewport 都不能代替。DP-042／正式放行仍不得因此提前結案。
