# 保留 alpha 的靜態 PNG 接入（DP-199）

2026-10-25。依持續開發／逐段 PR 與合併授權，採 [DP-198 的 RGB128 候選](pet-concepts/2026-10-25/static-encoding/README.md)。製作時從當時 main `4ef75ce` 的獨立分支暫接完成回饋與編碼評估；PR #192 合併 `c38e7b4` 後，#193 head `8638a4b` 的 run `40166083800` 四項全過（Chromium 285 passed／13 skipped、16.7 分鐘；WebKit 8 passed），完成審查無發現、無未解決討論後合併 `4efa018`。本段已移至此最新 main，只送六張 App PNG、來源回歸與本段文件，不重送原幀、Blender、動畫或前項產品碼；自己的最新四 CI／完成審查仍須通過才合併，沒有部署。

## 接入結果

`src/assets/pets/` 六張 `idle`／`grab`／`sleep` PNG 逐 byte 等於 DP-198 `rgb128` 候選，來源 SHA 查 manifest。RGB 最多 128 色、alpha 完整保留；RGBA PNG 仍為單幀 120×120，顯示 60×60。這是有損色彩量化，不能把 PNG 壓縮或 alpha 相同當作色彩無損；擁有者色彩與動作品質驗收仍未完成。

| 角色 | idle PNG | grab PNG | sleep PNG | 五態七檔合計 | 相對 DP-196 節省 | 192 KiB 餘裕 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 月光貓 | 11,774 | 11,729 | 11,405 | 190,980 | 5,306 | 5,628 |
| 軌道噗 | 8,144 | 8,351 | 8,001 | 167,288 | 6,557 | 29,320 |

idle PNG 仍供 idle／look／jump 共用，grab 與 sleep 各一張，唯一檔案只計一次。WebP、typed registry、單次解碼時計、睡眠／完成觸發、reduce、CSS 回退、暫藏與背景政策沒有修改。每款仍 ≤196,608 bytes、PNG ≤16,384 bytes；其餘各態上限不變。五態體積不是七態預算，walk／sit 尚未製作。

`scripts/pet-assets-budget.test.mjs` 來源回歸改查 DP-198 已發布 manifest 的六個候選、eligible 與 SHA；四張動畫繼續對照原已發布來源。固定新總量，byte 比對改用 Buffer.equals，失敗只列檔名，避免印出整張圖片。

DP-198 manifest 的 `appIntegrated:false`／`candidateAdopted:false` 保留為評估當時的歷史。本次採用事實以本文件與 App 來源回歸為準，歷史 checker 直接讀原發布 PNG，未改用新的 App PNG，因此仍可重現當時實測。

## 驗證與限制

更新來源回歸先在舊 App PNG 失敗（`moon-cat-idle.png source bytes`），接入後 12 項圖片 Node 守門通過。sandbox 首次因 Node child spawn EPERM 無法啟動，不算產品失敗；相同命令升權後取得真正來源斷言。接著逐一換回六張舊 PNG，六次均在該檔 source bytes 拒絕，`finally` 六檔精確還原後正向通過。控制測試擷取輸出，不留下臨時舊圖。

完整 88 檔 1,402 單元與 29 Node、lint／typecheck／build／check:build 通過。單元沿前段本機 `--maxWorkers=2 --testTimeout=30000`，Node 完整 29 項以 `--test-isolation=none` 執行。空 Supabase 設定 production 建置的 JS 含 worker 747,165 raw／220,125 gzip、CSS 112,388／27,272 bytes；PNG 名稱 hash 改變亦會影響入口 JS bytes，沒有外推啟動效能。dist 的十四個唯一圖片輸出都通過現有實檔比對與上限，數據如上表。

Browser plugin not available，使用專案 Playwright 與官方 CLI；後端 URL／key 明確清空。相關 Chromium 28＋WebKit 8 共 36 項通過，含 idle／look／grab／sleep／jump、泡泡／reduce／收起／焦點與真正 production 首次離線缺圖回退、離線完成保存與 reload 不補播。來源反向控制還原後，再單獨重跑會讀取 PNG 的 pet-assets 12 項；該重跑不重複加總。Node 實際時區 `Etc/GMT-8`、browser `Asia/Taipei` 均列印。

CLI 在 390×844／1280×900、漫畫淺深色四個新 context，以 reduce 實際顯示 idle／grab／sleep PNG；原生圖片解碼 120px、60×60 操作區、移動取消後焦點與 guest bytes、無水平溢出／console error／warning 通過。canvas 對照六張 App PNG 與原發布 PNG，120／60px alpha 最大差異皆為 0。行為計時用受控 clock；原生 PNG 解碼沒有替代。十二張截圖在 OS TEMP `daypop-dp199-{mobile,desktop}-{light,dark}-{idle,grab,sleep}.png`，手機淺色 idle／深色 grab、桌面深色 sleep 已目視。

反向控制還原後的 pet-assets 12 項再次全過。CLI 命名 session 已關閉；本次 port 4173 的 PID 32984 經 CommandLine 確認是 `daypop-dp199-vite.mjs` 後停止。七份 Markdown 的 162 個本機連結與 `git diff --check` 通過，產品 diff 只有六張 PNG，預算、WebP、TS／TSX、e2e、套件均未修改。發 PR 後須自己的最新四項 CI／完成審查。沒有真 iPhone／standalone 或真實帳號驗收。App 0.4.3／user-data v4／18 migrations／公告／部署不變，DP-171／172／041 未結案。
