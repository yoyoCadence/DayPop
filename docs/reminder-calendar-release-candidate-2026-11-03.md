# 0.4.7 提醒與月曆聯合版本候選（DP-233）

2026-11-03 開始準備，11-04 接續。依擁有者「提醒完成後一起發布」的選擇，將已合併的背景提醒、可切換單月翻頁及自動列數滑動修正整理為同一版本，公告日期為 2026-11-04。這是候選交接，**公開站仍是 0.4.6，本段沒有 dispatch 或正式後端寫入**。

## 合併基線與範圍

前置 PR #228 最終 `25a4b9c` 的四 CI `41654578744` 全過，且同 head 審查 completed、無發現、無未解決討論後合併為 main `23916f5`。Chromium 325 passed／19 skipped（20.9 分鐘）、WebKit 12 passed、478 pgTAP、提醒 HTTP 23/23、管理操作 rollback 17/17，實際 UTC。本候選從隔離工作區暫接該依賴完成驗證，再對齊此最新 main 開獨立 PR。

只更新 package／lock 的 release version、生成的 PWA 版本資產、0.4.7 四條公告與交接文件。App runtime、worker template、依賴、22 份 migration、user-data v4、CI／worker／retry／timeout 及產物預算不變。十份歷史公告逐項相同，package／lock 除 release version 外完全相同。

0.4.7「翻月與日曆提醒」公告：

- 月曆可切換連續捲動與單月翻頁，單月支援左右滑動換月。
- 修正自動列數跨月滑動時的畫面跳動。
- 登入後可依日曆設定背景提醒，並在每台裝置明確開啟通知。
- 提醒設定失敗保留輸入；登出會嘗試停用這台裝置的通知。

公告與版號合併不代表提醒正式啟用。上線需接 [後端與排程操作交接](reminder-release-readiness-2026-11-03.md)，先確認後端健康再聯合部署。

## 候選驗證

| 檢查 | 本機結果 |
| --- | --- |
| lint／typecheck | 通過 |
| 完整單元與 Node 回歸 | 1,802／102 檔（108.63 秒）＋39 Node，通過 |
| Pages build／check:build | 通過；相同產物預算與 CSP／本機依賴檢查 |
| 公告不可回寫／canonical reminder bundle | 通過；歷史十份公告與核心 bundle 不變 |
| Chromium 聯合相關流程 | 50 passed／8 skipped（5.3 分鐘），手機及桌面；略過為既有桌面共用矩陣／橫向重複案例 |
| WebKit 完整既有流程 | 12 passed（1.6 分鐘） |

Chromium 範圍為 release-notice、production-update、production-offline、update-dialog、month-paging、adaptive-scroll、reminder-settings。Playwright 實際列印 Asia/Taipei／America/New_York；WebKit 實際 Asia/Taipei。Browser plugin 本環境不可用，沿既有 repo Playwright 執行，沒有降低門檻或更改案例斷言。

production-update 測試使用本候選 **0.4.7 → 測試版 999.0.0**，驗證更新與資料保存機制；不可寫成真正公開 0.4.6 用戶已更新。本次手動 production QA 也只有舊版「已讀公告」marker，未載入公開 0.4.6 bundle。真正線上舊客戶端更新須在發布後另驗。

以既有本機設定中的兩個公開 Supabase 欄位、經 canonical browser-safe key 檢查後建立 Pages production build；沒有複製 `.env`、登入正式帳號或要求 OS 通知權限。JS＋worker 795,896 raw／235,263 gzip，CSS 121,024／29,600；原上限不變。無正式 env 的隔離 build 為 795,818／235,202，差異來自公開設定。

## production 畫面及保存

390×844、1280×900、320×568 三個獨立 context，實際 Asia/Taipei：

- 首次公告版號／四條內容及 CTA 可見，含 320px 短畫面；關閉後重載不再出現。
- 四個分頁、單月模式／前後月、遊客提醒停用說明、Email 登入入口／Escape 關閉及回焦正常。
- 沒有水平溢出，各自 console 0 errors／warnings。
- reload 前後遊客 envelope bytes 與單月裝置偏好精確不變。
- 桌面另以合成的暖陽／深色 fixture（v4、revision 7）驗證既有偏好不被新版本覆寫：4,139 bytes，SHA-256 `62ce08a92ba77e327780b367d79b92c9a1c9a803e6c3b0cf1a3094f322553a49` 前後一致。

六張本機 TEMP 圖片已目視：phone／desktop／short 的 notice 與 month。這是 viewport 模擬；沒有宣稱真機手勢、OAuth、Email 收信或 OS Push 通過。preview server 已核對 PID／命令後清理，獨立 Supabase 測試 stack 也已停機、測試帳號與資料清空。

## 下一步與界線

本候選自己的最新 head 四 CI、同 head 完成審查且討論全解後才合併。DP-234 再依既有 migration 執行責任完成三份正式 migration／22 檔對齊、提醒秘密／sender／每分鐘排程與持續更新的 key-bound heartbeat，再用既有 Deploy staging 發布同一 main，核對公開 artifact 與真正舊版更新、資料／偏好／單月設定保存。

[ADR §9](architecture-decisions.md#9-家庭群組與分享dp-0442026-10-18-定案) 指定「migration 由專案擁有者用 CLI dry-run／push」。2026-11-04 擁有者針對已列出的 `20261029123000`、`20261031090000`、`20261103000000` 及 PR #228 的提醒專用秘密／函式／每分鐘排程明確答覆「授權你依清單代跑三份 migration 並完成提醒正式設定」。DP-234 依此次具體委託接續，不將授權延伸至其他 migration 或服務；本候選本身未操作正式環境。iPhone 加到主畫面後的背景收信與自動列數／左右翻月實機複驗，仍須擁有者參與，不能由本機替身或 provider HTTP 成功替代。
