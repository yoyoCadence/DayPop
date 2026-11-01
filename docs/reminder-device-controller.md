# 提醒裝置狀態控制（DP-230）

2026-11-01，從 PR #225 最終 `384105c` 的四 CI `41301260472`／同 head 完成審查無發現及無未解決討論後合併的 `d17eae5` 接續。此段整合既有 browser、service 與安全收據，沒有 App caller；DP-231 才接 Auth／canonical 設定 UI，公開仍 0.4.6。

## 同意與狀態

`ReminderDeviceController` 接受 waiting／guest／已確認帳號三種身分；waiting 不是登出。載入只讀安全 metadata、原生摘要與 worker 能力，不提示通知、不註冊。後端未啟用、權限拒絕、不同金鑰、需要安裝／更新、future／corrupt／非持久化儲存都不能啟用。狀態只包含安全 projection 與固定錯誤文案。

UI 必須先完成 preflight，再由使用者直接點按呼叫 `enable()`：同步確認帳號及持久化 registering 收據後，立即呼叫 browser.subscribe；前面沒有 await 或網路，保留 iPhone 需要的手勢。能力值只在操作記憶體中，先記 scope 分隔摘要，再送註冊。雙擊、既有操作與仍未結束的原生停用會阻擋新的啟用。

只有本人 active 收據、原生摘要／key、本人遠端 id 及目前健康 key 相符，才回 active。舊欄位、登入或收到其他分頁資料不自動開啟；未知註冊結果保留收據與同帳號 native 訂閱，只提供使用者明確重試。重試沿同 endpoint 的伺服器冪等 RPC，不從時間戳或裝置清單差異猜 id。

## 帳號與晚到清理

`registerDeviceLease` 在註冊成功後回傳 id 與固定原帳號／該裝置的暫時撤銷函式，補上「service 完成身分檢查後、controller 接收前」仍可能切換帳號的空隙。closure 只存在記憶體，不能取得 token 或執行一般舊帳號操作；伺服器仍驗 JWT／RLS。已確認補償以安全 removedDeviceId 明確區別未知結果。

epoch／帳號檢查在原生同意、摘要、註冊及落盤後重查。八秒註冊期限到達仍保留 pending Promise，晚到 lease 必須撤銷，不能寫入新帳號畫面。五秒 cleanup 等待上限不代表原生 unsubscribe 已結束；尚未結束的原生操作仍阻擋新 consent，須完成後重新確認。

明確停用及已確認帳號切換會清理本機訂閱與已知裝置。正常切換使用事先捕捉的 A-only remover，即使共用 client 已經是 B，也不以 B 修改 A。暫時 waiting 保留最後已確認帳號，後續真正換 B／guest 仍清理 A。冷啟動遇到無法認領的 native 訂閱會移除本機訂閱、保留舊收據，不轉移同意。

本機與遠端都確認移除才刪收據；失敗、quota、future 或未知 id 留待確認，不宣稱已停用。未知 id 只有在使用者明確停用、本機確認不存在且本人遠端裝置清單獨立讀到完全空時，才可清掉 marker；不能移除清單裡其他裝置。登出後仍保留未完成清理警告。觀察者 dispose／App 關閉／一般背景切換不撤銷 active 訂閱。

## 驗證與界線

- 新 controller 33 項、SDK lease 1 項；相關四檔 166 項涵蓋手勢前同步保存、三種儲存 barrier、同意／註冊取消、晚到 lease、未知結果重試、雙邊撤銷、原生停用卡住、帳號切換與冷啟動。
- 六項單元負控制：提前 subscribe、撤掉操作身分檢查、跳過晚到 lease 撤銷、停用不送 server、忽略未完成 native removal、lease 錯用目前帳號；全部被指定案例抓到，finally 精確還原。取消測試在只撤掉 epoch 比較時仍由收據 barrier 阻擋，未將這次通過算成負控制成功。
- 真正本機 Auth／HTTP 新增「成功取得 A lease→真正切 B→固定撤銷 A、B 保留」，共 22/22。錯用當前帳號與 no-op lease 兩個負控制均在新第 22 組失敗，finally 精確還原、假帳號清除，正常重跑 22/22 通過，實際 Etc/GMT-8。
- 首次完整單元預設並行有九項既有畫面失敗（八項五秒逾時及一項受前測逾時影響的 null dialog）；五檔較低同時執行量重跑 79/79，未改測試、門檻或 CI。完整最終結果見本段補記。

最終 `npm run test -- --maxWorkers=2`：1,754 單元／100 檔（116.19 秒）＋39 Node 全過；lint、typecheck、Pages build、check:build、canonical server bundle 全過。相關 166 項在 UTC／America/New_York／Etc/GMT-8 實際列印各通過。App 仍 `index-Dc_JOwIQ.js`，JS＋worker 756,768 raw／223,208 gzip、CSS 119,746／29,361，原預算不變。沒有改 workflow、測試門檻或正式設定。

六項單元及兩項 HTTP 控制最終精確還原來源 SHA-256：controller `100c1a8bbfb811974f7bfd5956ea841ecebf8428d28b282377c2e02d7fbd092c`、service `ff9eb34a98f94a25047e0a939741c0b9e75984fcdeb83626054ad1648d2fe227`。腳本／完整紀錄只留 TEMP，沒有能力值或憑證入版。21 份專用本機 migration 與 repo 逐 byte 相同；users／calendars／events／todos／rules／devices 各 0，配置停用且 key／heartbeat／error 清空，DayPopReminders stack 已停止。

自己的最新四 CI／同 head 完成審查無發現及無未解決討論後才可合併；此處不把本機測試當遠端 CI 證據。

後續 caller 必須在 Auth callback 外通知 controller，明確登出先呼叫 disable，外部身分變化再 setIdentity；不能在 callback 內等待 SDK Auth 方法。storage／visibility 事件需使未使用的 preflight 失效、重新讀 metadata，不能把 OS 權限提示造成的背景切換當登出。收據 revision 是已觀察到的衝突檢查，不是跨分頁原子鎖；跨分頁同時操作及重新確認由下一段 UI／Auth 整合驗證。

沒有 UI、AuthProvider、user-data schema、migration、秘密、cron、正式訂閱、Push 投遞、版號、公告或部署變更；controller 測試使用 ports，不能當實體 iPhone 或 OS 通知驗收。DP-223／042 未完成，正式啟用仍需後續具體放行。
