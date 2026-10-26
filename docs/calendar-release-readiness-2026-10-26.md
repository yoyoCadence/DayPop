# 多帳號與共用日曆發布準備（DP-205）

2026-10-26。擁有者明確要求優先讓不同帳號開始使用行事曆，包含共同維護分享事項。寵物後續素材／registry／播放政策暫緩；已完成的 DP-204 本機試作保存在遠端 `feat/dp-204-pet-local-step`／`3d344f2`，未自己的 PR／CI，不納入本項。

> **完成更新：** 擁有者已明確授權，本次 Deploy staging #16 成功發布 0.4.4，線上入口、artifact 與舊版更新保存已驗。完整結果見 [發布驗證](deployment-verification-2026-10-26.md)。下方候選／尚未 dispatch 敘述保留為準備時的紀錄。

本項準備 0.4.4「家庭日曆一起用」，只新增本版公告與對應 App／PWA release assets、使用指引及發布驗收紀錄。家庭／日曆分享程式已由 DP-047–049 合併；不新增 migration，不改 user-data v4、Auth／RLS／repository 或既有寵物播放政策，不操作正式使用者內容。

## 當前阻擋點

已直接讀取線上 [version.json](https://yoyocadence.github.io/DayPop/version.json)，仍是 0.4.3。公開首頁載入 `/DayPop/assets/index-CH_sPwz5.js`（681,737 bytes），其中沒有 `calendar_sharing_manifest`／`calendar_group_shares`；GitHub Actions 的 [Deploy staging](https://github.com/yoyoCadence/DayPop/actions/workflows/deploy-staging.yml) 最新成功 run 仍是 2026-10-18 的 `39093740111`。目前線上確實還沒有分享前端。

本機唯讀 `supabase migration list --linked` 的目標為既有 DayPop `aquhcaduovkxyfhzywgc`；18 筆 local／remote 全相同，最後兩筆為 `20261018045829` 家庭與 `20261019104837` 日曆分享。沒有重推、reset、repair 或 DDL，也沒有查詢任何 users／日曆內容。先前完整 [家庭權限矩陣](family-sharing-permissions-verification.md) 與 postflight 保留為既有證據，本次沒有冒充重新執行遠端 pgTAP。

公開 Auth `/health`／`settings` 回 200；Email、Google、註冊開啟，Email auto-confirm 關閉，使用者需完成驗證信。只輸出公開設定是否存在及允許的 flags，沒有輸出 key、登入、註冊或讀取任何帳號資料。Node 實際時區 `Etc/GMT-8`。

## 候選與交付範圍

0.4.4 六條短公告涵蓋家庭邀請、日曆分享、共同維護與私人事項、前景重查／衝突草稿、個人備份邊界及有界月曆。0.4.3 等七份既有 release entries 逐欄不變；package／lock 只改 App 版號，`public/version.json`／`public/sw.js` 由既有 generator 產生，worker template 不改。

實際兩帳號入口與預期結果見 [開始使用共用行事曆](shared-calendar-start.md)。文件依目前 UI 的「產生邀請連結」「設定日曆分享」「重新確認分享」撰寫，區分共用 edit／view、日曆擁有者的私人事項、手動交付邀請連結與收到分享的非持久化界線。

## 本機驗證

lint、typecheck、88 檔 1,402 項 Vitest 與 29 項 Node 通過。以既有公開 Supabase 設定執行 `npm run build -- --base=/DayPop/`／`check:build` 通過；JS 含 worker 746,981 raw／220,167 gzip bytes，CSS 113,935／27,313，每款寵物 174,308／152,194 bytes，全部沿原門檻。`check:release-notes -- https://yoyocadence.github.io/DayPop/version.json` 確認 0.4.4 可取代線上 0.4.3 且舊公告不變。以上在 PR #197 合併基底執行；隨後 rebase 至 PR #198 合併 `ad7a540`，該次只有素材／交接文件，產品來源與本項 release bytes 不變。

Playwright 用空 Supabase 設定與固定假資料，跑 family-groups、calendar-sharing、auth-attachment、release-notice、production-update、update-dialog、production-offline、webkit-smoke：Chromium 42 passed／2 既有 desktop skipped，WebKit 8 passed，合計 50 passed／2 skipped（約 3.9 分鐘）。涵蓋邀請登入後明確接受、分享 view／edit／private、撤權與失敗保留草稿、收到的資料不進備份、本人最新快取、帳號附件、新版下載／安裝失敗重試、更新前後遊客資料與 production 離線保存。只排除分享視窗的兩組完整主題／橫向大矩陣，完整 CI 仍照原設定執行，沒有延長或降低任何門檻。Node 實際 `Etc/GMT-8`，這些 browser context 實際 `Asia/Taipei`。首次命令因 PowerShell 管線將中文 grep 變為 `?`、尚未執行案例即失敗；改為 ASCII Unicode escape 重跑上述全部成功。

Browser plugin 未提供，沿官方 Playwright CLI 檢查本機 **production** `/DayPop/`，使用真實公開 Auth 設定但保持全新遊客 context，不輸入／提交帳號。390×844 公告實際矩形 x15／y244.09／360×355.80，內容與「知道了」都在畫面內；設定能從「登入分享日曆」開啟登入。Email／密碼欄位、Google、登入、忘記密碼皆正常啟用，390×844／1280×900 截圖目視、console 0 errors／0 warnings，browser 實際 `Etc/GMT-8`。這只證明設定與 UI，不能當作 Email 寄達、Google OAuth 或真帳號保存驗收。

## 發布與剩餘驗收

本項中文 PR 的最新四 CI／完成審查通過後才合併；PR／run 證據後續補記。合併不等於部署完成。既有 [deployment §3.4](deployment.md#34-觸發部署) 仍由擁有者決定發布時機；目前沒有 dispatch。發布時選本項合併後的 main，工作流會重跑四項品質閘門、公開設定與公告檢查後上傳 Pages。

發布後必須再核對線上 0.4.4、公開 bundle 含分享功能、Auth UI 與 PWA 更新；兩個真實帳號依 [操作指引](shared-calendar-start.md) 驗證自己的保存及 edit／private／view／撤權。真實帳號／Google OAuth／真機結果尚未宣稱通過，DP-034 正式放行仍保留原有界線。這次不需要新 migration，也不需重推已套用的第 18 檔。

### 合併、明確發布授權與進度

上兩段為候選準備時的狀態。PR [#199](https://github.com/yoyoCadence/DayPop/pull/199) 最新 head `01f9afd6dae0ea0959fe5c0d8e78aeef3ea9559b` 的 [CI `40244805954`](https://github.com/yoyoCadence/DayPop/actions/runs/40244805954) 四項成功；Chromium 285 passed／13 skipped（21.7 分鐘）、WebKit 8 passed，9 檔 376 pgTAP、權限負控制／兩種競態／generated types 均過。相同 head 的 Codex review completed、沒有發現或未解決討論、review threads 為空後，合併為 `0629821148b7fb33219cde5e778ddecdfb6150f2`。

2026-10-26 擁有者針對「從 main 執行既有 Deploy staging，發布 0.4.4」明確答覆「可以 繼續吧」，本次發布已獲授權，不需再次確認。已觸發 [Deploy staging #16／`40253002837`](https://github.com/yoyoCadence/DayPop/actions/runs/40253002837)，頁面與 commit 連結確認來源 `0629821`／main。全程沿既有四項品質閘門 → Build for Pages → Deploy to Pages，沒有變更 workflow／repository 設定、密鑰、資料庫或使用者資料。此授權只記錄本次 0.4.4，不自動變為未來任意發布授權。

發布的四項品質閘門、Build for Pages、Publish to Pages 六項全部成功，Chromium 285 passed／13 skipped、WebKit 8、1,402 單元＋29 Node／376 pgTAP 全過。線上六項公開成品與此 run 的 artifact 逐 byte 相同。真正線上舊 client 由 0.4.3「立即更新」自行 reload 到 0.4.4，原本 v4／revision 1／990 bytes、SHA-256 `cb2208df17fcf31649364e1dc15c47e8c08c9c178c5b02c4f35c1d5039257b93` 不變；之後手動 reload 仍可讀到「發布更新保存驗證」，只餘新版 app-shell cache。這筆只在新建本機遊客 profile，不曾登入或寫入雲端。完整範圍、等待腳本修正、hashes、版面／入口與剩餘真帳號驗收見 [發布驗證](deployment-verification-2026-10-26.md)。
