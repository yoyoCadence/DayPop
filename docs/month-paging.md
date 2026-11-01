# 連續／單月翻頁（DP-225）

2026-11-01，依擁有者三張參考圖與可切換要求，從 DP-224／PR #220 最終 `4c12b32` 四 CI `41260244520`、同 head 完成審查無發現後合併的 `70e8947` 接續。iPhone 加到主畫面的自動列數狂跳先由該 PR 修正；本段才新增顯示方式。公開仍 0.4.6，沒有部署或後端操作。

## 使用與邊界

- 月檢視頁首的日曆圖示開啟「月曆顯示方式」，提供「連續捲動」與「單月翻頁」。視窗沿既有 modal 的 Tab／Escape／背景關閉與焦點還原；同選項不重寫、不跳頁。
- 預設保留連續模式。切換保留可見月份、選取日期與資料；單月一次畫完整月份，前後按鈕與左右觸控每次換一月，支援跨年，日期仍限 0100–9999。垂直手勢／取消／多指不翻月，水平滑動後的相容 click 不誤開日期，下一次真正點擊與鍵盤照常可用。
- 週起始日、自動 4／5／6 列或固定六列照既有設定。短螢幕以最小 58px 保留可讀內容，月內可捲動；今天與鍵盤日期在該容器捲入，工具列導覽不搶焦點。Page Up／Down 保留月末 clamp。
- 日格內容共用同一 renderer 與 canonical occurrence／segment：農曆、顏色、衝突、續日、多日全天、`+N` 與貼圖不另造模型。點相鄰月日期在原頁開詳情，保持關閉後觸發鈕連接；鍵盤跨月會換頁。
- 模式僅由 `AppStorage` 保存於 `daypop.month-navigation.v1`，跨分頁／重載記住此裝置的選擇；不保存瀏覽月份，重進畫面仍沿原今日／搜尋定位契約。不是雲端偏好、不進 v4 或備份，未知值不覆寫，寫入失效沿既有非持久化警告。詳 ADR §6。

## 對照與驗證

| 參考／要求 | DayPop 實作 |
| --- | --- |
| 第一圖上下連續月份 | 保留原 53 週連續視圖與 DP-224 停穩重算。 |
| 第二、三圖單月滿頁，十一月六週／十二月五週 | 自動模式＋週一開始時同樣 6／5 列，完整月頁；保留 DayPop 原有主題、農曆與色塊，未複製參考 App 的廣告或導覽。 |
| 可切換 | 獨立顯示選項、可見月交接、裝置 UI 保存，不改行程或帳號文件。 |

Browser plugin／browser skill 未提供，依 frontend-testing-debugging skill 使用既有 Playwright。手機 Chromium 使用原生 CDP touch 水平手勢，桌面與 WebKit 使用 PointerEvent 生命週期注入；後者驗證事件邊界與真正畫面，不冒充 iPhone OS 原生滑動。iPhone standalone 真機與發佈後複驗仍待補充。

新增 22 項單元涵蓋列數、月末／跨年／上下界、時區今天、鍵盤／短 viewport、相鄰日與焦點、手勢／相容 click、共用內容，以及裝置模式的資料 bytes／同選擇／取消／重進。Safari 點按不保證聚焦按鈕，最初 WebKit 抓到選項視窗關閉沒有回入口；單元先重現失敗後，新入口明確 `focus({preventScroll:true})` 再開窗。原有導覽的「不搶焦點」驗收改用真正鍵盤啟動，不假設 Safari tap 必然聚焦。

| 驗證 | 證據 |
| --- | --- |
| 全專案 | 1,554 單元／95 檔＋39 Node 全過，既有連續月曆 36 項保留。 |
| 時區 | 22 新單元於 UTC／America/New_York／Etc/GMT-8 全過，PowerShell 設定後每次實際列印 Intl timezone。Chromium 裝置為 America/New_York、日曆為 Asia/Taipei，在固定瞬間分別 11/14／11/15；WebKit 實際 Asia/Taipei。 |
| 瀏覽器 | Chromium 手機／桌面 12、WebKit smoke 10，共 22 過；包含新模式、原連續視窗／adaptive、旋轉、鍵盤／焦點、原生觸控與資料 bytes。320×568 淺深、選項與月格的 axe 八次掃描通過，667×375 的月內捲動／今天通過。 |
| 儲存失敗 | 只對模式 key 注入 quota 失敗；既有持續記憶體警告顯示，畫面可用，磁碟模式仍是先前 paged、完整資料 bytes 不變。沒有靜默假裝已持久化。 |
| 負控制 | 暫停模式 renderer 接線、暫停水平翻月，兩個新手機案例分別在預期可見行為失敗；finally source 精確還原，SHA-256 `76b1fa882fe3d80cecba40412c81437025339c7c225e3718a8fd2f9ea55a1a5b`。Safari 入口無焦點的單元也先失敗。 |
| 品質與預算 | lint／typecheck／Pages build／check:build／canonical reminder bundle 通過；JS 754,436 raw／222,334 gzip，CSS 119,723／29,354，原預算不變。相對 DP-224 JS 增 1,828 gzip bytes。 |
| Production | `/DayPop/` 390×844／1280×900 淺深＋320×568 選項，十圖已目視；整月內容完整，320px 標題單行不重疊，標題／框架／內容正常、無水平溢出／overlay，線上 console 0，實際 America/New_York。revision 7／v4／完整 bytes 不變。 |
| 真正離線 | production 手機淺色完成 SW ready／重載後斷網，切換兩模式再重載仍保留 paged 與原文件。該輪只出現既有 `/DayPop/version.json` 探測的一次預期 `ERR_INTERNET_DISCONNECTED`；先前補驗另見 Auth `/auth/v1/settings` 同型失敗，沒有將這些離線探測冒充線上 console 錯誤或改動更新／Auth 行為。 |

axe 量測先等待既有彈出動畫完成，未放寬對比門檻。初次 320px 截圖月份換行後，只在新模式控制存在的窄版頁首調整至 23px／單行與日期字距；其餘檢視與一般尺寸不改。`daypop-dp225-production.mjs`、十張 `daypop-dp225-{mobile,desktop}-{light,dark}-{nov,dec}.png`／`daypop-dp225-320-{light,dark}-dialog.png` 與負控制紀錄只留 TEMP；瀏覽器與核對 PID 的 preview 已清理。

## 重跑

- `npx vitest run src/screens/calendar/MonthPaging.test.tsx src/screens/calendar/MonthNavigation.test.tsx src/screens/calendar/MonthView.test.tsx src/screens/calendar/CalendarScreen.test.tsx`
- `npm run test:e2e -- e2e/month-paging.spec.ts --project=mobile-chrome --project=desktop-chrome`
- `npm run test:e2e -- --project=webkit-smoke`

自己的最新四 CI／同 head 完成審查無發現且無未解決討論後才合併。沒有 schema／Auth／版號／已發布公告／部署改動；DP-223 提醒 App／worker 仍保留 Next，父項 DP-042 尚未完成。
