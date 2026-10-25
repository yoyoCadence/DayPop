# 已確認待辦完成的 jump 回饋（DP-197）

2026-10-25。以獨立分支暫接 DP-195 `20e3dc4` 與 DP-196 `73c7341` 準備；registry PR #191 head `e9d40a5` 四項 CI、完成審查無發現／無未解決討論後合併 `4ef75ce`（run `40145125378`，Chromium 275 passed／13 skipped、WebKit 7 passed）。本段已移至此最新 main，只送完成回饋與驗證，不重送素材。自己的最新 head 四 CI／審查仍須通過才合併，沒有部署。

## 行為契約

原素材規範把完成待辦列為 jump 的觸發，原型的 `petSay(..., 'jump')` 還會開啟稱讚泡泡與累加 XP。本段只接已確認完成命令的單次 1 秒素材，不帶入 XP／升級／新泡泡／選角／偏好。

`DataProvider.toggleTodo()` 保留 DP-189 的 `Promise<void>` 確認、拒絕與 queue 行為。repository 只切換指定 id 的 `completedAt`，缺 id 不新增；因此成功結果內該列存在且 `completedAt` 非空，才代表這次命令完成了目標。取消完成、失敗、缺 id、載入／前景重查／匯入不發訊號；父子各自獨立，不因子項完成替父項發訊號。再次取消再完成是另一次 UI 命令，可以再次播放，沒有獎勵 ledger 或成長資料。

`todoCompletionFeedback.ts` 由每個資料 identity 擁有，只向訂閱者發出無 payload 的短暫訊號。命令**發起時**擷取訂閱項目；保存確認時只通知其中仍存在的項目。切分頁重新掛載、關閉寵物、帳號切換不會繼承舊通知；沒有待播陣列、全域事件、id／帳號資料或持久化。卸載時清空訂閱，回饋 handler 的錯誤不改變已保存命令的確認。

日曆 `PetLayer` 訂閱後，以 `useEffectEvent` 讀取確認當下的最新狀態。背景、暫藏、收起、泡泡、look、grab 都直接略過，不排隊；idle／sleep 可以轉 jump，新的成功命令會用新 cue 重播。打開泡泡或開始移動會取消現有 jump。跳躍不搬動 60×60 操作區、不搶焦點、不改徽章規則。

`PetArtwork` 的單次完成 callback 改名為 `onCueDone`，look 與 jump 共用解碼後的各自時長。PNG／reduce 的 cue 也正常結束；隱藏／背景、圖片失敗會丟棄 cue，恢復時不補播。過期解碼與舊 timer 不能完成新 cue。沒有修改圖片、資料 schema、repository、Auth、版本／公告或 worker 快取政策。

## 驗證與限制

收尾再次通過 lint／typecheck／build／check:build，161 個本機 Markdown 檔案連結存在。CLI 工作階段已關閉，兩次啟動的本次 Vite server 都已核對監聽 port／CommandLine 後停止；沒有留下產品 QA 入口。

新增基線先在舊程式得到五項真正斷言失敗（資料訊號三、jump 計時一、Layer 接線一）。首輪另有測試 helper 重名造成 suite 無法解析，已修正後才取 Layer 的失敗證據；該解析錯誤不算產品回歸。

完整 88 檔 1,402 單元＋29 Node、lint／typecheck、build／check:build 通過。JS 747,251 raw／220,185 gzip，CSS 112,388／27,272 bytes；圖片仍貓 196,286／飛碟 173,845，每款 196,608 上限不變。睡眠測試曾沿用切換 fake timers 前建立的時鐘，改成先卸載再建立受控時鐘，沒有改產品門檻。

五組循序反向驗證：停用通知兩項失敗、延後擷取收件人一項、移除 identity 清理一項、移除 jump 單次生命週期五項、移除優先條件一項。`finally` 逐 byte 還原後 75 項相關回歸再過。還原 SHA-256：

| 檔案 | SHA-256 |
| --- | --- |
| `src/data/DataProvider.tsx` | `210951170e400002fc504b5149a98bd1fc2f8589efc827bd5ddd49f2bc988b9a` |
| `src/data/todoCompletionFeedback.ts` | `9c74c00633e2605a2349336f534585cdce1597f2c105f5151b6f9aa562e6cd7a` |
| `src/screens/calendar/PetArtwork.tsx` | `b065f620c70b7790ba000dc32e03e5847812af588061dc267df3f25227b6f257` |
| `src/screens/calendar/PetLayer.tsx` | `62849ef4b8226eca66a1eb6c9d88816473f8dab2b2f253afcb0d904a6ceb3cca` |

第六組把 CalendarScreen 傳給角色的訊號改成 undefined，真實手機完成流程因仍停在 idle 失敗；finally 還原 SHA `ec587bc3cb3c5767dfc9f2b21e9c0c0876db15e5a16435632289bef0990bc4fa` 後，同一案例恢復通過。不是只測孤立元件。

Browser plugin not available，使用專案 Playwright 與 CLI。後端設定明確清空，只用固定遊客資料。新增 Chromium 八項與 WebKit 一項 jump 通過，既有 WebKit 七項通過；另跑 pet-assets／pet-bubble／production-offline 得 26 passed／2 既有桌面 skipped，去重合計 42 passed／2 skipped。每輪印出實際 browser `Asia/Taipei`，Node `Etc/GMT-8`。首輪 WebKit pointer 不保證聚焦，改成先 focus／Enter 才驗證焦點；錯圖與先前成功下載共用 URL 的案例改成獨立新頁冷啟動，保留損壞圖片的實際請求斷言。

CLI 另在 390×844 與 1280×900、漫畫淺／深色四個 context 用原生 timers／WebP 解碼取兩張不相同幀，約 1.03–1.05 秒回 idle。實際時區均 `Asia/Taipei`，手機 `(26,706)`／桌面 `(466.5,704)` 的 60×60 操作區前後不變，焦點留在列表待辦，完成資料存在、無水平溢出／console error。截圖 `daypop-dp197-{mobile,desktop}-{light,dark}.png` 在 OS TEMP，手機淺色與桌面深色已目視。第一輪 CLI 未輸出 console，補回傳時區結果後才列為佐證；多行引號失敗後使用官方 `run-code --filename`。

另補真正 production service worker 的首次離線完成流程，手機／桌面兩項通過：確認 jump 尚未快取、離線發出命令、實際圖片下載失敗，完整資料只有目標 completedAt 與一筆 revision 改變，畫面回已快取 idle，焦點仍在待辦；離線 reload bytes 不變、不再請求 jump，失敗回應沒有入 cache。首輪只漏列 reload 的精確 `version.json?ts=<固定瞬間>` 預期斷線 URL，補上此固定 URL 後 console 守門通過，沒有忽略其他失敗。加上前段去重合計 44 passed／2 既有 skipped。

發 PR 前須對齊最新 main，並通過自己的四項 CI／審查。沒有真 iPhone／standalone 或真實帳號驗收；新動作品質不代表擁有者已目視採用。DP-171／172／041 與七態預算仍未結案，App 0.4.3／user-data v4／18 migrations 不變。
