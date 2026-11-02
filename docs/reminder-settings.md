# App 提醒設定與登入接線（DP-231）

2026-11-02，從 PR #226 最終 `2ae943d` 的四 CI `41307384015`／同 head 完成審查無發現、討論全解後合併的 `bed614a` 接續。擁有者已選擇提醒完成後與月曆翻頁／滑動修正一起發布；本段仍是未發布產品候選，公開 0.4.6、v4 與已發布公告不變。

## 設定與身分

正式組合為 AuthProvider → ReminderProvider → 帳號 keyed SessionDataProvider。提醒狀態不會隨 A／B／guest 的個人資料重掛而丟失撤銷能力；Auth callback 本身仍只更新狀態，不在裡面等待 SDK。已確認帳號才接本人 service，初始化／離線快取未確認映射 waiting，沒有自動提示或註冊。

provider 以已提交的身分物件區分工作。相同帳號 token refresh 保留身分；A→B→A 會得到新身分，舊登出不會登出新 A、舊規則回應／busy 不會套到新 A。兩個回歸先在僅比較 userId 的版本失敗，再補身分識別；不同身分的登出工作也不相互合併。normal signout 先等 controller 的雙邊清理，失敗仍可登出，安全收據與跨分頁警告繼續保留；App 關閉／StrictMode replay 不等於登出。

storage／storage mode、worker 更換、回前景及重新連線會失效未使用的 preflight 或重讀狀態。正在進行的 OS 同意不因暫時背景而取消。第一個 B render 就隱藏 A 的 projection；日曆對話框亦綁開啟時帳號及仍有效的日曆。

## 原稿與互動

先前已實際渲染原稿設定頁：390×844 淺／深與 1280×900 深色；新入口沿用一般卡片的邊框、陰影、分隔列、44×25 開關與既有 modal focus／ViewportLayer，不搬原稿假的通知 timer、雲端或 AI key。新增逐日曆規則是 ADR §10 已定案的第一版；舊 defaultReminderMinutes／逐筆 reminderMinutes 保存但不自動套用。

- 裝置開關只在 preflight 完成及使用者直接點按時呼叫 enable，前面沒有 await。未登入、未確認 session、後端未啟用、拒絕、安裝／更新前置及儲存故障明確說明；沒有假成功。
- 自己與仍可讀的共用日曆可分別設定，最多十個 0–10080 整數分鐘，接受逗號／全形逗號並排序去重；日期事項時刻、IANA 時區及待辦另選。關閉送空陣列，不改原事項或其他裝置。
- 規則保存帶原始微秒 CAS，確認後才關對話框；衝突／失敗保留輸入。十秒確認上限不宣稱失敗回滾或保存成功；明確「重新載入已保存設定」才替換草稿與 CAS，讀取失敗不當空規則。
- identity 原生讀取若失敗，仍保留 HTTPS／不支援／加入主畫面的具體指引；成功讀取舊訂閱則仍不要求安裝或握手，供清理使用。三個新回歸在舊 generic error 版本先失敗。
- 設定舊清單誤列「左右滑動翻頁」已修正，並說明月曆頁首可選連續捲動／單月翻頁；本段沒有再改月曆捲動或 paging 實作。

## 驗證

| 範圍 | 證據 |
| --- | --- |
| 單元 | 新 provider 16、設定 18、原生提示 3，共 37 項；完整 1,801／102 檔＋39 Node 過。初次完整只有舊設定分組斷言未列新「提醒」區塊；保留原分組順序並新增該 label 後通過，沒有改門檻。 |
| 時區 | 相關六檔 213 項在 UTC／America/New_York／Etc/GMT-8 全過，各次實際 Intl 時區均列印。 |
| Chromium | 手機／桌面五組流程各過；手機六主題 × 淺深的十二面表單 axe／焦點全過。合計 16 passed／6 intentional skipped（桌面不重複共用色票矩陣，五組桌面流程仍實跑），49.5 秒；原 60 秒 timeout／worker／retry 不變。 |
| WebKit | 完整 12 passed（42.9 秒），包含兩個提醒 UI、原有月曆翻頁／自動列數／資料與焦點。是 WebKit viewport，不能當實體 iPhone。 |
| 負控制 | 八項 frontend source：跳過登出清理、顯示舊 A projection、僅比較 logout userId、移除規則工作身分、丟 CAS、錯把錯誤關窗、延後手勢呼叫、移除保存期限；全部被指定案例抓到。另一個 source 改動撤掉原生提示 fallback，三場景全失敗。來源 finally 精確還原、正常再過。 |
| 產物隔離 | production 排除 dev-only FakeReminderHarness；check:build 額外擋其識別字。注入假 harness marker 的 emitted entry 被拒，finally 逐 byte 還原後正常 guard 過。沒有新增套件或 workflow。 |

控制後來源 SHA-256：provider `7a7815340e3c84927662e3801a5a069598821dad2e3dcbe2f9c9f9b588149009`、設定 `eb2be1ead244338f5ea2217e10ad01d97fa5999039ca076ccbe69d37e4be9afc`、browser `e8d75c3368edc061c6e22e6982ecaad7f3d20e92e7ac9bc791a41bb6b521afc3`。控制／完整紀錄在 TEMP；不提交能力資料、憑證或私鑰。

完整 1,801 單元耗時 82.66 秒，lint／typecheck／canonical bundle 過；其後的翻頁文案及恢復畫面只在資料 ready 時顯示設定入口，另以相關 35 項、lint／typecheck 重驗。最後正常 Pages build：JS＋worker 795,139 raw／234,990 gzip、CSS 121,024／29,600，所有 CSP／無遠端 runtime 依賴與產物守門過。相對基線 JS 增 38,371 raw／11,782 gzip，CSS 增 1,278／239；沒有 QA 本機公開 key 留在最後正常環境的建置流程。

## 真正 production App／本機 Auth 與 HTTP

專用 DayPopReminders stack 的 21 份 migration 與 repo 逐 byte 相同且沒有 link；只有兩個臨時、已確認 Email 的假帳號。以本機 URL／公開 anon key 建真正 production bundle，經正式 AuthProvider、SDK、repository、service、controller 及實際 worker 公開握手操作，沒有 dev-only runtime。

Notification 權限與 PushManager 訂閱邊界明確替換為假能力；fixture 的健康 heartbeat 只供本機設定可用，不是 Edge 排程或投遞測試。headless 原生拒絕權限時，正式 UI 曾正確停用開關；後續替身只讓真正 HTTP 操作能繼續。所有瀏覽器請求限預覽及本機 API，沒有真正 Push／遠端專案請求。

實際完成 A 密碼登入→明確註冊→[0,15]／紐約／08:30／待辦保存，SQL 獨立逐列摘要確認 personal rows 不變；A 正常登出裝置移除、規則保留，B 真正登入看不到 A 規則且不自動註冊，B 明確 on／off 不影響 A，再登 A 讀回原規則且裝置仍 off。切桌面深色及 320×568 長表單、焦點與無水平溢出皆過，實際 Asia/Taipei，console 0 errors／warnings、外部請求 0。

六張最後 production 圖已目視：手機淺色設定／對話框、桌面深色設定／對話框、短螢幕捲動後按鈕、遊客設定。截圖等到既有動畫完成，沒有以途中淡入畫面判定透明背景。檔名與 hashes 在 TEMP `daypop-dp231`；原稿截圖另為 `daypop-reminder-prototype-settings-reminders-*`。

只清理本次兩個假帳號；users／families／calendars／events／todos／rules／devices 各 0，配置 disabled 且 public key／heartbeat／error 清空，假憑證檔移除，專用 stack 已停止，瀏覽器 contexts 已關閉。背景 preview 的原 launcher 已退出（PID 探測 ESRCH），4186 仍有 HTTP 回應但 TCP／CIM 未回報實際 owner；未猜 PID 強停，工具端預覽回收狀態仍待確認。

## 發布界線

只將 JS gzip 上限從 220 KiB 調至 235 KiB，原因與實際增量見 [大小預算](performance-budget.md)。raw／CSS／寵物預算及全部 guard 保留；自己最新 head 四 CI／完成審查無發現及無未解決討論後才合併。

沒有正式 migration、Edge／秘密／cron、正式帳號或 OS 訂閱／投遞、版號、公告或部署變更。公開仍 0.4.6，DP-042 尚未完成。下一段依已選定的聯合發布方向核對正式前置、準備版本與更新公告；不能把這裡的替身、localhost 或模擬手機說成實體 iPhone 背景收信。
