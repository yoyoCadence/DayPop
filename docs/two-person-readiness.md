# 雙人使用完成矩陣

依 2026-10-27 擁有者「雙人使用的功能持續開發完畢」委託收尾，範圍採 [ADR §9](architecture-decisions.md#9-家庭群組與分享dp-0442026-10-18-定案) 已定案的家庭與日曆分享。每人用自己的帳號，選擇分享哪本日曆，以 view／edit 及單項私人控制存取；仍使用手動／前景重新確認，不加入尚未定案的 Realtime、自動寄邀請、共享附件或帳號轉移。

| 日常流程 | 產品及證據 | 本輪接續 |
| --- | --- | --- |
| 各自登入、保存與私人隔離 | 0.4.4 線上專用雙帳號已驗；HTTP 登出／新 client 真正密碼登入回讀 | 已有 |
| 建立家庭、Email 綁定邀請與明確接受 | 線上 UI、HTTP 及 pgTAP；取消登入可重回邀請的 DP-207 已在 main | 取消登入修正尚未部署 |
| 分享歷史／未來非私人事項、edit／view／off | 線上 UI；HTTP 過期操作拒絕、RLS 直接查詢及本人資料保留 | 已有 |
| 共用待辦完成、子項與刪除 | DP-211 真實 HTTP、UI harness 與 pgTAP，含私人後代及過期版本整樹拒絕 | 已有 |
| 退出、移除、解散與再加入 | DP-212 真實 HTTP 14/14，三獨立舊編輯請求拒絕，資料保留、再次明確接受 | 已有；保留線上 QA 未做此破壞家庭的操作 |
| 分享服務暫不可用及原畫面恢復 | DP-213 修正重試入口消失；手機／桌面重試失敗再恢復、本人快取不變、帳號邊界回歸 | PR #209 四 CI／同 head 審查通過，已合併 71a9d25，尚未部署 |
| 雙方各自分享日曆與重複事項共同維護 | 已有產品契約、repository／UI harness／pgTAP | DP-214 補真正雙帳號 HTTP，核對群組 owner 與日曆 owner 不同時的行為 |

2026-10-28 補驗找到指定時間 recurrence 的真實產品缺口：後端 `+00:00` 與 resolver `.000Z` 的同一瞬間被當成不同次數。已拆 DP-215 修正共用 identity，10 項新單元與手機舊程式反向失敗，修正後雙 viewport 及暫用 DP-214 的四份雙向全天／紐約時間 HTTP fixture 17/17。詳 [修正證據](timed-occurrence-identity.md)。DP-215 待自己的最新 CI／審查及合併，DP-214 保存在獨立分支，永久 HTTP 驗收及雙人矩陣仍待該段自己的 PR；不能把暫跑成功寫成全部已結案。

DP-213 瀏覽器流程為 `http://127.0.0.1:4173/e2e/auth.html` → 密碼登入 harness → 分享查詢失敗 → 仍可按「重新確認分享」→ 再次失敗仍收起 received → 服務恢復後以 Enter 重試 → 同頁讀回分享。Browser plugin 未提供，採 repo Playwright；頁名 `DayPop Auth E2E`、390×844／1280×900、實際 `Asia/Taipei`、console 0 errors／warnings、無水平溢出與 framework overlay，TEMP 的故障及恢復截圖已目視。這是正式 UI 與 repository 搭配 FakeSupabase，不能冒充真實 Auth／RLS／正式站台結果；真實 HTTP 證據另見 [各輪紀錄](family-sharing-http.md)。

截至 DP-213，本機完整 1,408 單元＋39 Node、lint／typecheck／build／check:build、相關 Chromium 19 passed／1 skipped 與 WebKit 8 passed；自己的最新 head 四 CI 與同 head 完成審查仍需通過才能合併。每段維持獨立 PR，後續從已合併最新 main 接續。

目前公開版本仍是 **0.4.4**、遠端 migration **19 份已對齊**。本輪不部署或套用遠端 migration；功能合併與線上發布分開記錄。Email 驗證信寄達、Google OAuth 與實體手機不由本輪模擬／HTTP 測試宣稱完成，DP-034 正式放行界線保留。既有兩個線上 QA 帳號與假資料保留，憑證只在擁有者本機 TEMP；寵物後續素材仍暫緩。
