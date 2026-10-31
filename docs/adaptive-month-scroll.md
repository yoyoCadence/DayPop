# 自動列數的連續捲動穩定（DP-224）

2026-11-01，擁有者於 10 月 31 日回報：「連續滑動，月曆列數不選固定時，有機會狂跳」。依新優先序先修本項，再做 DP-225 的連續／單月翻頁切換；DP-223 提醒 App／worker 保留 Next。

基線為 PR #219 最新 `772a7f9` 四 CI（`41215209077`，Chromium 297 passed／13 skipped、WebKit 8、465 pgTAP／12 檔及容器加密／RPC）與同 head 完成審查無發現、無未解決討論後合併的 `9ed6b50`。提醒後端仍未部署，公開仍 0.4.6。

## 問題與修正

`MonthView` 原本在捲動到另一月份時，立即按該月 4／5／6 週重算列高，再補償 scrollTop。這會在手勢／慣性期間改變捲動座標；補償落在半列的月份切換點時，像素取整後的 scroll 通知又可能把月份切回去。新回歸以 136→109px、27.5 列的補償，抓到反向切回 136px；重複通知也會觸發。

現在自動模式在捲動、wheel、觸控按住及平滑導覽期間保留列高；連續 150ms 無捲動且手指已離開後，才以最新月份與 viewport 重算。手指停留超過時限仍不重算，resize 也等到停穩，再沿原「週＋列內比例」錨點補償。相同補償位置的一像素誤差及重複通知不作為新導覽；新 wheel／touch 或確實移動會解除保護。timer／observer 隨元件清理，不新增全域 listener。

固定六列、53 週 bounded window、月份標籤、鍵盤／搜尋／今天、行程／貼圖、主題與使用者資料維持既有契約。前後按鈕按實際 viewport 翻一屏，避免手勢期間新月份列數與舊列高混用。自動模式仍在停穩後顯示對應的 4／5／6 列。

## 驗證

| 項目 | 結果與證據 |
| --- | --- |
| 單元 | 三項新回歸在舊 renderer 全失敗：wheel／resize 固定列高、觸控停留兩秒、像素取整／重複通知。MonthView 34/34，全專案 1,530／93 檔＋39 Node。 |
| 時區 | 三個新案例在 UTC／America/New_York／Etc/GMT-8 通過，執行前實際列印 `Intl.DateTimeFormat().resolvedOptions().timeZone`。 |
| Chromium | 手機／桌面 8 項過：新案例與原長捲、焦點／鍵盤、搜尋跨年／日期兩端及旋轉。新 fixture 測 4→5→6、6→5→4、手指停留／resize、停穩後位置、53 週／單一 tab stop、envelope bytes 不變。 |
| WebKit | 新案例加原八項共 9/9；實際 Asia/Taipei、390×844。mobile WebKit 不支援 mouse.wheel，沒有冒充原生 wheel／慣性驗收。 |
| 負控制 | 暫換回 `9ed6b50` 的原 MonthView，新手機測試在「held touch never changes row geometry」失敗；finally 精確還原，SHA-256 `c4d104354ee765775b90bb71839a90dc45df9b899ab3e30f0329cd4bf63838a3`。 |
| Production | `/DayPop/` build、390×844／1280×900、淺深四畫面、有重複行程：滑動列高不變，停穩六列／錨點誤差低於一像素；revision 7／v4／完整 bytes 不變，無溢出／overlay，console 各 0 errors／warnings，實際 Asia/Taipei。四圖已目視。 |
| 品質／預算 | lint、typecheck、Pages build、check:build、提醒 canonical bundle 檢查過。JS 748,074 raw／220,492 gzip；CSS 119,236／29,242，原門檻不變。 |

Browser plugin／browser skill 未提供，依 frontend-testing-debugging skill 使用既有 Playwright 專案。`adaptiveScroll.ts` 的觸控開始／結束是 DOM 事件注入，scroll／ResizeObserver／RAF 與畫面是真正瀏覽器；驗證幾何與回饋保護，不等同 iPhone OS 的原生慣性。初步 Chromium 靜止邊界測量沒有重現完整狂跳；本次修正已確認的列高變更及像素補償重入路徑，真機環境／複驗仍待補充。

## 重跑與接續

- `npx vitest run src/screens/calendar/MonthView.test.tsx`；三時區由 PowerShell 設 TZ 並印實際值。
- `npm run test:e2e -- e2e/adaptive-scroll.spec.ts e2e/month-window.spec.ts --project=mobile-chrome --project=desktop-chrome`。
- `npm run test:e2e -- --project=webkit-smoke`。
- production 的 build／preview 都帶 `--base=/DayPop/`，先校驗實際 JS URL 的 MIME。手動 QA／trace／四圖僅 TEMP（`daypop-dp224-{mobile,desktop}-{light,dark}.png`），隱藏 preview 已核對 PID 並停止。

自己的最新四 CI／同 head 完成審查無發現及無未解決討論後才合併。沒有 schema、Auth、正式帳號、release note 或部署變更，0.4.6 公告不回寫；下一段 DP-225 加兩種月檢視，保留本項穩定邊界。
