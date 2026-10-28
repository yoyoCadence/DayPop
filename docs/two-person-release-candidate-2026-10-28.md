# 0.4.5 共用日曆修正候選（DP-216）

**候選尚未發布，公開仍是 0.4.4。** 本段把雙人功能收尾後的三項前端修正包成可審核的 0.4.5：取消邀請登入後返回同一邀請、分享載入失敗保留手動重試、指定時間重複事項取消／替換的同瞬間識別。不新增產品能力、migration 或 Auth／分享權限；user-data 仍 v4，遠端十九份 migration 不需重推。線上 QA 帳號與假資料沒有操作。

## 來源與候選內容

從 DP-215／PR #210 合併 `ec53398` 的最新 main 獨立準備；DP-214／PR #211 等待期間完成本機驗證，發自己的 PR 前再對齊 #211 合併後 main。#210 的四 CI／同 head 審查已通過，#211 的永久 HTTP 十七組見 [雙人矩陣](two-person-readiness.md) 及 [驗收紀錄](family-sharing-http.md#dp-214-雙向分享與重複事項收尾2026-10-28)。

只新增三條短公告、package／lock 的 App 版號與 generator 輸出 `public/version.json`／`public/sw.js`。全部八份歷史 release entry 與準備基底逐欄相同；沒有改 worker template、快取清理規則、使用者文件、依賴版本或既有 0.4.4 公告。

## 驗證

| 檢查 | 結果 |
| --- | --- |
| lint／typecheck／完整單元及 Node | 1,418 單元＋39 Node，全部通過 |
| `/DayPop/` production build／check:build | 通過；JS 含 worker 747,115 raw／220,218 gzip bytes，CSS 113,935／27,313，原預算不變 |
| 公開歷史公告守門 | 明確確認 0.4.5 可取代線上 0.4.4，該版內容未變；另外核對全部八份舊 entry 相同 |
| 相關 Chromium／WebKit | 45 passed／3 既有 skipped＋WebKit 8 passed，合計 53 passed／3 skipped（2.4 分鐘） |
| production 頁面身份與非空 | `http://127.0.0.1:4174/DayPop/`、頁名「日蹦 DayPop」、四分頁及主要內容正常 |
| framework overlay／console／版面 | 無 overlay，兩 context 各 0 errors／warnings，無水平溢出 |
| 公告、登入入口與互動 | 三條公告／「知道了」都在畫面內；Google／Email／密碼入口啟用，Escape 關閉交回焦點，reload 不重複公告 |
| 截圖 | 390×844／1280×900 公告及登入四張 TEMP 圖已逐張目視 |

Browser plugin 未提供，使用 repo Playwright。相關 specs 為 `family-groups`、`calendar-sharing`、`release-notice`、`production-update`、`production-offline`、`update-dialog`、`webkit-smoke`，不改 timeout／workers／retries／CI 四 gate；browser 實際時區均印出 `Asia/Taipei`。production 更新 fixture 使用候選及測試專用 `999.0.0` 兩份真正 build，驗證自動 reload、失敗後重試、遊客 bytes／偏好保存及離線；不能當成公開站台已從 0.4.4 更新到 0.4.5。

另以全新 production 遊客 context 檢查公告 → 關閉 → 四分頁 → 登入分享日曆 → Escape → reload；沒有輸入帳號或呼叫雲端寫入。公告矩形手機為 x15／y264.92／360×314.14，桌面 x463／y282.92／354×314.14，實際 `Asia/Taipei`。截圖僅在 TEMP 的 `daypop-dp216-{mobile,desktop}-{release,auth}.png`，不提交到 repo。

驗證設定曾有兩個等待／前置問題：公告守門第一次在新 build 尚未完成時讀到舊 dist，後來在 0.4.5 build 完成後重跑，明確回覆替代 0.4.4；本機 preview 首次漏 `/DayPop/` 啟動前綴造成資產找不到，補成與建置相同的 base 後兩 viewport 重跑成功。均沒有改產品或放寬斷言。候選 `dist/version.json` SHA-256 為 `2d3e0211fdaa82f71c1dc360a3c3ac91d80e99df1e8bb6e381636a197e4457ee`；這是本機成品，發布後仍須以該次 GitHub artifact 與公開回應做 postflight。

## 發布動作與保留界線

本段自己的最新 head 四 CI／同 head 完成審查無發現、無未解決討論後，依既有授權合併。擁有者若明確同意發布，再從合併後 main 執行既有 **Actions → Deploy staging → Run workflow**；保留四品質 gate、Build for Pages、Publish to Pages 與公告守門，目標是既有 `https://yoyocadence.github.io/DayPop/` 的 0.4.5，不改工作流、repository 設定或資料庫。

本輪沒有 dispatch。理由沿 [ADR §9](architecture-decisions.md#9-家庭群組與分享dp-0442026-10-18-定案) 的明文「自動合併授權不等於自動部署」，以及 [deployment §3.4](deployment.md#34-觸發部署) 由擁有者決定發布時機；先完成可審核候選，再請擁有者針對本版決定。

發布後才核對六 jobs 成功、公開 version／bundle／artifact 一致、真正舊版更新保存及新版本入口。Email 寄達、Google OAuth、實體手機／standalone、螢幕閱讀器及 DP-034 正式放行不由本輪的本機 UI／HTTP 冒充完成；寵物後續仍暫緩。
