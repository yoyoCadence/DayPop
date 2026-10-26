# 0.4.4 家庭日曆發布驗證（DP-205）

2026-10-26。**0.4.4 已成功發布到 [DayPop staging](https://yoyocadence.github.io/DayPop/)，公開成品、手機／桌面入口與真正線上 0.4.3 → 0.4.4 更新保存驗證通過。** 兩個真實帳號的分享操作與真機結果仍待擁有者實測，見下方範圍。

## 發布來源與授權

擁有者針對「從 main 執行既有 Deploy staging，發布 0.4.4」明確答覆「可以 繼續吧」。候選 [PR #199](https://github.com/yoyoCadence/DayPop/pull/199) 的 head `01f9afd` 四 CI 與相同 head 完成審查無發現、無未解決討論後合併 `0629821148b7fb33219cde5e778ddecdfb6150f2`；本次 [Deploy staging #16／`40253002837`](https://github.com/yoyoCadence/DayPop/actions/runs/40253002837) 由該 main 發布。

App release 為 0.4.4「家庭日曆一起用」，user-data 仍 v4、18 migrations 不變。沒有執行 remote reset／push／DDL 或查改正式帳號資料；使用既有 repository variables／workflow，保留四品質閘門、歷史公告檢查及 Pages base 檢查。

## 工作流結果

| 閘門 | 結果 |
| --- | --- |
| lint／typecheck／unit／build／asset／base | 通過；88 檔 1,402 單元、29 Node，root／subpath 資產檢查通過 |
| WebKit smoke | 通過；8 passed，實際 Asia/Taipei |
| 本機資料庫重建／權限與競態／types | 通過；9 檔 376 pgTAP，兩次權限負控制各 8 預期失敗、還原 74/74，兩種競態與 generated types 通過 |
| 完整 mobile／desktop Chromium | 通過；285 passed／13 skipped（15.3 分鐘），不是前段 PR 的測次 |
| Build for Pages | 通過；公開設定、`/DayPop/` base、資產及線上歷史公告檢查全部通過 |
| Publish to Pages | 通過；workflow 總共 16 分 28 秒，發布網址為既有 DayPop staging |

工作流六項 jobs 全成功；不是只看到 upload 成功就當發布完成。Pages build 的 JS 含 worker 為 746,929 raw／220,167 gzip bytes，沿原門檻；0.4.3 歷史公告不變。

## 線上成品與 Auth

2026-10-26T01:28:26.688Z（台北 09:28）直接讀取公開站台：version.json 為 0.4.4「家庭日曆一起用」且與已提交 metadata 相同；主 JS `/DayPop/assets/index-1b5KXnN6.js` 為 745,134 bytes，含 `calendar_sharing_manifest`／`family_command` 與預期 Supabase project 設定。首頁 CSP 存在，manifest start_url／scope 仍 `./`，worker 去除 CRLF 差異後與 generated 0.4.4 相同。公開 Auth health/settings 皆 200；Email／Google／註冊開啟，Email auto-confirm 關閉，需完成驗證信。沒有輸出 key 或查詢私人資料。

另下載同一 workflow 的 `github-pages` artifact `12621886861`，ZIP SHA-256 與 GitHub metadata／上傳 log 相同：`500601ea10e6b0badfefae060d62adae2359639aabed9dd155492d249a220a2a`。在記憶體讀取 archive 後，比對首頁、主 JS、CSS、worker、version.json、manifest，六項公開回應皆與 **本次發布 artifact 逐 byte 相同**。主 JS SHA-256 為 `97284929e1ef968017c752ca8fbee7dfe499c8b9d4fe0243a15a78e2da44008b`。沒有用 Windows 本機 dist 的不同 line endings／build bytes 冒充線上；完整六項 hashes 與公開 flags 見 [postflight JSON](deployment-postflight-2026-10-26.json)，不含金鑰或臨時下載網址。

## 真實線上舊版更新與資料保存

Browser plugin 未提供，沿官方 Playwright CLI，使用全新隔離遊客 profile。發布前由 **線上 0.4.3 UI** 儲存一筆「發布更新保存驗證」（2026-10-26 10:00–11:00），沒有 seed／mock／攔截回應，也沒有登入帳號。舊程式明確顯示 0.4.3，worker scope `/DayPop/`，快取只有 `daypop-app-shell-0.4.3`；本機 `daypop.user-data` schemaVersion 4／revision 1／990 bytes、SHA-256 `cb2208df17fcf31649364e1dc15c47e8c08c9c178c5b02c4f35c1d5039257b93`。

發布後，同一個舊 client 看到真實 0.4.4 提示，經「稍後提醒 → 檢查更新 → 立即更新」。複合驗證腳本曾發生等待逾時，當時仍是舊 bundle、seen 0.4.3、新 worker waiting，未算作通過；重新擷取 snapshot 並逐步操作後，**App 自行 reload**，`PerformanceNavigationTiming.type` 為 `reload`，主 JS 換成 `index-1b5KXnN6.js`、畫面明確顯示 0.4.4、seen 0.4.4，active worker 接管、waiting 消失、只餘 `daypop-app-shell-0.4.4`。

自動更新前後皆為相同 990 bytes／v4／revision 1／上述完整 SHA-256；列表可讀到原行程。此時才另外手動 reload 再驗，仍同 hash／revision、同一筆行程與新版快取。這條使用真正公開站台及原舊 client，沒有以本機 fixture 或 HTTP 版號改變冒充。沒有修改任何產品程式來讓驗證通過。

## 版面、入口與剩餘驗收

另開全新遊客 context，確認 0.4.4 首次公告，390×844 的矩形為 x15／y244.09／360×355.80，內容與「知道了」可見且可關閉。搜尋／綜覽／日曆／設定四分頁各自顯示正確標題、無水平溢出；設定有「登入使用家庭」「登入分享日曆」兩卡片，後者開啟真正的 Auth UI，Email／密碼、Google、登入、忘記密碼均啟用。390×844／1280×900 截圖已目視，桌面 Auth 矩形 x463／y142.89／354×594.22；沒有空白頁、框架錯誤畫面、控制項重疊或切掉按鈕。手動「檢查更新」明確回覆目前已是 v0.4.4 最新版。

兩個線上 Chromium context 的 console 都是 0 errors／0 warnings，實際 browser／Node 時區 `Etc/GMT-8`；部署 CI 的 browser context 另印出 `Asia/Taipei`。QA 完成後關閉兩個具名 CLI 瀏覽器；沒有啟動本機 server。截圖保存在本機 TEMP，不把其他帳號內容或臨時下載憑證提交到 repo。

真實 Email 寄達、Google OAuth 與 A／B 兩個實際帳號的保存／邀請／共同編輯／私人／唯讀／撤權仍需依 [兩帳號使用指引](shared-calendar-start.md) 操作。沒有以固定假資料 e2e、公開 Auth flags 或本機遊客測試冒充真實帳號驗收，也不據此代為標記 DP-034 正式放行或 iPhone／standalone 真機通過。寵物後續素材繼續暫緩。
