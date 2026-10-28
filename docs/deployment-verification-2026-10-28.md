# 0.4.5 共用日曆修正發布驗證（DP-217）

2026-10-28。**[DayPop](https://yoyocadence.github.io/DayPop/) 已發布 0.4.5「共用日曆修正」。六 jobs、公開 artifact、真正線上 0.4.4 → 0.4.5 自動更新保存及手機／桌面入口驗證均通過。** 擁有者針對本版明確答覆「發布 0.4.5」，本文件記錄該次授權與結果。

## 來源與範圍

候選 [PR #212](https://github.com/yoyoCadence/DayPop/pull/212) head `9696d74df461a99983353bc76112d507fc83cc9e` 的四 CI 與同 head 審查完成、無發現及未解決討論後，合併 main `2bdd7e4c7e406daec7383f0c164c6ca2d848323a`。本次 [Deploy staging #17](https://github.com/yoyoCadence/DayPop/actions/runs/40690824780) 從該 main 執行既有工作流，目標為 [DayPop](https://yoyocadence.github.io/DayPop/)。沒有改 workflow、repository 設定、Auth 權限或部署路徑。

0.4.5「共用日曆修正」包含取消邀請登入後返回、分享載入失敗重試及指定時間重複事項的取消／替換識別修正。user-data 仍 v4、遠端十九份 migration 已對齊；本次沒有 migration push、remote reset 或正式帳號資料操作。兩個既有線上 QA 帳號與假資料保留。

## 本次工作流

| 閘門 | 本次結果 |
| --- | --- |
| lint／typecheck／unit／build／asset／base | 通過；91 檔 1,418 單元、39 Node，19 檔 migration 結構與 root／subpath 資產檢查過 |
| WebKit smoke | 通過；8 passed（21.9 秒），實際 Asia/Taipei |
| database | 通過；10 檔 386 pgTAP、兩項權限負控制與 74/74 還原、兩種競態、types、真實 HTTP 17/17（實際 UTC），兩個假帳號清理 |
| Chromium mobile／desktop | 通過；289 passed／13 skipped（21.4 分鐘），沒有修改 timeout／workers／retries |
| Build for Pages | 通過；35 秒，公開設定、資產、base 與公告守門均過，明確確認替換 0.4.4 且該版公告不變 |
| Publish to Pages | 通過；12 秒，整輪六 jobs 共 23 分 22 秒 |

以上是本次部署自己的 jobs，不以候選 PR 的 CI 代替部署 gate。Pages 成品 JS 含 worker 為 747,063 raw／220,218 gzip bytes、CSS 113,935／27,313，沿原門檻；沒有變更 dependencies、CI 或 worker template。

## 公開成品

2026-10-28T13:12:41.098Z 唯讀公開站台，version.json 為 0.4.5「共用日曆修正」且與提交的 metadata 相同。`github-pages` artifact `12819115505` 屬於本次 run／main `2bdd7e4`；下載 ZIP SHA-256 `49b952c20092c07c5ec234df4844102c7da637770c15f961873ebcc1f4660d26` 與 GitHub metadata 及上傳 log 相同。

在記憶體讀取 ZIP 內的 Pages tar，首頁、主 JS、CSS、worker、version.json、manifest 六項公開回應均與**本次 artifact 逐 byte 相同**。主 JS `index-MpigNYhS.js` 為 745,268 bytes，SHA-256 `c4945d5f45110907d16bce3d4267d53387fc4ac362b8faea383293bfe2292b7c`。不用 Windows 本機 dist 冒充發布 artifact；其建置環境與 line endings 有差異。

CSP 存在、manifest start_url／scope 仍 `./`，公開 bundle 含預期的家庭／分享及 Supabase project。公開 Auth health／settings 都是 200，Email／Google／註冊開啟、Email 需驗證；沒有輸出金鑰或讀取帳號資料。完整 hashes 與 flags 見 [postflight JSON](deployment-postflight-2026-10-28.json)，不含臨時下載網址或憑證。

## 真正舊 client 更新保存

Browser plugin 未提供，沿官方 Playwright CLI，使用全新隔離遊客 session。發布前從真正線上 0.4.4 的 UI 儲存「發布更新保存驗證」（2026-10-28 10:00–11:00）；沒有 seed、mock、路由攔截或登入帳號。

2026-10-28T12:47:39.851Z 的舊 client 使用 `index-1b5KXnN6.js`，設定明確顯示 v0.4.4，worker scope `/DayPop/`、active 已接管，快取只有 `daypop-app-shell-0.4.4`。`daypop.user-data` 是 schemaVersion 4／revision 1／990 bytes，SHA-256 `c5a9c77318741bd82fea8cfaf0ecb48e62af2f4b53b50fd78ceb28c03c5015de`；實際 browser 時區 `Etc/GMT-8`。

發布後同一個 client 由「檢查更新 → 稍後提醒 → 檢查更新 → 立即更新」操作，稍後提醒仍維持舊 bundle；按立即更新後 **App 自行 reload**。2026-10-28T13:14:08.762Z、任何手動 reload 之前，`PerformanceNavigationTiming.type` 為 `reload`，script 換成 `index-MpigNYhS.js`、seen 為 0.4.5、active worker 已接管且沒有 waiting，只餘 `daypop-app-shell-0.4.5`。

更新後仍是相同 990 bytes／v4／revision 1／上述完整 SHA-256。日詳情實際顯示「10:00–11:00 發布更新保存驗證」，截圖已目視；此時才另做手動 reload，原行程、hash、revision 與新版 cache 再次相同。這是真正公開站台與原舊 client，沒有本機 fixture、版本回應替換或手動 navigation 冒充自動更新。

## 線上畫面與界線

另開兩個全新隔離遊客 client，390×844／1280×900、實際 `Etc/GMT-8`，頁名皆為「日蹦 DayPop」。首次公告是 0.4.5 的三條修正，手機矩形 x15／y264.92／360×314.14，桌面 x463／y282.92／354×314.14，內容與「知道了」均在 viewport 內。

實際點選搜尋／綜覽／日曆／設定，各自顯示正確主要標題，無空白頁、framework overlay 或水平溢出。設定的「登入分享日曆」開啟真正 Auth 視窗，Email／密碼／Google／登入可用；手機視窗 x15／y124.89／360×594.22、桌面 x463／y142.89／354×594.22，控制項完整可見。Escape 後焦點回到原分享入口，reload 不重複公告；設定明確顯示 v0.4.5，手動「檢查更新」回覆目前已是最新版本。

兩個新 client 與原更新 client 的 console 均為 0 errors／0 warnings；公告、Auth 與原行程五張截圖已逐一目視。CLI 流程為 open → snapshot／find → click／必要的 DOM eval → screenshot；所有臨時腳本、截圖與下載檔在 TEMP，沒有啟動本機 server，三個具名 CLI session 已關閉。Chrome 的發布表單初次觀察曾暫時無回應，另開同 browser 的工作流頁面確認只有本次 #17，沒有重送 dispatch。

Email 寄達、Google OAuth、實體手機／standalone、螢幕閱讀器與 DP-034 正式放行不由本輪遊客驗證代為完成。雙人 v1 的功能與永久 HTTP 驗收見 [完成矩陣](two-person-readiness.md)，不擴充新功能或寵物素材。本次授權只涵蓋 0.4.5，不自動批准未來發布；0.4.5 一旦發布，其公告不可回寫。
