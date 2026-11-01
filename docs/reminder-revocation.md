# 註冊補償與安全裝置收據（DP-229）

2026-11-01，從 DP-228／PR #224 最終 `ba199f7` 四 CI `41297188997`、同 head 完成審查無發現及無未解決討論後合併的 `5354543` 接續。先建立撤銷與資料原語，DP-230 再整合 controller，AuthProvider／canonical UI 另段；目前沒有 App caller，公開仍 0.4.6。

## 固定本人裝置的撤銷

`SupabaseReminderService.captureDeviceRemoval(id)` 在本人 session 確認後，只回傳固定該裝置的記憶體 closure。它保留該次 token，之後共用 client 換成 B，也只以 A 的 Authorization 移除原本 A 裝置；不能用來註冊、改規則、切換 session 或呼叫其他 RPC。token 不進儲存、收據、回應、Error 或 log。伺服器仍驗證 JWT／RLS，過期或失效就回未確認。

一般 unregister、捕捉 closure 與補償共用同一路徑：請求撤銷後，再以同一 token 查本人／指定 id 的安全 metadata，必須收到空陣列才確認本人可見紀錄已移除；void 回應不夠。五秒 deadline＋AbortController 同時限制網路與共用 SDK Auth read 卡住的情況。失敗只回固定 cleanup 文案及已驗證的 pendingDeviceId，不宣稱已停用、不自動重試。

註冊已取得合法 id、但完成時登入身分已變，先以原本 token 移除該 id 並確認，再拒絕延遲結果。若無法確認補償，保留安全 id 供後續 controller 記錄待撤銷。尚未取得 id 的未知網路結果無法靠此 helper 回滾，仍須留待確認狀態與本機 unsubscribe；不能為了找 id 自動重新註冊而把 B 的新同意轉回 A。

這不是完整登出流程。後續 controller 需在正常登出前清理、在外部帳號切換時使用先前捕捉的 closure，並在 Auth callback 外執行；不能等待 Auth 方法後才讓 callback 返回。

## 收據與摘要

`deviceRecords.ts` 以每個 operation UUID 的獨立 key 保存 scope 內 metadata，沒有整份共用 current 指標；完成一個操作只移除自己的收據，避免覆寫另一個帳號／分頁的待確認紀錄。

每筆 version 1 只准 operationId、revision、userId、scope、publicKey、fingerprint、deviceId、phase；active 必須有裝置 id 與摘要，既有非空 id／摘要不能改。嚴格 UUID 長度、欄位、phase 與 scope 驗證，拒絕額外秘密欄位。每筆最多 8,192 字元、每 scope 最多 50 筆，超量拒絕，不截斷或清空。corrupt／future 及 AppStorage memory 狀態阻擋所有寫入；寫入／移除後確認 persistence 與讀回值，quota 降級不能當保存成功。

每筆 revision 拒絕已觀察到的過期修改，**不是跨分頁的原子 CAS**。獨立 key 避免不同操作互相覆蓋；同一操作／重新登入仍需由後續 controller 監聽 storage 事件、丟棄過期工作並重新確認後端，不能從本機收據就宣稱通知啟用。

`deviceFingerprint.ts` 用 scope 分隔及 SHA-256 對高熵 endpoint 產生裝置摘要；摘要不足以投遞推播，不保存 endpoint／auth／p256dh／JWT。`BrowserReminderDevice.identity()` 只回摘要與公開 application key，沒有握手、提示或新訂閱，供 controller 比對既有本機訂閱。收據不進 v4、個人快取或備份；公開 VAPID key 也不是私鑰。

## 證據

| 驗證 | 結果 |
| --- | --- |
| 新回歸 | 32 項：service 新 8、收據／摘要 23、browser identity 1；相關三檔 132 項在 UTC／America/New_York／Etc/GMT-8 通過，實際時區列印。 |
| 完整品質 | 1,720 單元／99 檔＋39 Node、lint／typecheck／Pages build／check:build／canonical bundle 過。App JS／CSS 及 worker 與 DP-228 相同；JS＋worker 756,768 raw／223,208 gzip，CSS 119,746／29,361，原預算不變。 |
| 真正本機 HTTP | 保留原二十組，晚到 A 註冊改驗補償後 A／B 皆無殘留；新增捕捉 A 固定裝置→真正換 B→移除 A、B 裝置保留及個人 projection 不變，共 21/21。 |
| 負控制 | 七項單元：移除補償、固定 token、server 重讀、future barrier、持久化確認、revision 比對、摘要隱私；三項真正 HTTP：移除補償、錯用當前 token、no-op 撤銷，分別被第 20／21／19 組獨立 SQL／metadata 抓到。finally 精確還原，正常再過 21/21。 |
| 本機清理 | 21 migration 逐 byte 相同、未 link；users／families／calendars／events／todos／rules／devices 各 0、configuration 停用且 key／heartbeat／error 清空，專用 DayPopReminders stack 已停。沒有正式資料或真正 Push 投遞。 |

最終控制來源 SHA-256：service `7d89db2d2e3e897da019bb215720efb6325b2f56b18c53714b099cc9b0be4a8e`、records `4f24fabea2bc8960089074fa8f02fe4a95b59659212b7e75a59187aa5da74e57`、fingerprint `025f34dcbe1efb8ad7ccb1365b1563662ea73c5be3bc7b969688113406c3c8fd`。腳本與紀錄只留 TEMP，不提交憑證或能力值。測試保留 null／非陣列回應，不將它們轉成空陣列；未放寬回歸或 CI。

自己的最新四 CI／同 head 完成審查無發現及無未解決討論後才合併。下一段 DP-230 整合 epoch、操作收據、補償、持久化與本機／伺服器雙確認的 controller，再接 UI／AuthProvider；未知結果、quota、future 與跨分頁競態未完成前不能接入 App。沒有 user-data schema／migration／AuthProvider／UI／正式訂閱／秘密／cron／版號／公告／部署變更，DP-223／042 未完成；iPhone 真機與真正投遞仍待後續。
