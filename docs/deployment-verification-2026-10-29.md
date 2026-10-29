# 0.4.6 漫畫手帳新風格發布驗證（DP-218）

2026-10-29。**[DayPop](https://yoyocadence.github.io/DayPop/) 已發布 0.4.6「漫畫手帳新風格」。六 jobs、公開 artifact、真正 0.4.5 → 0.4.6 自動更新保存及桌面／手機 viewport 畫面驗收均通過。** 擁有者委託直接完成整頁融合主題、生成素材、整合、驗證，並依既有流程發布。本文件記錄這次 0.4.6 的範圍與結果；不延伸為未來版本的發布授權。

## 來源與範圍

[PR #214](https://github.com/yoyoCadence/DayPop/pull/214) 最終 head `5730f5455f72de6db33749e548e047412a9d898a`，四 CI [40800978420](https://github.com/yoyoCadence/DayPop/actions/runs/40800978420) 全成功（Chromium 297 passed／13 skipped）。初版的六項短對話框對比量測失敗已修正，原門檻不變。擁有者明確允許暫轉 Draft 後立即 Ready，2026-10-29T10:29:11Z 觸發該最終 head 審查；完成、無發現、無未解決討論後，合併 main `22a0dfb45525ca09beaefa0f883d0e080a4ff978`。

[Deploy staging #18](https://github.com/yoyoCadence/DayPop/actions/runs/40858598356) 從該 main 執行既有六階段工作流，沒有重送 dispatch 或修改 workflow、timeout、workers、retries。Chrome 的首次發布結果頁讀取逾時，另開同 browser 的工作流頁面確認只有本次 #18。

主題採六張獨立生成 WebP，分別用於桌面淺／深工作桌、手機及長頁紙邊、頁首墨線、工作面紙質與分頁膠帶。原六主題 ID／預設／偏好、四分頁、原生表單、文案、日期與使用者日曆色彩及原始貓圖片保留；只有漫畫承接素材。完整 [區域配置、實際截圖與概念對照](design/manga-journal/README.md)、[素材 manifest](design/manga-journal/assets.json) 及 [完整生成提示詞](design/manga-journal/prompts.json) 已存入 repo。

user-data 仍 v4、十九份 migration 不變；本次沒有 migration push、remote reset、Auth／RLS 設定或正式帳號資料操作。兩個既有線上 QA 帳號與假資料保留未動。

## 本次工作流

| 閘門 | 本次結果 |
| --- | --- |
| lint／typecheck／unit／build／asset／base | 通過；91 檔 1,418 單元、39 Node，十九份 migration 結構與 root／subpath 資產檢查過 |
| WebKit smoke | 通過；8 passed（36.5 秒），實際 Asia/Taipei |
| database | 通過；10 檔 386 pgTAP、兩項權限負控制與 74/74 還原、兩種競態、types、真實 HTTP 17/17（實際 UTC），兩個假帳號已清理 |
| Chromium mobile／desktop | 通過；297 passed／13 skipped（16.8 分鐘），沒有 failed／flaky |
| Build for Pages | 通過；27 秒，公開設定、資產、base、既有公告守門皆過 |
| Publish to Pages | 通過；14 秒，整輪六 jobs 共 18 分 14 秒 |

以上以本次部署自己的 jobs 為準，不以候選 PR 的 CI 代替部署 gate。Pages 成品 JS 含 worker 為 **747,141 raw／220,244 gzip bytes**、CSS **119,236／29,242**，沿原門檻；六張 WebP 合計 216,788 bytes，手機四張 59,712。沒有更動 dependencies、CI 或 worker template。

## 公開成品

2026-10-29T10:53:16.869Z 唯讀公開站台，version.json 為 0.4.6「漫畫手帳新風格」且與提交的 metadata 相同。本次 `github-pages` artifact `12891576874` 的 run／main 為 `40858598356`／`22a0dfb`；下載 ZIP SHA-256 `7d704a6fe2deb97b6c142444c1e44270b4f8dfb3e72bb9d2aaff5833ccfb424d` 與 GitHub metadata 及上傳 log 相同。

在記憶體讀取 ZIP 內 Pages tar，首頁、主 JS、CSS、worker、version.json、manifest 及五張獨立輸出 WebP 共**十一項公開回應，與本次 artifact 逐 byte 相同**；第六張紙面 inline 在 CSS，SHA-256 與素材 manifest 相同。主 JS `index-CWPkTEkR.js` 為 745,346 bytes，SHA-256 `3ca4becb0ebeb777902a127ca5f0a0171548920d69f67d372c33e1396ece58b8`。不用 Windows dist 冒充發布 artifact。

CSP、manifest `./` scope、預期家庭／分享及 Supabase project 都存在。公開 Auth health／settings 皆 200，Email／Google／註冊開啟、Email 需驗證；沒有輸出 key 或讀取帳號資料。完整 hashes、flags、更新保存與畫面量測見 [postflight JSON](deployment-postflight-2026-10-29.json)，不含臨時下載網址或憑證。

## 真正舊 client 更新保存

Browser plugin 未提供，沿官方 Playwright CLI，使用正式站台的隔離遊客 session，沒有 seed、mock、路由攔截或登入帳號。前輪保留的瀏覽器已關閉，所以在發布前重新開啟線上 0.4.5，以 UI 建立「漫畫手帳更新保存驗證」（2026-10-29 09:00–10:00）並選暖陽／深色，舊基線不混用。

2026-10-29T10:35:28.619Z，舊 client 使用 `index-MpigNYhS.js`，設定明確顯示 v0.4.5，worker scope `/DayPop/`、active 已接管、沒有 waiting，快取只有 `daypop-app-shell-0.4.5`。`daypop.user-data` 是 schemaVersion 4／revision 3／994 bytes，SHA-256 `08db7a232512b921882a3ff4f6f2d59139e81df1a78f67544a22f3ff5c0d8853`，實際 browser 時區 `Etc/GMT-8`。

發布後同一個 client 經「檢查更新 → 立即更新」由 **App 自行 reload**。任何手動 reload 前，2026-10-29T10:55:01.342Z 已確認 `PerformanceNavigationTiming.type=reload`、script 為 `index-CWPkTEkR.js`、seen 為 0.4.6、active worker 已接管且無 waiting，只餘 `daypop-app-shell-0.4.6`。

資料仍為相同 994 bytes／v4／revision 3／上述完整 SHA-256，暖陽／深色偏好保持，漫畫獨立圖片請求為零；日詳情實際讀到「09:00–10:00 漫畫手帳更新保存驗證」。此時才手動 reload，2026-10-29T10:55:38.883Z 的資料、偏好、cache 及無圖片請求再次相同。**完成以上保存驗證後**才透過 UI 切換漫畫淺／深色作視覺驗收；後續主題切換不混入舊基線。

## 線上畫面與界線

正式站台另開全新隔離遊客 client，390×844 首次公告正確顯示三條 0.4.6 內容，矩形 x15／y244.09／360×355.80，內容與「知道了」完整可見。新使用者預設漫畫淺色，手機沒有請求桌面工作桌圖片。原更新 client 的 1280×900 仍使用 404×824 canonical 手機展示框；桌面淺／深各解碼自己的獨立工作桌，手機淺／深均解碼頁首、紙邊、分頁及 inline 紙面。原貓圖仍為原 120px 素材／60px 操作區，filter none、opacity 1、blend normal。

在手機原生表單建立「一起安排生活：週末採買與散步，長標題仍可清楚編輯」，搜尋讀到同一標題，開啟編輯後取消，綜覽顯示一筆；reload 後原標題及漫畫深色仍在，週／列表可操作。長設定頁的家庭、分享、備份與隱私卡片可捲動閱讀；「登入分享日曆」開啟 Auth，x15／y124.89／360×594.22，Email／密碼／Google 控制完整可見，Escape 焦點返回原入口，未登入帳號。

兩個 client 的 console 均為 0 errors／warnings，無水平溢出，實際 `Etc/GMT-8`。首張表單截圖恰在既有開啟動畫中途，已丟棄並等待有限動畫完成後重拍；穩定表單 opacity 1、底色 rgb(26,26,26)，可捲到備註／附件／提醒說明，沒有背景透出或控制遮擋。以下六張正式站台截圖逐一目視，並與既有概念的區域分工對照：

- [桌面淺色](design/manga-journal/screenshots/published-desktop-light.png)／[桌面深色](design/manga-journal/screenshots/published-desktop-dark.png)
- [手機深色日曆](design/manga-journal/screenshots/published-mobile-dark.png)／[長設定頁](design/manga-journal/screenshots/published-settings.png)
- [原生表單](design/manga-journal/screenshots/published-form.png)／[表單下方](design/manga-journal/screenshots/published-form-bottom.png)

臨時驗證程式、下載檔與其餘截圖留在 TEMP，沒有加入產品或臨時測試頁。本次沒有啟動本機 server；兩個具名 CLI session 在驗證後關閉。交接只更新文件與證據，依自己的四 CI／同 head 完成審查後合併，不再觸發部署。

手機為 viewport 模擬，沒有實體手機／standalone／螢幕閱讀器、Email 寄達或 Google OAuth 驗收；DP-034 正式放行界線不變。本次不擴充雙人功能或寵物素材。0.4.5 與歷史公告未回寫；0.4.6 一經發布，其公告也不可回寫。
