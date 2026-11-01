# 瀏覽器提醒 adapter（DP-228）

2026-11-01，從 DP-227／PR #223 最終 `10089f3` 四 CI `41273545673`、同 head 完成審查無發現及無未解決討論後合併的 `cff0a15` 接續。依任務粒度，先分出瀏覽器原語，再由 DP-229 整合帳號註冊／撤銷生命週期，最後接 canonical UI。此段仍無 App caller，公開 0.4.6 不變。

## 權限與 worker

`src/reminders/browserPush.ts` 的 `BrowserReminderDevice` 不存取帳號、資料庫或裝置儲存。預先檢查安全連線、必要 API、iPhone／iPad Home Screen 狀態及後端 enabled／public key；沒有符合條件就拒絕，不申請權限。iPad 桌面 UA 另以 MacIntel＋觸控判斷，實際能力仍須存在。[WebKit Home Screen Web Push](https://webkit.org/blog/13878/)。

`prepare` 只讀已存在且 scope 完全相同的 registration，要求 activated worker 回覆公開 v1 握手。worker 新增 `GET_REMINDER_CAPABILITIES`／`REMINDER_CAPABILITIES` 兩欄協定，沒有私人資料；未回答、錯版、額外欄位、非 active／scope 或 1.5 秒逾時均拒絕，不觸發 skipWaiting。這可避免新版頁面仍受舊 worker 接管時直接訂閱；原本 SKIP_WAITING、更新、快取邊界保持。後續 UI 尚須提供完成更新的操作，握手本身不會更新 App。

預備只在同一 epoch／worker 且自開始未超過 30 秒時有效；換身分／可見性等生命週期由後續 caller 呼叫 invalidate。`subscribe` 必須直接由使用者動作呼叫，檢查 userActivation，第一個 await 前同步呼叫 requestPermission；已 granted 不重問、denied 不重問、略過則不訂閱。預備只可使用一次，避免並行權限視窗。

## 訂閱與本機移除

- 公開 VAPID key 解碼為 65-byte 未壓縮 key，送 `userVisibleOnly: true`。只在明確動作後重用相同 key 的既有訂閱；key 不同或無法確認時要求先完成停用，不自行輪替／轉移。[W3C Push API](https://www.w3.org/TR/push-api/)。
- 回傳只供資料服務使用的 transient endpoint／p256dh／auth／publicKey，拒絕不符 provider、key 長度／格式與首 byte 的資料；不進 React 狀態、snapshot、備份、log 或持久化。瀏覽器仍負責實際 key／Push service 驗證，本機測試不發真訂閱。
- 取消後才建立成功，或新訂閱回傳無效內容時，先移除新訂閱並重新讀取確認不存在；既有訂閱不因驗證失敗而被暗中刪除。無法確認清理就回固定 cleanup 錯誤。
- unsubscribe 先使舊預備失效，等進行中的 subscribe 完成取消清理，再讀 registration／訂閱並移除。不能只靠 unsubscribe 的 true／false 判斷，必須再讀回 null；讀取失敗或仍存在都不能聲稱已停用。沒有 registration 可確認本機無該 scope 訂閱。
- 移除不需要新的握手、權限或 Home Screen 狀態，因此能處理舊 worker／權限已拒絕的訂閱。這只確認本機，尚不代表伺服器裝置記錄撤銷；權限視窗未回答時操作仍可能等待，後續生命週期須以未確認狀態處理登出期限。

## 驗證與限制

Browser plugin／browser skill 未提供，沿 frontend-testing-debugging 的 fallback 使用專案 Playwright。

| 驗證 | 證據 |
| --- | --- |
| 新回歸 | 40 項 adapter＋1 項實際 generated worker 握手；與原 worker 共 74 項在 UTC／America/New_York／Etc/GMT-8 通過，實際時區逐輪列印。 |
| 完整品質 | 1,688 單元／98 檔＋39 Node、lint／typecheck／Pages build／check:build／canonical sender bundle 過。App `index-Dc_JOwIQ.js` 與 CSS 不變，只有 worker 新握手；JS＋worker 756,768 raw／223,208 gzip bytes，CSS 119,746／29,361，原預算不變。 |
| 真正 Chromium | 手機／桌面的公開 MessageChannel 握手、未知版本不回答、不啟用 waiting worker、不改權限／訂閱／資料，並沿原通知／冷啟動、更新／快取與儲存保留共 16 項通過，實際 Asia/Taipei。 |
| 負控制 | 移除使用者手勢、worker probe、晚到取消檢查與停用獨立重讀，各由對應單元行為斷言拒絕；真正 worker 回錯版本亦被原生案例拒絕。finally 精確還原，未把負控制腳本的語法錯誤算成行為證據。 |

還原後 adapter SHA-256 `aa4c1385507b4d89c4e5a6986a250457157337724c64220672faf7ed7f6a4f31`，template `3ceb786eb8f228ad73752cc09045ad09a2036f15c108f2fd91ddeac6f1e2acca`，generated worker `3635d82d054fba3beebb1258c274164b0a74e59f5c6f6f7e46b5a6f62ae80b4c`。錯版負控制還原後原生四項再過。TEMP 保留控制腳本與紀錄；測試只用注入的 PushManager／權限 port，真正瀏覽器只驗證既有匿名通知與公開協定，不呼叫真正 PushManager.subscribe。

自己的最新四 CI／同 head 完成審查無發現及無未解決討論後才合併。DP-229 尚須處理本人 session、持久化安全 handle、quota／future 防護、註冊補償及登出／外部帳號切換的伺服器撤銷，完成前不能接入 App。沒有 AuthProvider／UI、正式訂閱、schema、秘密／cron、版號／公告或部署；這不代表 iPhone 真機收信已通過，DP-223／042 尚未完成。
