# 前景閒置睡眠（DP-193，2026-10-24）

依擁有者持續開發／逐段 PR 與 CI、審查通過後合併授權，在 DP-192 的 sleep registry 上加入一個保守的視覺政策：**可見、展開、前景、未開泡泡的 idle 連續 120 秒後 sleep**。pointerdown／keydown／wheel 立即回 idle 並重計；不以 pointermove 反覆更新 React。

這是 agent 沿既有方向採用的閒置政策，沒有把素材試作寫成擁有者已目視驗收。名稱、徽章、60px、泡泡、焦點、位置與七態父項界線不變。

## 責任與優先序

`IdlePetArtwork.tsx` 只管理 idle／sleep 的元件記憶體狀態。`RestingPet` 擁有一個 timeout 與三種 document capture／passive input 訂閱；醒來清掉舊 timeout，卸載清 timer／listener。背景、暫藏、泡泡讓它卸載，恢復重新計滿 120 秒，不計隱藏期間。收起、停用與離開日曆頁亦卸載。

`PetLayer` 仍先決定 grab → look → idle；只有 idle 分支才掛睡眠控制器。泡泡顯示 idle PNG；look 仍以解碼後 1.6 秒完成，結束後才重新計 idle。reduced-motion 不延後睡眠狀態，經原 `PetArtwork` 換 sleep PNG，恢復動態仍是目前 sleep；沒有把背景 cue 留待恢復後補播。

沒有時間表、走動、待辦獎勵、XP、新偏好或持久化；user-data／快取／JSON／ICS 不加入此狀態。既有十二圖片與來源／192 KiB 預算不變，沒有修改 service worker、0.4.3、v4、18 migrations、公告或部署。DP-171 完整七態、DP-172 選角、DP-041 成長仍未結案。

## 快取圖片載入競態

瀏覽器快速切換已快取的 sleep 時，舊 `DecodedArtwork` 的 `useEffect` 可能尚未將 active 設為 true，load／decode 就先完成；圖片仍在 DOM，卻被忽略而永遠保持 hidden。暫時診斷的失敗 trace 明確記錄 `load false true`／`decoded false true`（active／isConnected），接著才 `active`。診斷在 finally 精確還原，沒有留下 console 輸出。

將掛載／卸載旗標改為 `useLayoutEffect`，在 commit 同步建立生命週期，保留 stale decode 的清理。不是放寬解碼、先顯示未解碼圖片或延長 look。初期只讓暫停的 Playwright 時鐘前進 50ms、再連續前進等待畫面，兩種做法仍各有失敗，因此撤掉這些測試改動。修正產品後恢復瀏覽器 119999／120000ms 精確斷言，Chromium 手機／桌面與 WebKit 各三輪，共 9 passed。

手機 WebKit 不提供原生 `mouse.wheel`，共享流程在該 runner 只驗鍵盤／pointer；Chromium 實際驗 wheel，單元三種輸入均驗。沒有用合成 wheel 冒充手機原生滾動驗收。

## 驗收

新增五個整合案例驗門檻／三種輸入／背景與暫藏重計／泡泡、look、grab、收起優先／reduce PNG／卸載無殘留，前三個先在舊程式失敗。最終完整 1,389 單元＋27 Node、lint／typecheck／build／check:build 通過；JS 含 worker 746,230 raw／219,796 gzip，CSS 112,388／27,272 bytes，圖片仍貓 180,850／飛碟 152,373。

最新 main 上 Chromium 18＋WebKit 7，共 25 e2e 通過：包含原首次離線缺 PNG，以及新增「idle 已快取、sleep 未快取」的真離線流程。首次 sleep WebP 失敗回 CSS，輸入喚醒回已快取 idle，guest bytes 不變。

反向換回三態 `PetLayer`，四項新回歸失敗；停用 input listener cleanup 時，第一版只在 240 秒後檢查，漏掉已經到期的殘留 timeout。補成輸入後立即檢查 timer 數量後，同一負控制確實失敗。兩檔 finally 精確還原與 SHA-256 核對，44 相關＋27 Node 恢復通過。首次控制的診斷輸出曾被 CP950 字元編碼中斷，產品仍在 finally 還原；最終命令採 Python UTF-8，未把未完成那輪當作通過。

Browser plugin not available，沿專案 Playwright。最終產品另以沒有安裝假時鐘的 Chromium 390×844／1280×900 真等兩分鐘，第一次觀察約 120.78 秒進 sleep（1 秒 polling，不是精密排程延遲量測）；原生動畫有變化、reduce PNG 靜止、Shift 喚醒、60px／焦點／guest bytes 不變、console／無溢出通過。URL／title／非空白／無 Vite overlay 均核對，實際時區 `Asia/Taipei`；截圖 `%TEMP%/daypop-dp193-sleep-*.png` 與 `awake-*.png`。Windows／Linux 模擬不能代替 iOS standalone／真機手勢或素材品質驗收。

PR #187 head `4c23d84` 四項 CI／審查無發現後合併 `b159045`（run `40081414632`，Chromium 271 passed／13 skipped、WebKit 6 passed）。本段在等待期間獨立準備，已移至該最新 main，不重送混合素材；最新 PR 四項 CI 與審查通過後才合併。
