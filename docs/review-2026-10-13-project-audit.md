# 專案審查與複核 — 2026-10-13

2026-10-13 一個 agent 對整個專案做了審查，在動手修正之前額度用盡。專案擁有者要求另一個 agent 接手：複核報告內容，把相關工作整理進 `tasks.md`，之後由專案擁有者接著開發。

本文件記錄兩件事：複核的結果（§1–§4），以及原審查報告的全文（§6）。**兩個 agent 都沒有修改產品程式碼、依賴、migration、版號、公告或部署。** 登記的任務是 `tasks.md` 的 DP-152–DP-175，對照表在 §5。

## 1. 來源與複核方法

- **原審查**：基準是 `main`／`bc6c16a`（App 0.4.2、資料 schema v4）。它的故障探針、截圖與 log 放在審查者本機的暫存資料夾，**沒有提交**，日後不保證還在；所以本文件把重現方法寫到可以重做的程度。
- **複核**：同一天、同一個 commit，由接手的 agent 進行。做法是重跑原審查留下的探針、另外補探針、在真實瀏覽器重做鍵盤操作，其餘斷言逐一對照程式碼與原稿 `日曆桌寵 Calendar Pet.dc.html`。

每一項複核結果用下面三種狀態之一標示，不混用：

| 狀態 | 意思 |
| --- | --- |
| 重跑確認 | 在未修改的 `bc6c16a` 上實際執行並得到相同結果 |
| 對照確認 | 對照程式碼、原稿或原審查留下的截圖後成立，但沒有自己執行 |
| 未複核 | 沒有重做，數字與觀察仍只有原審查的說法 |

## 2. 已確認的問題

### 2.1 R1（P1）— 帳號資料載入沒有分頁（DP-152）

**狀態：重跑確認。**

`SupabaseDayPopRepository.load()`（`src/data/supabaseRepository.ts:134-169`）對 calendars、events、event_attachments、event_exceptions、todos、stickers 各發一次 `select('*').eq('owner_id', …)`，沒有 range、排序或筆數核對。`supabase/config.toml:18` 是 `max_rows = 1000`。

匯入允許的量遠高於此：`src/domain/dataTransfer.ts:39` 的 `LIMITS` 是 100 個日曆、10,000 筆行程、50,000 筆例外、20,000 筆待辦、10,000 張貼圖。一次 JSON 還原就能讓帳號超過 1,000 列，不需要長年累積。

重現方式：真正的 supabase-js client 加上 production repository，注入一個把回應截到 1,000 列的 HTTP transport，準備 1,001 筆合法的全天行程。結果：

```text
ROW_CAP_EVIDENCE {"source":1001,"loaded":1000,"backup":1000,
  "eventRequests":[{"table":"events","query":"?select=*&owner_id=eq.<owner>","range":null}]}
```

`load()` 成功、沒有任何錯誤或警告，但只有 1,000 筆；接著 `buildJsonBackup()` 也只有 1,000 筆；events 只發了一個請求，沒有 Range、limit 或 offset。

影響與界線：

- 畫面、記憶體 snapshot、帳號快取與 JSON／ICS 匯出都缺列，而且沒有提示。
- `load()` 本身不會刪除伺服器上的列。
- **但截斷的備份如果再以「取代資料」匯回，缺的列就會真的被刪掉。** 這一句是依 JSON 取代匯入的語意推論出來的，沒有重現。
- 查詢沒有 `ORDER BY`，所以缺的是哪幾列並不固定。
- 如果缺的是父待辦或被例外參照的行程，`parseDayPopUserData()` 可能拒絕整份 snapshot，使用者看到的會是載入失敗而不是少資料。沒有重現，修正時要補案例。
- 這是依 repo 設定做的 transport 模擬，**沒有量測遠端專案實際的 Max rows 設定**，也沒有向任何真實帳號寫入資料。
- `src/test/fakeSupabase.ts` 沒有模擬列數上限（檔內沒有任何 range／limit／order 的處理），所以既有測試不可能發現這個問題。DP-138 是同一種情況：fake 比真實服務寬鬆，測試一直是綠的。

接手的 agent 補充一點實作上的陷阱，原審查沒有提：**不能假設伺服器上限等於自己要的頁大小。** 要 1,000 列而伺服器上限是 500 時，回來的 500 列看起來像「不足一頁」，用它判斷結束就會再度漏資料。結束條件要用空頁或 exact count。

### 2.2 R2（P2）— 更新資訊沒有格式驗證（DP-153）

**狀態：重跑確認，而且範圍比原審查寫的大。**

`useAppUpdate.runCheck()`（`src/pwa/useAppUpdate.ts:131`）把 `response.json()` 直接斷言成 `ReleaseInfo`。有三處繪製直接信任 `changes`：

- `src/pwa/UpdateDialog.tsx:20`
- `src/pwa/ReleaseNoticeDialog.tsx:34`、`:38`
- `src/screens/SettingsScaffoldScreen.tsx:600`

原審查重現的是「較新版本」那條路徑：HTTP 200、`version` 為 `9.9.9`、`changes` 省略或是字串，`UpdateDialog` 在繪製時丟錯。重跑結果相同：

```text
RELEASE_EVIDENCE {"changes":"undefined","text":"RENDER_FAILURE","error":"Cannot read properties of undefined (reading 'map')"}
RELEASE_EVIDENCE {"changes":"not-an-array","text":"RENDER_FAILURE","error":"release.changes.map is not a function"}
```

複核另外補了「**同一個版本**」的路徑，三種格式都同樣壞掉：

```text
SAME_VERSION_EVIDENCE {"label":"changes missing","text":"RENDER_FAILURE","error":"Cannot read properties of undefined (reading 'length')"}
SAME_VERSION_EVIDENCE {"label":"changes is a string","text":"RENDER_FAILURE","error":"content.changes.map is not a function"}
SAME_VERSION_EVIDENCE {"label":"changes holds an object","text":"RENDER_FAILURE","error":"Objects are not valid as a React child …"}
```

這條路徑走的是 `currentRelease` → 版本公告（`ReleaseNoticeDialog`）。版本檢查在啟動時自動執行，所以還沒看過該版公告的裝置一啟動就會遇到。已經看過公告的裝置則會在設定分頁的版本卡片（`:600`）遇到同一個根因；這一處是對照程式碼得出，沒有另外重現。

為什麼是整個 App 而不是一個分頁：兩個對話框都經 `AppShell` 的 `dialogs` 繪製（`src/App.tsx:103-134`），位置在 DP-139 的分頁 `ErrorBoundary` 之外，所以落到 `main.tsx` 最外層的 `RootErrorFallback`。

觸發條件其實很窄，這是它列為 P2 的原因：回應必須是合法 JSON、`version` 是字串且不比目前版本舊，而 `changes` 不是字串陣列。依程式碼判讀，回 HTML 的 captive portal 會在 `response.json()` 就失敗，`version` 不是字串會在 `isNewerVersion()` 裡丟錯，兩者都落在既有的 `catch`，不會壞；這兩種沒有另外執行。**沒有發現線上的 `version.json` 已損壞**，它是由 generator 產生的。

### 2.3 R3（P2）— 對話框沒有限制焦點（DP-154–156）

**狀態：重跑確認，而且不只新增日曆對話框。**

原審查的步驟在 Chromium、390×844 重做，結果相同：設定 → 新增日曆 → 名稱輸入「審查用草稿」→ Shift+Tab（焦點落在背景的「設定」分頁）→ Shift+Tab（「綜覽」分頁）→ Enter。App 切到綜覽，對話框消失；回到設定，對話框與草稿都不在，也沒有新增任何日曆。

`aria-modal="true"` 只是對輔助科技的宣告，不會擋住鍵盤焦點。

原審查明講它只驗了新增日曆，沒有把其他對話框當成已重現。複核把其餘的都量了。方法：開啟對話框後連按 Tab（另一輪連按 Shift+Tab），記錄焦點第一次離開最上層 `[role="dialog"]` 是第幾次、落在哪裡，最多按 60 次。

| 對話框 | 開啟後焦點在哪 | Tab | Shift+Tab |
| --- | --- | --- | --- |
| 新增日曆 `CalendarEditDialog` | 名稱輸入框 | 第 14 次到背景的主題卡片 | 第 1 次到背景「設定」分頁 |
| 新增行程 `EventSheet` | 標題輸入框 | 第 20 次到背景「今天」 | 第 5 次到背景「設定」分頁 |
| 日詳情 `DayDetailSheet` | **仍在觸發它的日期格，沒有進入 sheet** | 第 1 次到背景「新增」FAB | 第 1 次到背景「快速新增」 |
| 版本公告 `ReleaseNoticeDialog` | 「知道了」 | 第 2 次到背景「今天」 | 第 1 次到背景「設定」分頁 |
| 更新提示 `UpdateDialog` | **`body`，沒有初始焦點** | 第 1 次到背景「今天」 | 第 3 次到背景「設定」分頁 |
| 匯入預覽 `DataImportDialog` | 「取代資料」 | 第 2 次到背景的主題卡片 | 第 2 次到對話框自己的背景鈕「取消匯入」，之後沒有繼續量 |
| 登入 `AuthDialog` | **仍在觸發它的「登入／註冊」鈕，沒有進入對話框** | 第 1 次到背景的偏好開關 | 第 1 次到背景「＋ 新增日曆」 |

七個都能讓焦點到達背景控制項。量測的界線：

- 只在 Chromium 無頭模式、390×844 量。Safari 的 Tab 順序規則不同，沒有量。
- `AuthDialog` 是在 dev 用的登入 harness（`/e2e/auth.html`）量的；對話框元件是真的，Auth context 是 harness 提供的。
- `ScopeDialog`（`src/screens/calendar/ScopeDialog.tsx:37-58`）自己做了按鈕之間的循環，是唯一有處理的；這次沒有量它。
- 只有新增日曆確認到「草稿因此遺失」。其他對話框只確認焦點能逃出去，沒有逐一做出遺失草稿的操作。

原稿沒有焦點限制，所以這是可及性與狀態的擴充，不是搬移時弄壞的；修正時比照 DP-141 記入 ADR §2。

### 2.4 開發依賴的一項公告（DP-157）

**狀態：重跑確認。**

`npm audit` 回報 1 個 high：`source-map-js` 1.0.0–1.2.1，[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)。安裝的是 1.2.1，registry 最新版是 1.2.2。它只經由開發工具進來（`vite` → `postcss`、`jsdom` → `css-tree`），`npm audit --omit=dev` 是 0。這不是已證明的 production 漏洞。

## 3. 其他斷言的複核

| 原審查的斷言 | 狀態 | 複核結果 |
| --- | --- | --- |
| 搜尋的日曆篩選只限制行程，待辦一律參與 | 對照確認 | `src/domain/search.ts:53` 只篩行程，`:70` 的待辦迴圈不看篩選 |
| 上一項與原稿、程式註解不一致 | 對照確認 | 原稿 `:1295` 是 `if(fc==='all') this.state.todos.forEach(…)`：選了特定日曆時**待辦整批不出現**。`search.ts:33-38` 的註解卻寫成沿用原稿的 `searchCal`。原稿的待辦沒有日曆；DayPop 的 `TodoItem` 有 `calendarId`（`src/domain/types.ts:94`） |
| 無日期待辦搜尋得到但打不開 | 對照確認 | `src/screens/SearchScreen.tsx:104` 對沒有 `dueDate` 的待辦結果設 `disabled`；綜覽也略過它們（`src/domain/overview.ts:310`） |
| （複核補充）無日期待辦怎麼來 | 對照確認 | `NewTodoInput.date` 是必填（`src/domain/mutations.ts:69`），畫面上建不出無日期待辦；它們只會由匯入帶進來 |
| 設定頁直接顯示 DP 編號與工程用語 | 對照確認 | `src/screens/SettingsScaffoldScreen.tsx:434`「尚未提供（DP-040）：…」，`:612-625`「尚未搬移」區塊列出 DP-014／040／041／042／043 與「原稿」「搬移」 |
| `PetLayer` 整層 `aria-hidden` | 對照確認 | `src/screens/calendar/PetLayer.tsx:22` |
| 寵物現況是浮動 CSS 角色，文件寫法過期 | 對照確認 | `.cal-pet-layer` 是 `position: absolute`。`tasks.md` 的 DP-040 仍寫「目前正常文件流的 `<aside class="pet-helper">`」；`pet-helper` 只剩 `src/styles.css` 的舊樣式，沒有元件使用 |
| `toggleTodo` 對 UI 是 `void` | 對照確認 | `src/data/dataContext.ts:74` |
| `MonthView` 初始 53 週、每次加 12 週、不回收 | 對照確認 | `src/screens/calendar/MonthView.tsx:46-48`；`:245-249` 只有增加。是否會卡沒有量 |
| 日曆管理的開關 transition 不在 reduced-motion 內 | 對照確認 | `src/screens/calendarManage.css:74`、`:90` 有 transition，`:151` 的 reduced-motion 區塊只關掉對話框的 animation |
| 帳號 e2e 替換了 AuthContext | 對照確認 | `src/test/e2eAuthMain.tsx:99`；另外沒有任何測試檔引用 `AuthProvider` |
| e2e 只跑 Chromium | 對照確認 | `playwright.config.ts` 只有 `mobile-chrome` 與 `desktop-chrome` |
| 390px 下月格標籤只剩時間與省略號 | 對照確認 | 原審查的 `mobile-360x640.png` 顯示「15:00 …」「15:30 …」；沒有自己截圖 |
| 深色主題格線視覺份量偏重 | 未複核 | 見 §4 |

## 4. 沒有複核的部分

- **測試總數。** 原審查記錄的 lint、typecheck、1,129 個單元案例、175 個 e2e、174 個 pgTAP、三種 base 的 build，這次沒有在本機重跑。登記任務的 PR 只改文件，它的 CI 會在同一份原始碼上跑同一組檢查，以那次的結果為準。磁碟上的檔案數與原審查一致：67 個單元測試檔、16 檔 migration、6 檔 pgTAP。
- **UI 觀察。** 六套主題淺／深色、週檢視與原稿渲染沒有重看。原審查說留下的是「12 組月曆截圖」，但抽看的 `theme-0-dark.png` 與 `theme-3-dark.png` 都是**設定頁**，不是月曆。所以「深色格線偏重」這一項沒有可核對的證據，DP-166 動工前要先重新截圖確認。
- **bundle 大小**（主要 chunk 約 669 kB raw）沒有重新量。
- **遠端設定。** 遠端 Supabase 專案的 Max rows、真實 Auth 與 Storage 都沒有碰。
- 真機、WebKit、螢幕閱讀器仍是既有的未驗項目（DP-032、DP-077）。

## 5. 任務對照

已重現、不需要產品決策的修正放在 `tasks.md` 的 Next；需要設計或產品決策的放在 Backlog，各自附建議。

| 來源 | 任務 | 位置 |
| --- | --- | --- |
| R1 帳號載入分頁 | DP-152 | Next |
| R2 更新資訊驗證 | DP-153 | Next |
| R3 共用焦點限制，先套用日曆對話框 | DP-154 | Next |
| R3 套用到日曆的 sheet | DP-155 | Next |
| R3 套用到帳號、更新與匯入對話框 | DP-156 | Next |
| `source-map-js` 公告 | DP-157 | Next |
| 真實 `AuthProvider` 整合測試 | DP-158 | Backlog／Quality |
| WebKit smoke | DP-159 | Backlog／Quality |
| 月曆長時間捲動量測 | DP-160 | Backlog／Quality |
| 重模組的載入時機 | DP-161 | Backlog／Quality |
| 自動化可及性與視覺基線 | DP-162 | Backlog／Quality |
| 設定頁文案移除工程用語 | DP-163 | Backlog／UI |
| 設定頁資訊層級 | DP-164 | Backlog／UI |
| 手機月格標籤與選定日清單 | DP-165 | Backlog／UI |
| 深色格線份量 | DP-166 | Backlog／UI |
| 週檢視三日模式 | DP-167 | Backlog／UI |
| 動效與減少動態效果 | DP-168 | Backlog／UI |
| 寵物對話泡泡 | DP-169 | Backlog／Deferred |
| 寵物拖移、停駐與收起 | DP-170 | Backlog／Deferred |
| 寵物素材 registry 與七種狀態 | DP-171 | Backlog／Deferred |
| 選擇夥伴偏好 | DP-172 | Backlog／Deferred |
| 無日期待辦的管理入口 | DP-173 | Backlog／Deferred |
| 搜尋篩選是否涵蓋待辦 | DP-174 | Backlog／Deferred |
| 備份狀態顯示 | DP-175 | Backlog／Deferred |
| 寵物成長與 XP | 既有 DP-041，補上前置條件 | Backlog／Deferred |
| 可靠提醒 | 既有 DP-042，不變 | Backlog／Deferred |
| 真機 QA | 既有 DP-032、DP-077，不變 | Backlog |

## 6. 原審查報告（全文）

以下是原審查的全文。只把標題降了一級以便放進本文件，內文一字未改，包括原文的用字。

---

### DayPop 專案審查 — 2026-10-13

審查基準：本機 `main` / `bc6c16a`，App 0.4.2、資料 schema v4。範圍包括 React／domain／repository／storage／Auth／PWA、Supabase migrations／RLS、build／CI、測試、原稿與實際 UI、寵物延伸方向。

本次為審查，未修改產品原始碼、依賴、migration、版本或公告，未部署或操作正式使用者資料。故障注入、截圖與本報告存於本機暫存資料夾；不是已提交的回歸測試。既有測試通過不表示沒有缺陷。

#### 1. 已確認的問題

##### R1 / P1：帳號資料未分頁，超過 API 回傳上限會靜默漏資料，備份也不完整

- 位置：`src/data/supabaseRepository.ts:134–169`、`supabase/config.toml:18`。
- `load()` 對 calendars、events、event_attachments、event_exceptions、todos、stickers 各只呼叫一次 `select('*').eq(...)`，沒有分頁、穩定排序或完整性確認。repo 的 API 設定為 `max_rows = 1000`。
- 匯入允許的資料量較大：`src/domain/dataTransfer.ts:39` 允許 10,000 events、20,000 todos 等，不能假設帳號永遠不到上限。
- 重現：以真正的 supabase-js client 與 production repository，注入會截斷至 1,000 列的 HTTP transport，準備 1,001 筆合法行程。`load()` 成功但只有 1,000 筆，接著 `buildJsonBackup()` 也只有 1,000 筆；只發出一個 events request，沒有 Range／offset／limit。
- 證據：同目錄 `audit.test.ts` 的第一個測試，預期 1,001、實際 1,000，故意保留紅燈來證明缺陷。這是依 repo API 上限的 transport 模擬，沒有向正式帳號灌入 1,001 筆資料，也沒有量測遠端目前的 API 設定。
- 影響：資料在畫面、snapshot、快取及匯出中缺漏；這不等於伺服器資料已被刪除。若缺的是例外或關聯列，還可能改變呈現或造成 validation 失敗，需要補案例確認。
- 建議：所有集合查詢共用受型別約束的完整載入邏輯，使用穩定唯一排序與分頁。任一頁失敗時不得提交部分 snapshot／覆寫最後確認快取。避免單純提高 max_rows。
- 驗收：1,001／2,001 筆、跨頁父子待辦及例外、第二頁錯誤、最後一頁正好滿頁、reload／快取／JSON／ICS 數量一致。分頁不自動解決讀取中遠端被修改的一致性，需明確定義該限制。

##### R2 / P2：成功回傳但格式錯誤的版本資訊可使整個 App 進入錯誤畫面

- 位置：`src/pwa/useAppUpdate.ts:130`、`src/pwa/UpdateDialog.tsx:20`、`src/App.tsx:111`。
- `response.json()` 只用 `as ReleaseInfo` 斷言，沒有 runtime validation；對話框直接呼叫 `release.changes.map()`。
- 重現：HTTP 200 回傳較新版 `9.9.9`，但省略 changes 或把 changes 設為字串。實際 hook 與 UpdateDialog 分別拋出讀取 map／map is not a function，ErrorBoundary 顯示 fallback。
- UpdateDialog 在分頁 ErrorBoundary 外，因此正式 App 會落到最外層錯誤處理，失去一般頁面操作。本次沒有發現線上 version.json 已損壞；這是已重現的輸入健全性缺陷。
- 證據：同目錄 `audit.test.ts` 的兩個 release 測試。測試沒有 mock 掉 hook 或 dialog。
- 建議：在 fetch 邊界驗證 release 的必要欄位、changes 字串陣列與合理長度；異常沿既有更新檢查失敗狀態處理，保留正常 App。不要只在 render 時以空陣列掩蓋錯誤。
- 驗收：缺欄位、null、非陣列、陣列含物件、同版本／新版本、手動／自動檢查都不應破壞 App；既有合法更新與歷史公告不變。

##### R3 / P2：新增日曆對話框焦點可以逃到背景，切頁後丟失未保存草稿

- 位置：`src/screens/CalendarEditDialog.tsx:117–130`、`src/shell/AppShell.tsx:69`。
- 實際 Chrome、390×844：設定 → 新增日曆 → 名稱輸入「審查用草稿」→ Shift+Tab 到背景「設定」→ 再 Shift+Tab 到「綜覽」→ Enter。App 切到綜覽，dialog 消失，草稿未保存。
- `aria-modal="true"` 宣告本身沒有阻止背景取得鍵盤焦點。這次直接驗證的是新增日曆，沒有把所有對話框都當成已重現。
- 建議：共用 dialog 基礎設施，處理 focus trap、背景 inert、初始／還原焦點、Escape 堆疊、等待中的關閉規則。`ScopeDialog.tsx:31–56` 已有部分焦點循環，可參考但不能假定等同完整共用方案。
- 驗收：Tab／Shift+Tab 不離開 dialog；背景導覽不可操作；取消後回原觸發鈕；巢狀 dialog 的 Escape 只關最上層；保存失敗與 pending 時保留既有草稿契約。

##### 依賴維護：一項開發依賴公告

`npm audit` 回報 source-map-js 1.2.1 一項 high，來自開發工具依賴鏈；`npm audit --omit=dev` 為 0。官方公告描述特殊 indexed source map offsets 可造成同步運算 DoS，修正版 1.2.2：https://github.com/advisories/GHSA-68fv-2mgg-jv7q 。這不是已證明的 DayPop 生產環境漏洞。建議獨立更新 lockfile 並跑品質檢查，沒有執行自動 audit fix。

#### 2. 實際測試结果

| 驗證 | 本次結果 |
| --- | --- |
| lint | 通過 |
| TypeScript project references | 通過 |
| Vitest | 67 檔、1,129 cases 通過 |
| posttest build-budget Node tests | 7 cases 通過 |
| America/New_York 日期／時區選測 | 7 檔、154 cases 通過 |
| UTC 日期／時區選測 | 7 檔、154 cases 通過 |
| production build + check:build | `/`、`./`、`/DayPop/` 三種 base 都通過 |
| migration 靜態檢查 | 16 檔通過 |
| 隔離 PostgreSQL 從零 reset | 16 migrations 套用成功 |
| 真實 PostgreSQL pgTAP | 6 檔、174 assertions 通過 |
| 本機 generated database types | 正規化換行後與 repo 一致 |
| Playwright | 175 passed、7 預期 skip，約 11.3 分鐘 |
| 額外故障探針 | 3 cases 如預期失敗，證明 R1／R2 |
| 手動鍵盤操作 | 重現 R3 |

跨時區測試從 PowerShell 設 TZ，兩次都印出 `Intl.DateTimeFormat().resolvedOptions().timeZone`，分別確認為 America/New_York 與 UTC。它們是原測試的額外執行，不與 1,129 相加當成獨立覆蓋數。

單元測試使用 `npm run test -- --maxWorkers=2`。build 用 `npm --ignore-scripts run build -- --base=<base>`，另執行 `node scripts/copy-spa-fallback.mjs` 與 `npm run check:build`，避免 prebuild 重產已追蹤發布資產。測試 server 的 Supabase URL／publishable key 設為空，沒有連正式服務。

DB 使用專用 `DayPop-review-20261013`／55322，沒有 reset 原本的 DayPop Docker volumes。完成後已停止並清除這個專用 stack；兩個審查 Vite server 也已停止，瀏覽器尺寸已恢復。

覆蓋限制：

- E2E 是 Chromium 的手機與桌面專案，未跑 WebKit／Firefox，也未實測 iOS／Android 安裝版、真實休眠與螢幕閱讀器。
- 帳號 E2E 使用 FakeSupabase 並替换 AuthContext，不能據此宣稱真實 AuthProvider、Email、Google OAuth、refresh／recovery 或 Storage HTTP 全流程已驗收。
- pgTAP 驗證真實 Postgres／RLS／RPC，並不等同真實 Supabase Auth／Storage end-to-end。
- 尚無 coverage gate、axe gate 或 screenshot golden comparison；目前測試數量不代表視覺／可及性／登入覆蓋已完整。
- 保留 DP-077 真機 iOS 拖曳 QA，未把歷史問題當成本次新发现。DP-144／145 色彩對比修正已存在，不重複列為未修 bug。

#### 3. 架構判斷與改善

整體適合持續增量開發。主要強項是 canonical domain contract、guest／account repository 邊界、單一 mutation queue、帳號隔離快取、corrupt／future schema write barrier、原子 RPC、附件清理工作與 PWA cache 的責任分離。應保留這些邊界。

優先補強：

1. 完整遠端 snapshot 的載入契約：R1。FakeSupabase 除成功路徑外，應涵蓋 API 列數上限與頁間失敗。
2. 外部資料邊界：R2。對 release metadata 與資料匯入保持同樣嚴格的 runtime validation 思維。
3. 共用 dialog 行為：R3。減少各畫面自行拼接焦點、Escape 與 pending 保護。
4. 真實 AuthProvider integration 測試：initial session、逾時／失敗、refresh、重設密碼、使用者切換。啟動長時間 pending 的恢復體驗值得補測，目前沒有把它列為已確認故障。
5. 效能以量測驅動：目前主要 bundle 約 669 kB raw，Vite 仍有 500 kB chunk warning；總 JS 約 671 kB raw／197 kB gzip，仍在既有 800 KiB／220 KiB budget 內。可評估備份／ICS／重複事件等重模組的載入時機，不要為拆分而破壞資料邊界。
6. 月曆長時間捲動的量測：MonthView 初始 53 週，每次增加 12 週，沒有回收舊 buffer。建議大量 recurring events＋長時間捲動時量 DOM 數、展開耗時、記憶體，再決定有界 buffer／virtualization。這是靜態風險，未證明目前會卡頓。
7. 文件同步：寵物現況是浮動 CSS 角色，而非普通流向 placeholder；設定、架構文件与素材規範應維持同一現況敘述。

`scripts/generate-icons.mjs` 採單一 SVG 來源、分 any／maskable／Apple framing，並與一般 build 分開，方向合理。本次靜態檢視未確認新 bug；未重新產生／覆寫正式圖示。

#### 4. UI 與視覺建議

已實際查看 React 月／週／列表、設定及表單操作；六個主題各自的淺／深月曆共 12 組截圖；原始 `.dc.html` 月／週實際渲染；390×844 與 360×640 小螢幕。932×430 會依目前 breakpoint 進入桌面手機展示框，這不是安裝版手機橫向驗收。原稿本身也採密集月格／週欄，不能把所有密度問題都稱為 React 搬移漂移。

依使用者選擇「保留品牌、允許改版」，建議：

| 面向 | 觀察／問題 | 改善方向 |
| --- | --- | --- |
| 品牌 | 漫畫粗線、網點、斜體標題有辨識度 | 保留在標頭、主要按鈕與寵物；資訊區減少裝飾競爭 |
| 月曆 | 390px 下行程標籤常只看見時間與省略號 | 月格負責日期／數量／簡短標題；選日後提供清楚的當日清單，避免繼續縮字 |
| 深色格線 | 格線亮度與視覺份量較重 | 用語意化 border token 減弱一般格線，保留今天與選取狀態層級；仍須重跑對比檢查 |
| 週檢視 | 七欄在手機閱讀吃力，細字與拖曳負擔高 | 可提案加入三日模式或更清楚的當日聚焦；保留完整週檢視，產品決策後再實作 |
| 設定 | DP 編號、原稿／搬移／domain 等工程文字直接出現 | 使用者版依「外觀、夥伴、日曆、帳號與資料」整理；開發進度回到文件 |
| 表單 | 已有保留草稿的良好行為，但 dialog 基礎行為不一致 | 先修 R3，再統一保存中／失敗／成功的提示與焦點 |
| 動效 | 寵物目前主要是 CSS 造型與簡單動畫 | 按壓與狀態切換先用短 transform／opacity；完成回饋克制且可關閉 |
| 減少動態 | 多處已有 reduced-motion，仍需統一盤點 | reduced-motion 時移除非必要位移／彈跳；CalendarManage 的 toggle transition 也一起檢查 |

動效初始設計值可用 160–240ms，再依實際手感調整。畫面切換保持捲動與焦點穩定；不要持續播放吸引注意的慶祝效果。六套主題應共用語意 token、字級／間距／狀態規則，避免每套各自漂移。既有對比修正不要改回原稿色值。

截圖：`theme-0-light.png`／`theme-0-dark.png` 為漫畫；1 極簡、2 暖陽、3 商務、4 鮮活、5 像素。另有 `weekly-light.png`、`prototype-month.png`、`mobile-360x640.png`、`landscape-932x430.png`。

#### 5. 功能建議：寵物陪伴與成長優先

##### 第一階段：可用的陪伴互動

- 點寵物開漫畫對話泡泡：今日剩餘待辦、下一個行程，以及明確的「查看／新增」入口；先用可預期的本機規則。
- 靠邊停駐、可拖移、可收起、靜音／減少動態；不能蓋住 FAB、底部分頁、表單按鈕或手機鍵盤。
- 接入既有 Pet Asset Spec 的四種角色與七個狀態，使用 typed asset registry、缺圖 fallback，素材以 120×120 支援 60×60 顯示。
- 點擊、鍵盤與可及性名稱都要具備；目前 PetLayer 整層 aria-hidden，新增互動時必須同步改語意。
- 夥伴選擇若需保存，先定義 preferences／migration／write barrier；不要把新欄位塞進臨時 storage 形成第二套資料模型。

##### 第二階段：可信的成長系統

- 待辦成功保存為完成後才播放回饋與給獎勵。現有 `toggleTodo` 對 UI 是 void，不能只在 click handler 加 XP。
- 先決定重複勾選／取消完成、父子待辦、匯入資料、重試、帳號切換的獎勵規則，確保同一來源不重複給獎勵。
- 成長資料經既有 repository 保存；如需 ledger／新表，獨立 migration 與 RLS 測試，不與動畫 PR 混在一起。
- 優先解鎖表情、配件與日常互動，避免用斷連續天數或扣生命值懲罰漏做行程。

##### 其他高價值補完

- **無日期待辦收件匣**：目前搜尋可找到無日期待辦，但結果 disabled、沒有可開啟的 day sheet。收件匣可直接改名、排日期、完成或刪除，讓寵物的待辦建議有實際落點。
- **搜尋篩選一致性**：目前 calendar filter 只限制 events，todos 仍全部參與；原稿與程式註解的行為敘述不一致。先決定篩選是否涵蓋所有內容，再同步測試與文案。
- **備份狀態**：在修好 R1 後，可顯示上次成功備份時間及資料／附件涵蓋範圍，降低使用者誤以為 JSON 含附件的機會。
- **可靠提醒**：單獨安排 PWA／原生能力與真機可行性驗證，不能以寵物泡泡或前景 timer 宣稱通知可靠。
- 家庭分享、Realtime、完整離線寫入佇列與 AI 依既有 MVP 範圍延後；AI 日後仍經 server-side 代理。

#### 6. 建議後續次序

1. R1：完整帳號載入＋高資料量回歸。
2. R2／R3：release validation 與 dialog 焦點／草稿保護，各自小 PR。
3. 開發依賴修補、真實 AuthProvider 測試、WebKit smoke／真機 QA。
4. 設定文案與資訊層級、月／週閱讀性設計稿；以原稿與 12 組主題驗收。
5. 寵物互動第一階段；規則確認後再做持久化成長系統。

建議先完成前三項可靠性工作，再投入大幅視覺改版與 XP 系統。本報告列出的修正及新增功能尚未實作。
