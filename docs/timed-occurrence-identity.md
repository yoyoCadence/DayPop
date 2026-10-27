# 指定時間重複事項的同一瞬間識別（DP-215）

DP-214 的真正本機 Auth／PostgREST 雙帳號驗收發現：`2026-10-27T13:00:00+00:00` 與 `2026-10-27T13:00:00.000Z` 是同一瞬間，原本卻以字串作為 occurrence identity。因此重新載入後，指定時間的取消會復活，單次替換會同時顯示原次數及替換列；再次操作也可能新增第二份 exception。這個問題同時影響本人與收到的日曆。

`src/domain/eventOccurrenceKey.ts` 統一 resolver、domain mutation 與 repository RPC 合併的識別。只把時間的整秒換算為 UTC，將小數尾零正規化；小數仍以文字保存，不能用 JavaScript Date 的毫秒精度把不同微秒合併。全天仍依日期。只比較 identity，不改寫 stored startsAt／endsAt／exception、updatedAt、CAS token、快取或 schema；一般 `.000Z` 的既有畫面 key 格式保留。

## 驗證

- 新增 9 項 domain 及 1 項 repository 回歸：UTC／正負 offset、不同小數表示、取消、替換只顯示一次、重編保留 ID、取消替換清除舊列、微秒區分、畫面 key 穩定，以及已提交但遺失回應後重試的 RPC 合併。三個產品檔暫還原至 main 舊版時 10/10 失敗，finally 逐 byte 還原修正後通過。
- 新增手機／桌面 received 日曆畫面案例。舊版手機在原行程列數斷言失敗；修正後 19／22 日原次數各一筆、20 日替換只有一筆、21 日取消不出現，重新確認分享仍相同，原始 `+00:00` 列未重寫。
- Browser plugin 未提供，使用 repo Playwright：`http://127.0.0.1:4173/e2e/auth.html`，頁名 `DayPop Auth E2E`，390×844／1280×900、實際 `Asia/Taipei`，內容非空、無 framework overlay／水平溢出、console 0 errors／warnings，TEMP 截圖已目視。這是正式 UI／repository 搭配 FakeSupabase，不冒充真實 Auth／RLS。
- 暫用獨立保存的 DP-214 驗收 script，對專用本機 19 檔無 link stack 跑真正雙帳號 HTTP：17/17，包含 A→B／B→A 的全天及 `America/New_York` 09:00 四份 recurrence fixture，單次替換／取消、owner reload、過期版本拒絕、私人整個 graph 的直接 HTTP 隱藏及恢復；實際 Node `Etc/GMT-8`。兩個隨機假帳號已清理，script 精確還原。17 組永久 CI 接線仍由後續 DP-214 獨立 PR 提交；本 PR 既有 HTTP 仍為 14 組。
- 完整 1,418 單元＋39 Node、lint／typecheck／build／check:build 通過；相關 Chromium 21 passed／1 skipped、WebKit 8 passed。自己的最新 head 四 CI／同 head 完成審查須另行通過才合併。

## 接續與界線

從 PR #209 合併 `71a9d25` 接續。該 PR head `5cb2b01` 的 CI `40507098561` 四項成功、同 head 完成審查無發現且無未解決討論後已合併；DP-213 不再是待送 PR。

本段完成後，返回保存的 `test/dp-214-bilateral-http`／`ab9f2da`，移除暫時診斷輸出，重新核對四份 fixture 及負控制，再以自己的 PR／CI／審查完成雙人矩陣。尚未將 DP-214 宣稱結案。公開仍 0.4.4，遠端 19 migrations 不變，沒有新版公告或部署；保留的線上 QA 帳號未操作。Email 寄達、Google OAuth、實體手機及 DP-034 正式放行仍維持原界線，寵物暫緩。
