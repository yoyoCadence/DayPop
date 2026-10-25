# 保守循環編碼接入（DP-201）

2026-10-25。依持續開發授權，在獨立分支暫接 DP-198–200 準備。PR #195 head `a4433f8` 的 run `40190259102` 四項 CI 通過（Chromium 285 passed／13 skipped、21.9 分鐘；WebKit 8 passed）、完成審查無發現／無未解決討論，已合併 `b019628`。本項已移至該最新 main，只送本項四張產品圖片、來源守門與交接。

App 四張 idle／sleep WebP 逐 byte 採 [DP-200 Q75／alpha 100](pet-concepts/2026-10-25/loop-encoding/README.md)，沒有再編碼，保留原生 120px、合併後 20 個 decoded frames、完整 durations／phase、4.4 秒 loop=0。與原取樣幀的 alpha 最大差為 0，RGB 有損，不冒充擁有者品質驗收。PNG／look／jump、typed registry、閒置／完成與輸入喚醒、單次解碼時計／reduce／背景與 CSS 回退都不改。

| 角色 | idle bytes | sleep bytes | 五態七唯一檔案 | 相對 DP-199 節省 | 192 KiB 餘裕 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 月光貓 | 43,862 | 42,104 | 174,308 | 16,672 | 22,300 |
| 軌道噗 | 35,966 | 35,366 | 152,194 | 15,094 | 44,414 |

每款 192 KiB、idle 128／sleep 64／look 48／jump 32／PNG 16 KiB 上限與三張 PNG 的共享關係不變。不是七態預算完成，walk／sit 尚未製作。

來源 Node 回歸先在舊 `moon-cat-idle.webp source bytes` 失敗。替換後逐一還原四張舊 Q85 WebP，四次均在對應 source bytes 被拒絕；finally 四檔精確還原，12 圖片 Node 守門再過。來源回歸檢查保守建議 key、eligible、matched alpha=0、發布 bytes／SHA 與兩款固定總量；沒有回寫 DP-200 歷史 manifest。

本機 88 檔 1,402 單元與 29 Node、lint／typecheck／build／check:build 通過。單元使用 `--maxWorkers=2 --testTimeout=30000`，Node 29 項以 `--test-isolation=none`；空 Supabase 設定建置查十四張實際 hash 圖檔，JS 含 worker 747,165 raw／220,125 gzip、CSS 112,388／27,272 bytes。沒有外推真機效能。

Browser plugin not available，沿專案 Playwright 與官方 CLI。相關 Chromium 28＋WebKit 8，共 36 項通過，包含 idle／look／grab／sleep／jump、焦點、reduce、收起、真正 production 首次離線缺 PNG／sleep／jump 回退與 guest 保存／reload 不補播。Node 實際 `Etc/GMT-8`、browser `Asia/Taipei` 均列印。

CLI 的 390×844／1280×900、漫畫淺深色四個 context，實際 App 的 idle 與 sleep 都在超過完整 4.4 秒後仍有原生幀變化，reduce 用 PNG、恢復 WebP 與鍵盤喚醒回 idle；60×60 操作區／焦點與 guest bytes 不變、無水平溢出／console error／warning。行為使用受控 clock，WebP 解碼與原生動畫沒有替代。八張截圖在 OS TEMP `daypop-dp201-{mobile,desktop}-{light,dark}-{idle,sleep}.png`，手機淺色 idle／桌面深色 sleep 已目視。CLI 已關閉，本次 Vite PID 39864 按 port／CommandLine 核對後停止。

七份 Markdown 的 173 個本機連結與 diff 檢查通過，產品差異只有四張 WebP；移接 #195 合併的最新 main 後與已驗提交 `f875a0a` 的 src／scripts／e2e／預算／套件零差異，12 圖片 Node 守門再次通過。本項自己的最新四項 CI／完成審查仍須通過才合併。0.4.3／v4／18 migrations／公告／部署不變，擁有者色彩與動作品質、真 iPhone／standalone、DP-171／172／041 與七態尚未完成。
