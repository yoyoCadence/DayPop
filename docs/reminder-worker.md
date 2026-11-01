# 匿名提醒 service worker（DP-226）

2026-11-01，從 DP-225／PR #221 最終 `8d31ac0` 四 CI `41266688371` 與同 head 完成審查無發現後合併的 `3ae1adf` 接續。這是 DP-223 的 worker 段落；公開仍 0.4.6，尚未啟用提醒。

## 行為與資料邊界

`pwa/sw-template.js` 是來源，`release:assets` 產生 `public/sw.js`。既有 install／activate／fetch／SKIP_WAITING 與只清理 `daypop-app-shell-` 的規則不變。

後續 DP-228 增加無私人資料的公開 v1 能力握手，供 App 啟用前確認 active worker；不自行啟用 waiting worker。新段落／來源 hash 與驗證見 [瀏覽器 adapter](reminder-browser.md)，下方 DP-226 hash 保留為該段歷史證據。

- 只接受 sender 既有的兩欄 JSON：`{v: 1, tag: <64 位小寫 hex>}`。空值、陣列、格式錯誤、其他版本、額外欄位與解析失敗都不顯示通知，也不記錄原始內容。
- 通知固定為「日蹦 DayPop／有日曆提醒，開啟日蹦查看。」，圖示取本身 scope 的既有 SVG；不使用標題、地點、備註、事項／帳號識別或 payload URL。`daypop-reminder-` 加工作 hash 作為 tag，重送取代同 tag，`renotify: false`。通知 data 只留 type／版本。
- `push` 的 `waitUntil` 等待真正 `showNotification`，權限失敗仍是失敗，不回報假成功。這段不申請權限、不建立訂閱、不讀取私人儲存或發送應用程式網路請求。
- 點擊僅處理自己的 marker／版本／tag，先關閉通知，再找同 origin 且位於 App scope 的 window。只 focus，保留目前路由及未儲存表單；client 關閉時繼續找下一個，沒有可用 window 才開啟固定 scope。不接收任意目的地。

## 驗證

`src/pwa/reminderWorker.test.ts` 執行實際 generated worker，並斷言與 template 替換版號後逐 byte 相同。33 項涵蓋訊息格式／固定內容、tag、失敗 lifetime、點擊範圍、草稿路由、關閉 client／查詢失敗、其他通知不處理，以及真正 `runReminderTick` 的 wire 接到 worker 後不洩漏私人 fixture。三輪實際印出 UTC、America/New_York、Etc/GMT-8，全部通過。完整 1,587 單元／96 檔＋39 Node 通過。

`e2e/reminder-worker.spec.ts` 使用完整 Chromium 的 new headless 與實際 worker，僅在隔離 loopback origin 由測試明確授權通知，透過 [CDP ServiceWorker.deliverPushMessage](https://chromedevtools.github.io/devtools-protocol/tot/ServiceWorker/#method-deliverPushMessage) 送入既有 v1 wire。讀回原生 `getNotifications()` 的固定內容／tag，重送只留一個，停止 worker 後再送可重新啟動。最後確認沒有 PushManager 訂閱、外部請求、worker 錯誤或頁面 console 問題。手機／桌面 viewport 均過，實際 Asia/Taipei。

預設 headless shell 曾出現 Permissions query 為 granted、Notification.permission 卻 denied；因此只有新檔指定 `channel: chromium`，使用 CI 已安裝的完整 binary，不更改全域 project／worker／retry／timeout。測試授權只存在測試 context，不會替使用者開權限。

新通知與既有 service-worker／production-update／production-offline 四份檔案在手機／桌面共 24 項通過（1.1 分鐘）。涵蓋等待明確更新、安裝／下載失敗後重試、只清理舊 app-shell cache、保留 localStorage／IndexedDB／其他 cache，以及真正離線另開頁、編輯、reload 和恢復網路檢查更新；未放寬既有斷言。

三個負控制分別移除 wire 額外欄位防護、client scope 防護、真正 worker 的顯示接線，都被對應單元／瀏覽器行為斷言拒絕；`finally` 精確還原三份檔案，還原後重新驗證。template SHA-256 `a662e1bdb757f37304a74685da1f803b895e3e04837513bdda5eb99624b6cd91`，generated worker `01fa9dd22a645afa82484f44620532a26fab7f6bfdec92905011760ded190e45`。控制腳本與失敗紀錄只留本機 TEMP。

lint／typecheck／Pages build／check:build／canonical reminder bundle 通過。JS＋worker 756,605 raw／223,151 gzip bytes，CSS 119,746／29,361，沿既有預算，沒有提高上限。

## 接手與限制

PR #222 最終 `645e59c359d94a79856384736a69d2061dd0b09d` 的四 CI `41271057932` 全過：Chromium 305 passed／13 skipped（18.9 分鐘），465 pgTAP／12 檔、提醒 HTTP 16/16、真正 Edge 冷啟動與三時區 Deno 仍通過。同 head 審查 completed 無發現及無未解決討論後合併 `21ef5d33e20686c73f7bef5330f53eda8b491218`。下一段 DP-227 接本人提醒 client service，再接裝置生命週期與 canonical 設定 UI。DP-223／DP-042 尚未完成。

這些是 worker runtime／Notification API 證據，沒有 OS 通知外觀、真實 Push service 投遞或 iPhone Home Screen 真機收信證據。沒有正式 migration、秘密、cron、前端發布、使用者通知授權／訂閱、Auth 或 v4／備份改動；正式啟用仍需後續具體驗收與放行。
