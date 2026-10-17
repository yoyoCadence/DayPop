# DayPop 架構決策

本文件記錄已確認、會影響多個模組或後續 migration 的設計決策。實際進度與執行順序仍以 [`tasks.md`](../tasks.md) 為準。

## 1. 本機資料必須 fail closed

`daypop.user-data` 是遊客模式的正式資料來源。讀取結果不能只回傳「資料或空值」，而要能區分：

- `ready`：格式有效且 schema version 可由目前 App 讀取。
- `corrupt`：JSON 或 envelope 結構無法解析。
- `future-version`：資料 schema 比目前 App 新。
- `unavailable`：瀏覽器 storage 無法取得、讀取或寫入。

遇到 `corrupt` 或 `future-version` 時，repository 必須拒絕 mutation，不得拿空資料覆寫原值。UI 應顯示持續可見的說明，並提供匯出原始內容、更新 App、重試或由使用者確認的重設流程。重設前若 storage 仍可寫入，先保存備份；備份或匯出成功前不得取代原 key。

storage 不可用時可提供「只維持到本次分頁關閉」的記憶體模式，但必須明確標示為非持久化狀態，不能讓使用者誤認為資料已保存。`QuotaExceededError` 與 storage accessor 例外都屬於這個狀態。

任何本機 schema version 提升前，必須先完成上述 write barrier 與 future-version 回歸測試。

### 實作結果（DP-016／DP-017）

- 備份 key 是 `daypop.user-data.backup.<ISO timestamp>`，不是原先設想的 `.corrupt.`：來自較新 schema 的資料並沒有損壞，用 `corrupt` 命名會誤導。時間戳讓第二次復原不會蓋掉第一次的備份。
- 四個狀態中的 `unavailable` **沒有**做成第四種 read status。`StorageReadResult` 維持 `ready`／`corrupt`／`future` 三態，storage 不可用改由下一層的 `AppStorage` 處理：probe 失敗或中途遭拒就換成 `MemoryStorage`，讀取結果照常是 `ready`。這樣「資料本身有問題」與「這台裝置存不了」是兩個獨立的軸，UI 也能同時呈現（復原畫面＋記憶體模式橫幅）。
- 記憶體模式的警告是版面內、不可關閉的橫幅，四個分頁與復原畫面都顯示；降級後不自動切回持久化，否則同一個 session 會半在磁碟半在記憶體。
- write barrier 與 future-version 回歸測試已完成，schema version 提升的前置解除。
- **DP-101（2026-10-02）補正復原閘門**：存在任意舊備份不代表目前原始資料已備份。復原畫面以 `findMatchingUserDataBackup()` 找內容逐字一致的備份；`resetUserData()` 執行前重新讀取目前 key 並套用同一檢查，資料在備份後變動即拒絕重設。較新但不相符的備份不會遮蔽較舊的相符備份。這是 §1 既有規則的修正，不提升 schema，也不提供跨分頁原子鎖；驗證與剩餘限制見 [`deployment.md`](deployment.md) §5.12。
- **DP-106（2026-10-02）開機 probe 失敗時沿用仍可讀的內容**：原本只有「中途寫入遭拒」會把仍讀得到的 `daypop.*`／legacy key 帶進記憶體，開機 probe 失敗則從空的 `MemoryStorage` 起始。實測（原生 quota、production App）在額度已滿時開機，使用者看到的是預設空白日曆、匯出檔也是空的，壞掉的資料還會被一份空白文件蓋掉畫面上的阻擋狀態 —— 磁碟 bytes 沒有被動到，但儲存空間滿的時候匯出是唯一的出路。專案擁有者 2026-10-02 請 agent 給建議，採用的做法是讓兩條路徑一致：`createAppStorage()` 在 probe 失敗但 store 仍可觸及時，用與 `#degrade()` 同一個 `carryOwnedEntries()` 起始記憶體。**只讀不寫**：probe 失敗的 store 之後不再被寫入，釋放空間也不會在同一個 session 切回持久化。**沒有東西可讀時行為不變**：accessor 丟例外或回傳 null 就沒有 `readable`，照舊從空白起始；讀取也失敗時同樣從空白起始。`corrupt`／`future` 因此在這條路徑也維持 fail closed。不提升 schema；驗證與剩餘限制見 [`deployment.md`](deployment.md) §5.16。

## 2. Domain contract 先於 repository adapter

### 啟動時確認不了登入，不卡在載入中（DP-176，2026-10-15）

DP-158 以真正的 supabase-js（2.111.0）量到：記住的登入已過期、啟動時刷新遇到網路錯誤或 5xx，supabase-js 重試約 25.5 秒才回報，接著被當成未登入、顯示遊客資料；刷新請求一直沒有回應時，則永遠停在「載入中…」。實際情境是手機一晚沒開（token 一小時過期），早上在訊號差的地方打開 App。

**決策（專案擁有者 2026-10-15 核准建議）：** 啟動最多等 8 秒（`AUTH_STARTUP_DEADLINE_MS`）。到期，或 supabase-js 回報「沒有 session」但這台裝置仍存著登入時，就以存著的那個帳號繼續，顯示它的帳號快取與既有的「無法連上雲端」提示，不退回遊客。

修的過程中發現只改 `AuthProvider` 不夠：**supabase-js 每個資料請求都會先等它自己還原完 session**，刷新卡住時，帳號快取的退路（`CachedRemoteLoadError`）永遠等不到那個失敗的請求。所以分兩層：

- **登入層**：`AuthProvider` 的期限與退路。存著的登入由 `readStoredSession()` 讀出，key 是 supabase-js 的預設公式，現在明確傳入 `storageKey`，App 才讀得到同一筆；值不變，既有裝置不會被登出。`AuthContext.sessionUnconfirmed` 只在「用的是存著、還沒被確認的登入」時為 true。
- **資料層**：`SessionDataProvider` 在未確認時改用一個只讀的帳號資料來源。讀取直接回帳號快取並附上離線提示；寫入立刻拒絕，表單保留草稿並說明原因，不會卡在「保存中…」；不送任何請求，也不寫快取。未確認是獨立的 DataProvider identity，確認之後重新掛上正常的帳號資料來源，向 Supabase 載入。舊版資料匯入在未確認時也不啟動，它的 RPC 同樣會等。

supabase-js 照常在背景重試；網路恢復後它的自動刷新會發出事件，取代存著的 session。伺服器明確拒絕 refresh token 時，supabase-js 會清掉儲存，這時照常回到遊客，期限到了也不會把帳號找回來。沒有快取的帳號在未確認時顯示既有的讀取失敗與「重試載入」，不會顯示別人的或空白的資料。

不在本項：離線寫入佇列（MVP 範圍外）；刷新永遠沒回應時，supabase-js 的鎖會一直被占住，自動刷新也跑不了，要重新開 App 才會再試。

驗證：`AuthProvider.test.tsx` 以真正的 supabase-js 跑 19 個案例，新增或改寫 7 個：網路錯誤／503 時期限到即以帳號繼續、supabase-js 放棄後仍是該帳號；請求沒回應時期限到即繼續；網路恢復後自動確認；伺服器拒絕 token 時回到遊客；整棵 `AuthProvider`＋`SessionDataProvider` 顯示帳號快取與提示且不碰資料 API；未確認時寫入立刻失敗；確認後改由 Supabase 載入。拿掉資料層時 2 個失敗，整個修正拿掉時 7 個失敗。e2e 的登入 harness 直接提供 `AuthContext`，碰不到這一層，所以沒有瀏覽器案例；真機上的離線啟動也沒有實測。

### 沒有日期的待辦在綜覽有地方管理（DP-173，2026-10-14）

畫面上建不出沒有日期的待辦（`NewTodoInput.date` 必填），它們只會從匯入進來（JSON 備份、legacy）。在此之前，這種待辦搜尋得到卻點不開，綜覽與日詳情都依日期列出，所以沒有任何畫面能改名、排日期、完成或刪除它。

**決策（專案擁有者 2026-10-14 定案，採建議）：先給它一個出口，不做正式的收件匣。** 綜覽選「待辦」時，最上方顯示「未排日期」區塊，沿用日詳情的待辦卡片（`DayTodoCard`），所以改名、優先度、改日期、完成、刪除、子項的規則都與日詳情相同，不另寫一套。`todoGroupsOn()` 接受 `null` 來分組沒有日期的列，沒有新增契約、schema 或 migration；`rescheduleTodo` 本來就允許替既有的無日期列排上日期（DP-129）。

- 不屬於任何期間，所以不受年／月／週影響，也不計入「共 N 筆」。
- 排上日期後移到那一天；子項日期與父項獨立（DP-129），沒排日期的子項會留在區塊裡成為自己的卡片。
- 同一時間只有一筆日期寫入，比照日詳情（DP-132）；卡片離開清單後，焦點留在區塊標題上。
- 沒有無日期待辦時整個區塊不出現，這是一般使用者的常態。

不在本項：建立無日期待辦、把日期清掉，以及搜尋結果點進來。這些等寵物泡泡（DP-169）需要一個落點時再做成正式的收件匣。原稿的待辦一定有日子，這是 DayPop 的補充，不是搬移。

### 搜尋的日曆篩選也篩待辦（DP-174，2026-10-14）

搜尋欄下方的日曆 chips 是原稿的 `searchCal`。原稿 `:1295` 只在選「全部」時才搜待辦（`if(fc==='all') this.state.todos.forEach(…)`），因為原稿的待辦沒有日曆；選了特定日曆，待辦就整批不出現。DayPop 先前反過來：選了日曆只篩行程，待辦照樣全部出現，`search.ts` 的註解卻說這是沿用原稿。

**決策（專案擁有者 2026-10-14 定案，採建議 (b)）：依每筆待辦自己的 `calendarId` 篩選。** DayPop 的待辦屬於某個日曆，這是唯一讓「依日曆篩選」對行程與待辦意思一致的做法；照原稿整批隱藏，等於選了日曆就看不到該日曆的待辦。這是刻意偏離原稿。

子項依它自己的日曆判斷，不看父項。在 App 裡建立的子項會繼承父項的日曆（DP-116），所以平常不會分開；匯入的資料不保證如此，那時子項出現在它自己的日曆下。搜尋本來就逐筆列出待辦、不分組，這樣判斷最直接。結果前面的色點維持原狀：行程用日曆顏色，待辦用主題色，和原稿相同。

驗證：領域層 4 個案例（全部、各日曆、子項依自己的日曆、空日曆），還原修正後 3 個失敗，「全部」那個是守衛；搜尋畫面 1 個案例實際點 chips，還原後失敗。

### 帳號、更新、公告與匯入對話框接上共用焦點規則；通知不蓋在對話框上（DP-156，2026-10-14）

`AuthDialog`、`UpdateDialog`、`ReleaseNoticeDialog` 與 `DataImportDialog` 改用 `useModalFocus()`，2026-10-13 審查量到的七個對話框至此都接上了。`AuthDialog` 的狀態原本寫在常駐元件裡、關閉時 `return null`，改為拆出開啟時才掛載的面板，hook 才會在開啟時註冊；關閉時本來就會清空所有欄位，所以行為不變。`DataImportDialog` 移除自己的 Escape 處理，初始焦點仍是「取代資料」。

各自的 Escape：登入等於 ×，更新提示等於「稍後提醒」，版本公告等於「知道了」，匯入預覽等於取消；請求送出中、新版準備中都不關。

**決策：通知不蓋在使用者打開的對話框上。** 共用堆疊把鍵盤鎖在最新開啟的圖層，並把其他圖層設為 `inert`。使用者自己打開的圖層一定往上疊（日詳情 65 → 事件 sheet 90 → 範圍對話框 92），但更新提示與版本公告是版本檢查完成時自己出現的，z-index 90，比日曆對話框（94）、匯入預覽（93）與範圍對話框（92）低。如果照原樣開啟，鍵盤會被鎖進被蓋住、看不見的通知，看得見的對話框卻變成 `inert`，使用者點不動也按不到，等於卡死。

所以 hook 加上 `notice` 標記與 `useModalLayerOpen()`（只計算非通知的圖層），`App` 在它為 true 時先不畫通知；更新狀態仍留在 `useAppUpdate`，對話框一關通知就出現，焦點進入通知，關掉後回到原本的位置。另一個做法是把通知的 z-index 提到最高、讓它打斷使用者；沒有採用，因為那會在使用者填表時插進來，而原本的實際表現（被蓋在下面、關掉才看得到）就是「等」。

`UpdateDialog` 準備新版時兩顆按鈕都停用，焦點會落到 `<body>`；這時 Tab 被擋下、不會離開，失敗後按鈕恢復，下一次 Tab 回到對話框。DP-089 的捲動驗證（以畫面座標點擊）與 DP-023 註冊完成後的終態（只剩 ×）都不受影響。

驗證：hook 新增 1 個單元案例（`useModalLayerOpen()` 不計通知）。新 e2e `notice-dialog-focus.spec.ts`（手機＋桌面）：版本檢查在日曆對話框打字時回應，更新提示不出現、焦點與輸入都留在原地，按 Escape 關掉對話框後提示才出現並鎖住焦點，再按 Escape 等於「稍後提醒」、焦點回到「＋ 新增日曆」；版本公告、登入（dev harness）、匯入預覽各走一圈並按 Escape。還原修正後 4 個都失敗。

### 日曆的 sheet 接上共用焦點規則（DP-155，2026-10-14）

`EventSheet`、`DayDetailSheet` 與疊在上面的 `ScopeDialog` 改用 `useModalFocus()`。原本 Escape 由三套各自的 listener 拼起來：`CalendarScreen` 在 window 冒泡階段決定關哪一層 sheet，`EventSheet` 在寫入等待中用 capture 階段吃掉 Escape，`ScopeDialog` 在 capture 階段自己處理 Tab 與 Escape、再 `stopPropagation()` 擋住下面的 sheet。三者都移除，由共用堆疊決定「最上層」。

接上時 hook 改了兩處：

- **Escape 改在冒泡階段處理**，Tab 仍在 capture 階段。日詳情的 inline 改名與換日編輯器在 React 的 `onKeyDown` 裡 `stopPropagation()`，靠的是事件到不了 window 的冒泡階段；DP-154 的 hook 在 capture 階段處理 Escape，會比它們先拿到，取消一個改名就會關掉整個日詳情。現在內層元素可以先認領，hook 也略過已被 `preventDefault()` 的事件。
- **「開啟前是誰有焦點」改在 effect 裡決定。** 週格拖曳重複事件時，`WeekView` 會在自己的 effect 把焦點放回被拖的色塊，再由範圍對話框接手（DP-072）。只在 render 時記錄會拿到拖曳前的狀態，取消後焦點回不到色塊；完整 e2e 第一輪就是在這裡失敗。現在焦點若已被 `autoFocus` 搬進圖層，才用 render 時記下的元素，否則用 effect 執行當下有焦點的元素；只決定一次，StrictMode 的第二次執行不會覆蓋。

行為變化：日詳情開啟時焦點進入 sheet；原本焦點留在觸發它的日期格，第一次 Tab 就到背後的 FAB。關閉後焦點回到日期格，月格的方向鍵移動（DP-069）可以接著用。

既有契約都保留：範圍對話框的 Escape 只關自己、草稿留在事件 sheet；事件 sheet 疊在日詳情上時 Escape 只關事件 sheet；寫入等待中 Escape 不關（DP-133／134）；inline 編輯器的 Escape 只取消編輯（DP-120／130／132）。兩個既有單元測試的斷言改寫為守住原本的意圖：它們原本以「換日後焦點在 `body`」「Escape 沒被攔下」當基準，那是沒有焦點管理時的副作用。

驗證：hook 新增 2 個單元案例（內層元素先認領 Escape；較早的 effect 給了焦點時，關閉後還給它）。新 e2e `calendar-sheet-focus.spec.ts`（手機＋桌面）按真實按鍵：日詳情、新增行程、日詳情上再開新增行程、重複事件範圍對話框各走一圈並按 Escape；還原修正後 4 個中有 3 個失敗，範圍對話框那個原本就有自己的循環，作為守衛。完整 e2e 第一輪 189 通過、7 跳過、2 失敗（上述跨午夜案例，手機與桌面各一）；修正後該 spec 與其他拖曳、焦點 spec 共 22 個全過。

### 對話框共用焦點規則，先套用日曆對話框（DP-154，2026-10-14）

`aria-modal="true"` 只是告訴輔助科技「後面的頁面現在搆不到」，本身什麼都不擋。2026-10-13 審查在新增日曆對話框重現：輸入名稱後 Shift+Tab 兩次到了背景的「綜覽」分頁，按 Enter 就切頁，對話框與打好的名稱一起消失。複核量到七個對話框都能讓焦點跑到背景（`docs/review-2026-10-13-project-audit.md` §2.3）。原稿沒有焦點限制，所以這和 DP-141 一樣是狀態與可及性的擴充，不是搬移時弄壞的。

**決策：** 共用的 `useModalFocus(layerRef, { onEscape })`（`src/shell/useModalFocus.ts`），本項只接上 `CalendarEditDialog`，其餘對話框依 DP-155／156 接上。

- **背景用 `inert`，而不是只攔截 Tab。** 開啟時把圖層以外的兄弟節點，以及每一層祖先的兄弟節點一路到 `<body>`，都設為 `inert`。這樣鍵盤、滑鼠與螢幕閱讀器都碰不到背後的頁面。關閉時只解除自己設的；已經是 `inert` 的不碰，它屬於下面那一層，由那一層自己解除。目標瀏覽器都支援 `inert`（Safari 15.5 起）。
- **Tab 仍要攔截。** 只有 `inert` 時，焦點會在兩端離開文件、跑到瀏覽器自己的控制項；Tab 與 Shift+Tab 要在最上層圖層內循環。全部控制項都停用時（DP-141 的等待中）擋下 Tab，焦點留在原處。
- **Escape 只交給最上層**，而且輸入法組字時不處理（`isComposing`，Safari 為 `keyCode 229`）：用來取消中文候選字的 Escape 不能把裝著文字的對話框關掉。日曆對話框的 Escape 與點背景同一條規則：寫入等待中不關閉。日曆對話框原本完全沒有處理 Escape，這是新增的行為。
- **`layerRef` 指向圖層最外層、包含背景**：點背景會關閉的背景必須留在圖層內，否則它自己也會變成 `inert`。
- **焦點歸還**：觸發的元素在第一次 render 時記下，因為 `autoFocus` 在 commit 階段就把焦點搬進對話框，effect 已經看不到原本是誰。關閉時，焦點若在圖層內或已落到 `<body>`，就還給它；它已不在文件中（例如剛刪掉的日曆的編輯鈕）則不動。
- **開發模式的 StrictMode** 會模擬卸載再掛載而不移除 DOM。圖層還在文件中就不歸還焦點，否則開發環境裡初始焦點會被搬回觸發鈕。

疊放的現況：日曆對話框（z-index 94）高於更新提示與版本公告（90）。更新提示若在日曆對話框開著時出現，會被蓋在下面，等日曆對話框關掉才能操作；它是晚於日曆對話框掛上的節點，不會被設成 `inert`。所有對話框接上同一個堆疊之前（DP-155／156），還沒接上的對話框各自的 Escape 與焦點處理照舊。

驗證：hook 的 7 個單元案例（`inert` 範圍與釋放、Tab 兩端循環與從外面拉回、全停用時擋下、巢狀時 Escape 只給上層、組字中的 Escape、焦點歸還、StrictMode 不搶 `autoFocus`）。對話框的 3 個案例在拿掉 hook 時有 2 個失敗，剩下的是輸入法守衛。新 e2e `calendar-dialog-focus.spec.ts`（手機＋桌面）依審查步驟按真實按鍵，再各走一整圈；拿掉 hook 時在「第 1 次 Shift+Tab」失敗，正是審查描述的地方。沒有 iOS Safari、實體鍵盤或螢幕閱讀器的實測（DP-032）。

### 帳號資料完整載入，不靠單一回應（DP-152，2026-10-14）

`SupabaseDayPopRepository.load()` 原本對六個集合各發一次 `select('*')`。PostgREST 會把每個回應截到專案的 `max_rows`（repo 設定 1,000），而且不會告訴呼叫端。2026-10-13 審查以真正的 supabase-js 重現：1,001 筆行程只載入 1,000 筆，接著做的 JSON 備份也是 1,000 筆，過程沒有任何錯誤。匯入上限允許一萬筆以上，所以一次還原就到得了。

這次補的回歸另外證實了兩件審查只推論到的事：

- **截斷會蓋掉完整的快取。** 帳號快取會存下每次確認的 load。舊版在上限比資料少時「成功」載入第一頁，於是上一份完整的快取被截斷的版本取代。
- **截斷也可能讓整份資料載入失敗。** 例外指向的系列、子項指向的父待辦被截在外面時，`parseDayPopUserData()` 拒絕整份文件。

**決策：**

- 六個集合共用 `loadAllRows()`。以主鍵分頁（`order=id.asc`、`id=gt.<上一頁最後一筆>`），而不是 offset；這樣兩次請求之間有列被刪掉時，後面的列不會被擠出視野。
- **結束條件看伺服器回傳的 exact count，不看「這頁不滿」。** 伺服器上限比我們要的頁大小低時，回來的就是不滿的一頁，但後面還有資料。伺服器沒有回 count 時，讀到空頁為止：多一次請求，但仍然完整。頁大小是 1,000，和 `config.toml` 相同。
- 任一頁失敗，整次 load 失敗。部分集合不會進 snapshot，也不會寫進帳號快取；有快取時沿用既有的 `CachedRemoteLoadError` 顯示上次的資料。
- 一般帳號（每個集合不到一頁）的請求數不變：每個集合一次，加上偏好與附件清理佇列，共 8 個 select。

**載入後的順序。** 分頁迫使查詢依 `id` 排序，而 id 是隨機 UUID。改之前查詢沒有 `ORDER BY`，資料大致依插入順序回來，畫面上依「存放順序」顯示的地方靠的是這個，最明顯的是同一天的貼圖（`stickersOn()`）；寫入後的 snapshot 也是這個順序，因為領域函式把新列附加在最後。所以集合載入完整之後，依 `created_at` → `sort_order`（有這欄的表）→ `id` 重新排序：

- 每個請求是各自的交易，逐筆建立的列時間不同且遞增，重新載入後會落在寫入時的位置。
- 同一個 RPC 寫入的列時間相同。這時 `sort_order` 讓匯入那天的貼圖保持備份裡的順序，最後由 `id` 決定，確保每次結果一樣。

真實 Postgres 在沒有 `ORDER BY` 時從不保證插入順序，UPDATE 之後列的實體位置也可能改變，所以先前「重新載入的順序等於插入順序」本來就沒有保證；現在它有明確的定義。

**`FakeSupabase` 為此補了三件事**，理由都和 DP-138 相同：fake 比真實服務寬鬆，問題就永遠是綠的。

- 預設列數上限 1,000，支援 `order`／`limit`／`gt` 與 exact count。可以設定伺服器不回 count，或讓某個表的第 N 個請求失敗。
- **每個寫入請求有自己遞增的時間**，同一個 RPC 的列共用一個時間。原本所有寫入共用一個固定時間，fake 的陣列順序就成了唯一能分辨先後的依據；載入改依建立時間排序後，這個差別會讓測試結果和真實資料庫不同。測試明確設定的時間仍會原樣用在下一次寫入。
- 時鐘改了之後抓到一個既有測試的假設：帳號端「取代資料」匯入時，資料庫的 insert trigger（DP-036）會把 `created_at` 設成匯入當下，所以匯入後 `createdAt` 本來就會變。對應的契約測試改為比對實際值，帳號 ICS e2e 改為斷言「同一次匯入的列共用一個時間，而且晚於原有的列」。

**已知限制：**

- 分頁之間另一台裝置寫入的列，可能包含也可能不包含在這次 load 裡；兩次請求之間沒有快照隔離。MVP 是單裝置假設，這一點不處理。
- 附件清理佇列的讀取仍是單一請求。超過 1,000 筆待清理的檔案會在之後幾次 load 分批清掉；它本來就是盡力而為的佇列，不影響資料完整性。
- 遠端專案實際的 Max rows 沒有量。真實 PostgREST 的請求格式由一個測試以真正的 supabase-js 加上模擬 transport 驗證（`order`、`limit`、`id=gt.`、`Prefer: count=exact`），沒有對真實 Supabase 執行。

不改 schema、migration、RLS、Auth、版號、公告或部署。

驗證：新增 8 個 adapter 案例與 1 個快取案例，在還原 adapter 後 9 個中有 8 個失敗（剩下的是「一般帳號請求數不變」的守衛，修正前本來就該通過）。另有一個 DP-115 既有測試的期待順序改為新規則下的確定順序：三筆待辦的建立時間與 `sort_order` 都相同，由 `id` 決定。

### 刪除日曆是一個交易，不是一串請求（DP-138，2026-10-07）

帳號端刪除日曆原本是四到五個獨立的 PostgREST 請求：搬移 `events`、搬移 `todos`、搬移 `stickers`、（刪的是預設日曆時）把另一個日曆設為預設，最後刪除。登記這一項時只看出它不是原子操作，並推論「重試會收斂、沒有資料遺失」。專案擁有者要求補上失敗情境的驗證；在本機由 migration 重建的 PostgreSQL 上照 adapter 的順序執行，結果比推論嚴重：

- **刪除預設日曆必定失敗。** `calendars_one_default_per_owner_idx` 是 partial unique index，每個敘述結束時檢查。舊預設還在的時候把另一個日曆設為預設，就是同一個擁有者有兩個預設，第四步得到 `duplicate key value violates unique constraint`。這時前三步已經提交：1 筆行程、2 筆待辦、1 筆貼圖已在另一個日曆上，兩個日曆都還在，預設仍是原本那個。重試會重複同一個失敗，所以原先「重試會收斂」的推論只對刪除**非預設**日曆成立。沒有資料遺失，但這個日曆刪不掉，而且 snapshot 與伺服器不一致。
- 反過來「先刪再提升」可以避開 index，卻會在兩個請求之間留下沒有預設日曆的帳號；adapter 每次載入都以「恰好一個預設日曆」驗證整份文件，那樣的帳號會載入失敗。

沒有任何一種請求順序能同時解決這兩件事，所以把它收進資料庫：`delete_calendar_with_reassignment(uuid)` 在一個函式內搬移、刪除、最後才提升，任何錯誤整批回復。目標日曆的規則照 `calendarDeletionPlan()`：倖存的預設，否則依 `sort_order` 的第一個；函式另以 `created_at`、`id` 打破平手，領域函式沒有這個 tie-break，只在匯入資料重複使用 `sort_order` 時有差別。三張子表各以單一敘述搬移；`todos` 的複合外鍵要求子待辦與父待辦在同一個日曆，而且在敘述結束時檢查，所以父子必須在同一個敘述裡一起換。守衛沿既有 RPC：SECURITY INVOKER、空 `search_path`、明確的 `auth.uid()` 檢查、每個敘述都過濾 `owner_id`、只授權 `authenticated`。

adapter 的責任因此變小：`calendarDeletionPlan()` 仍在送出前擋掉「最後一個日曆」與未知 id，接著只有一個 RPC，成功後重新 `load()`。目標與是否提升都由伺服器決定，所以讀回結果而不在本機重算；這與匯入 RPC 的做法相同。回傳 `false` 表示本人已無該日曆（回應遺失後的重試，或已在別處刪除），同樣以 reload 對齊，與 DP-134／135 對 `false` 的讀法一致。RPC 已提交但 reload 失敗時，呼叫端會收到錯誤、snapshot 暫時落後，下一次嘗試得到 `false` 再 reload 即修復。遊客端沒有這個問題，仍用純領域的 `withoutCalendar()`。

**為什麼先前沒被發現：** `FakeSupabase` 沒有模擬那個 partial unique index，於是單元與 e2e 都接受了真實資料庫會拒絕的請求序列。現在 fake 的 `calendars` 寫入會在每次敘述後檢查該 index；補上之後，既有的契約測試「刪除預設日曆時提升另一個」立刻以和真實資料庫相同的錯誤失敗。fake 只模擬被人想到的約束（DP-115 為 parent FK 的 cascade 補過一次）；凡是依賴資料庫約束的行為，都要有 pgTAP 或本機 Postgres 的實測，不能只靠 fake。

**部署順序是這個決策的一部分：** 前端改成呼叫遠端必須已經存在的函式。migration 由專案擁有者推到遠端之後才能部署前端；順序顛倒時，帳號端的刪除日曆會失敗且不改變任何資料（比現況安全），但功能不可用。

驗證：本機 PostgreSQL 重現上述失敗（腳本與輸出留在 `%TEMP%/daypop-dp138-repro.log`）；fake 補上 index 後契約測試在修正前失敗；browser「刪除預設日曆」案例在還原 adapter 時失敗。`db reset` 套用 16 檔成功，pgTAP 6 檔 174／174（新增 24 項，含以 trigger 在搬移貼圖時丟錯、確認行程與待辦一併回復）。重新產生的型別只多這支函式。沒有在真實雲端專案執行過這支函式。

### 新增以草稿 id 落點，重試不重複（DP-142，2026-10-07）

DP-133／137／141 讓表單在寫入未確認時留下草稿，並請使用者「先確認資料再重試」。這句話背後有一個一直沒解決的但書：transport 失敗時分不出伺服器到底寫了沒有，而每次新增都由 adapter 另外產生 id。於是「已寫入、只是回應沒回來」之後的重試，會在伺服器上多出一筆一模一樣的行程、待辦或日曆。以假後端的 `lostResponses`（先提交再讓 Promise reject）重現：三種新增在重試後都是多一列。

帳號端的三個新增本來就是對主鍵 `upsert`，缺的只是讓兩次嘗試共用同一個 id。所以契約的改動很小：

- `NewEventInput`／`NewTodoInput`／`NewCalendarInput` 加上可選的 `id`。表單在**一份草稿的生命週期內**固定它：行程表單每次開啟各取一個行程 id 與一個待辦 id；日詳情的兩個連續輸入欄位在一筆新增確認後才換新的；新增日曆對話框每次開啟取一個。失敗後修改草稿再送出，仍是同一份草稿、同一個 id。
- 兩個 adapter 以 `creationTarget(existing, proposed, generated)` 決定落點，行為一致（`repositoryContract.test.ts` 對兩者跑同一組案例）。提案是 UUID 就採用；省略或不是 UUID 則改用 adapter 產生的 id —— **忽略而不是拒絕**，因為這個 id 只是讓重試更安全，不能反過來讓使用者丟掉草稿。`generated` 由呼叫端傳入，`mutations.ts` 維持不碰亂數。
- snapshot 已經有該 id，代表這筆新增先前已被確認：adapter 不送 request，也不拿可能過時的草稿覆寫，原樣回報 snapshot。

回應遺失後的重試因此變成：snapshot 還沒有那個 id → 以同一個 id `upsert` → 落在第一次已寫入的那一列，內容以重試時的草稿為準 → snapshot 收到一筆。伺服器端沒有新東西：owner RLS 的 INSERT／UPDATE policy 與主鍵衝突處理，就是 `toggleTodo` 等既有 upsert 一直在用的那條路。遊客端沒有網路，採用同樣的規則是為了讓兩個 adapter 對「重試」的意義一致。

**這取代了先前幾節裡「新增不具備 idempotency、手動重試可能重複」的敘述**，那些句子在寫下時是事實。UI 文案沒有改：「先確認資料再重試」仍然成立，只是重試不再有重複的代價。

不在本項：貼圖新增沒有草稿也沒有重試介面，維持每次產生 id；附件上傳每次嘗試仍是新的 id 與新的物件路徑；單次修改與匯入各自由 RPC 處理；刪除在 DP-134／135 已處理。不改 schema、RPC、RLS、Auth、公告或部署。

驗證：兩個 adapter 的契約案例與帳號端「回應遺失後重試」案例在修正前失敗（伺服器多一列）；browser 案例在還原兩個 adapter 時失敗（伺服器同時有「工作」與「工作（重試）」兩個日曆）。lint、typecheck、1050 個單元案例／64 檔、七項 posttest、build／check:build 通過。新增 `e2e/create-retry-idempotent.spec.ts`（mobile／desktop，實際 browser timezone America/New_York、display Asia/Taipei）：日曆、行程、待辦各走一次「伺服器已存、回應遺失、明確重試」，重試後伺服器、帳號快取與畫面都只有一筆，日詳情確認後的下一筆待辦是新的一列。沒有真實雲端或真機證據；真實 PostgREST 的 upsert 行為只由既有的 upsert 路徑與 pgTAP 的 owner policy 間接支持，沒有針對「同 id 重試」的遠端實測。

### 日曆編輯對話框等待確認（DP-141，2026-10-07）

設定的「新增日曆／編輯日曆」是最後一個送出即關閉、又帶著草稿的表單。關閉不是對話框自己做的：`SettingsScaffoldScreen.saveCalendar()` 與 `onDelete` 在呼叫 action 的同一行就 `setEditing(null)`。帳號寫入失敗時，對話框已經卸載，名稱與顏色沒了，唯一的線索是全域橫幅。刪除更需要留在原地：它在帳號模式是多個請求（DP-138），失敗訊息指出是哪一步，使用者需要看得到。

做法與 DP-133／134 一致。`addCalendar`／`updateCalendar`／`deleteCalendar` 改由 `confirmed()` 回傳既有單一 queue 的確認 Promise；ignored rejection 有 handler，所以設定清單上的顯示／隱藏開關這類不等待的呼叫不必更動，DataProvider 的 warning／saving／write barrier 分類也不變。關閉的責任從父層移到對話框：`CalendarEditDialog` 等到確認才呼叫 `onClose`，父層只負責回傳 Promise。

等待時整個對話框停用（輸入、色票、儲存、取消、刪除），背景點擊無效，重複送出由 ref 擋下；被按下的按鈕顯示「保存中…」或「刪除中…」，另一顆不變。失敗時回到可編輯狀態，名稱與顏色原樣保留，提示放在該按鈕正下方：保存是「名稱與顏色已保留；請先確認資料再重試」，刪除是「尚未確認刪除；請先確認資料再重試」。停用會讓原本聚焦的控制項失焦到 body，失敗後只在這種情況把焦點還給被按下的按鈕，不搶其他控制項。沒有自動重送。這裡用 `disabled` 而不是 DP-137 的 `readOnly`，因為成功後對話框就關閉，沒有需要延續的輸入焦點。

一個只有等待才會出現的細節：確認刪除時，資料層先更新、對話框稍後才被告知。父層以 id 查出的 `calendar` 這時已是 null，原本依 prop 決定的標題會閃成「新增日曆」。標題與 `aria-label` 因此改在開啟時決定一次。

原稿的日曆保存是同步的本機操作，沒有等待或失敗狀態；這是沿既有對話框與 token 的狀態擴充。停用時的 `opacity: 0.65`／`cursor: wait` 比照附件按鈕的 busy 樣式，提示文字用 `--fg`、12px。不改 repository：刪除日曆的多步驟非原子問題仍由 DP-138 追蹤，這一項只是讓它的失敗看得見。

驗證：八個回歸（對話框五個、DataProvider 三個 action）在修正前失敗；browser 案例在還原四個檔案時也失敗。lint、typecheck、1029 個單元案例／64 檔、七項 posttest、build／check:build 通過。新增 `e2e/calendar-dialog-confirmation.spec.ts`（mobile／desktop，dev-only synthetic account）：新增日曆失敗後對話框、輸入、清單與帳號快取都不變，重試才出現；刪除在「搬移 events」那一步失敗後同樣留在原地，重試才移除。375×667 兩種失敗狀態的對話框完整在畫面內、`.dp-viewport` 捲動範圍 0、無水平溢出。完整 e2e 由 CI 執行；沒有真實雲端或真機證據。

### 日詳情新增待辦等待確認（DP-137，2026-10-07）

DP-133 讓行程表單的新增待辦等待確認，但日詳情裡每天更常用的兩個入口 ——「新增清單項目」與卡片內的「新增細項」—— 仍是呼叫 `onAddTodo` 後立刻清空輸入框。帳號寫入失敗、或遊客的輸入被拒絕（例如父項已被前一個排隊中的刪除移除）時，畫面只剩全域的未同步橫幅，使用者打好的標題已經不見。

`addTodo` 自 DP-133 起就回傳既有單一 queue 的確認 Promise，所以本項不動 DataActions 與 repository，只讓這兩個表單等待它。共用邏輯放在 `useConfirmedTodoAdd()`：確認後才清空；失敗保留輸入並在表單下方顯示「待辦尚未確認新增，輸入內容已保留；請先確認清單再重試」；同步的 callback 視為已確認，與 EventSheet 相同。沒有自動重送：transport 失敗時無法判斷伺服器是否已經有那一列，新增也不具備 idempotency（**補正：DP-142 起新增以草稿 id 落點，重試不再重複，見上方該節**），所以文案要求先確認清單。

與行程表單不同的兩個決定：

- **等待時用 `readOnly`，不用 `disabled`。** 這兩個欄位是連續輸入用的，送出後焦點留在輸入框、手機鍵盤不收起，才能接著打下一筆。`disabled` 會讓欄位失焦，確認後還得把焦點搶回來。重複送出改由 ref 擋下，表單以 `aria-busy` 表示等待；送出按鈕不停用，避免按下它之後焦點掉到 body。
- **不鎖 day sheet。** 日詳情是瀏覽畫面，其他列的操作不該因為一筆新增在等待而被擋住。等待中關閉或換日（body 以日期為 key 重新掛載）時，舊請求仍在 queue 內完成，失敗照常由 DataProvider 的橫幅報告，只是不再更新已卸載的表單。

原稿的新增是同步的本機操作，沒有等待或失敗狀態；這是沿既有欄位與 `.cal-day-title-error` token 的狀態擴充，不改版面。勾選、刪除與貼圖沒有會遺失的輸入，維持原本不等待的寫法。

驗證：四個回歸（兩個表單 × 等待、失敗重試）在修正前失敗於「輸入被清空」；browser 案例在還原兩個元件時也失敗。lint、typecheck、1008 個單元案例／61 檔、七項 posttest、build／check:build 通過；PowerShell 實際 Intl America/New_York 下 DayDetailSheet／CalendarScreen 兩個測試檔 66 案例通過。新增 `e2e/day-todo-add-draft.spec.ts`（mobile／desktop，實際 browser timezone America/New_York、display Asia/Taipei）以 dev-only synthetic account 驗證 transport 失敗後輸入、焦點與帳號快取都不變，明確重試才新增，且不離開輸入框就能接著新增下一筆。375×667 的失敗提示在表單正下方、無水平溢出。完整 e2e 由 CI 執行；沒有真實雲端或真機證據。

### 附件按鈕的焦點不得捲動 App（DP-136，2026-10-07）

DP-028 的「選擇附件」是一個 label 包住視覺隱藏的 `<input type="file">`。輸入框是 `position: absolute`，label 卻沒有定位，於是 containing block 一路落到最近的定位祖先 `.cal-sheet-backdrop`。絕對定位元素不隨未定位的捲動容器移動，所以它停在「sheet body 沒捲動時」的版面位置：375×667 為 top 909px，在畫面下方，並替 `.cal-sheet-backdrop` 與 `.dp-viewport` 撐出 243px（390×844 為 87px、1280×900 為 123px）的捲動範圍。

`.dp-viewport` 以 `overflow: hidden` 裁切，手指捲不動，但瀏覽器在焦點移動時仍會捲動它。輸入框一取得焦點 —— 鍵盤 Tab，或直接按 label（點擊會把焦點交給輸入框）—— 整個 App 就被捲到上限：375×667 的 sheet 標題列從 97px 變成 -146px，「取消／儲存」不在畫面內，畫面下方留白，而 `overflow: hidden` 的容器沒有讓手指捲回去的方法。390×844 與桌面的標題列仍在畫面內，但整個 App 同樣上移並裁掉頂部。既有的附件 e2e 以 `setInputFiles()` 直接把檔案交給輸入框，從來沒有按過 label，所以一直是綠的。

修正是讓 label 成為 containing block（`position: relative`）。輸入框因此留在 label 內、跟著 sheet body 捲動，App 的捲動範圍回到 0；焦點落上去時只有 sheet body 捲動把按鈕帶進畫面。輸入框被裁成 1px，sheet 既有的 `input:focus-visible` 焦點框在它身上看不到，因此另以 `.cal-attachment-picker:has(input:focus-visible)` 在 label 顯示同樣的 2px accent 外框；用 `:focus-visible` 而非 `:focus-within` 是為了維持「指標點擊不顯示焦點框」的既有慣例，不支援 `:has()` 的瀏覽器只是沒有這個框，與修正前相同。

**通則（之後新增控制項時適用）：`.dp-viewport` 手指捲不動但焦點捲得動。任何 `position: absolute` 的視覺隱藏元素都必須有自己的定位祖先，否則它會停在未捲動的版面位置並讓焦點捲走整個 App。** 目前全專案只有這一處用這種寫法；設定頁的兩個檔案輸入框用 `hidden` 屬性，不佔版面也取不到焦點。沒有改 `.dp-viewport` 本身（例如換成 `overflow: clip`）：那會影響所有畫面，屬於另一個需要完整回歸的決定。

這也解釋了 DP-134 段落記下的「`.cal-sheet-backdrop` 在操作前就有 243px／87px 捲動範圍、成因未查」，以及當時第一張截圖裡標題列消失的現象。

驗證：新增 `e2e/attachment-picker-focus.spec.ts`，以螢幕座標按下按鈕（先只捲動 sheet body，如同手指）；不用 `locator.click()`，因為它會先替你捲動祖先，這是 DP-089 更新對話框留下的同一個教訓。修正前六個案例全部失敗，量到的 App scrollTop／標題列位置為 390×844：87／31px（原 118px），375×667：243／-146px（原 97px），1280×900：123／13px（原 136px）；修正後皆為 0 且標題列位置不變，Tab 抵達時 label 的 computed outline 為 `solid 2px`。lint、typecheck、1003 個單元案例／61 檔、七項 posttest、build／check:build 通過，production CSS 內兩條規則都在。本機另跑既有附件、行程表單保存／刪除、responsive shell、guest CRUD 與帳號備份 spec，連同新案例共 31 通過／3 跳過；完整 e2e 由 CI 執行。只在 Chromium 重現與驗證，iOS Safari／真機未驗；帳號流程仍是 dev-only FakeSupabase。

### 附件刪除的回應遺失重試（DP-135，2026-10-06）

DP-134 驗證時查出 `deleteEventAttachment` 有同型的 `if (!deleted) return data`。`delete_event_attachment_with_cleanup`（最後一次定義在 `20260809085514`）和事件刪除的 RPC 一樣，只在「本人擁有的那一列已不存在」時回傳 `false`。上次呼叫已提交、只是回應遺失時，明確重試必定得到 `false`；舊程式原樣回傳舊 snapshot 而不丟錯，於是 EventSheet 顯示「附件已刪除」，附件卻仍在清單與帳號快取，再按「刪除」也一樣。

修正比照 DP-134，兩個刪除方法現在是同一契約：收到任何 boolean 都移除該筆 metadata 並 flush 既有清理佇列（第一次提交時登記的清理工作因此完成，Storage 物件被移除）；非 boolean 的回應不算確認，adapter 拒絕並保留最後確認的 snapshot／cache。方法開頭「snapshot 已無該筆就不送 request」的防護不變，所以清掉之後再按不會多打一次 RPC。只改這一個方法的結果處理：EventSheet 的附件 UI 本來就等待結果並顯示錯誤訊息，DataProvider 的 queue 也不變；RPC／RLS、schema、Auth、公告與部署均不變，沒有自動重送。

驗證：四個回歸（回應遺失後重試、三種非 boolean 回應）在修正前失敗；browser 案例在只還原 repository 修正時也失敗（重試後附件仍在清單）。lint、typecheck、1003 個單元案例／61 檔（預設 timeout）、七項 posttest、build／check:build 通過；PowerShell 實際 Intl America/New_York 下 repository 測試檔 44 案例通過。新增 `e2e/attachment-delete-lost-response.spec.ts` 與既有 `auth-attachment.spec.ts` 的四個 mobile／desktop 案例在本機通過，console error／warning 0；完整 e2e 這次只由 CI 執行，本機未重跑。仍只用 dev-only FakeSupabase，沒有真實雲端、真實 Storage 或真機證據。

### 行程刪除確認與回應遺失重試（DP-134，2026-10-06）

DP-133 之後，行程表單的刪除仍是送出即關閉：遠端拒絕時畫面已關，使用者看不到失敗，也失去手上的草稿。依持續自主開發委託，一般刪除、重複「刪除全部」與「只刪這一次」改走 DP-133 的同一個 `confirmWrite` 等待鎖；DataActions 的 deleteEvent／cancelEventOccurrence 與 DP-133 的四支方法一樣回傳既有單一 queue 的確認 Promise，ignored rejection 有 handler，warning／saving／write barrier 分類不變。等待時 fieldset、取消、背景與 window capture Escape 都沿用同一套保護，刪除按鈕顯示「刪除中…」，儲存按鈕不顯示「保存中…」。成功才關閉；失敗保留編輯畫面與所有草稿欄位，提示「尚未確認刪除，草稿已保留；請先確認資料再重試」。重複刪除的重試要重新選範圍，不記住失敗時的選擇；settle／unmount 清理與「舊請求不能關閉新表單」不變。

刪除按鈕在長表單最底部，使用者要捲到底才按得到，而 DP-133 的提示放在表單頂端，browser 驗證實測刪除失敗時提示的 viewport ratio 為 0，畫面看起來只是沒反應。因此刪除失敗的提示改放在刪除按鈕正下方；保存與刪除兩種提示出現時都以 `scrollIntoView({ block: 'nearest' })` 捲入視野，不移動焦點。只有焦點失落到 body 時才回到觸發的按鈕（保存或刪除），不搶其他控制項。

驗證時在未修改的 repository 重現了第二個問題：`delete_event_with_attachment_cleanup` 已提交但回應遺失後，明確重試只會得到 `false`，而 adapter 的 `if (!deleted) return data` 原樣回傳舊 snapshot，於是那筆行程永遠留在畫面與帳號快取，再怎麼重試也刪不掉。RPC 只在「本人擁有的那一列已不存在」時回傳 `false`；snapshot 只由本人資料組成，所以收到任何 boolean 都一律移除該筆（連同其例外、替換列與附件 metadata），並沿既有的附件清理佇列 flush 第一次提交時登記的清理工作。非 boolean 的回應不算確認：adapter 拒絕，保留最後確認的 snapshot／cache。單次取消的 RPC 本來就對照已存的例外列，重試即修復，不需改動。RPC／RLS、刪除語意、schema、Auth、公告與部署均不變，也沒有自動重送。

不在本項：附件刪除 `deleteEventAttachment` 有同型的 `if (!deleted) return data`，回應遺失後同樣會留下幽靈附件，已另列任務；行程表單以外的刪除入口（待辦、貼圖、日曆）仍是不等待的寫法。

驗證：表單關閉與重試留下幽靈 snapshot 兩個回歸在修正前失敗；browser 的回應遺失案例在只還原 repository 修正時也失敗（重試後行程仍在日詳情）。lint、typecheck、build／check:build 與七項 posttest 通過。單元測試 999 個案例／61 檔在 `--testTimeout=30000` 下全數通過；預設 5 秒時，本機負載下 CalendarScreen／App 有數個與本項無關的逾時，未修改的基線同樣逾時，因此不視為本項回歸，以 CI 為準。PowerShell 實際 Intl America/New_York 下三個相關測試檔 132 案例通過。完整 e2e 151 通過／五項既有 desktop 跳過，其中新增六個 mobile／desktop synthetic account 案例覆蓋一般刪除失敗、回應遺失後重試、重複「只刪這一次／刪除全部」失敗後重選範圍，實際 browser timezone America/New_York、display Asia/Taipei、console error／warning 0。dev server 下 375×667 與 390×844 的失敗狀態：提示在刪除按鈕下方 6px、標題列仍可見、只有 sheet body 捲動 40px、焦點回刪除按鈕、無水平溢出；量測時另見 `.cal-sheet-backdrop` 在操作前就有 243px／87px 的捲動範圍，成因未查，不由本項造成也未在本項處理（**2026-10-07 補正：成因已由 DP-136 查出並修正，是附件按鈕的隱藏輸入框，見上方該節**）。仍只用 dev-only FakeSupabase，沒有真實雲端或真機證據。

### 行程表單保存確認（DP-133，2026-10-06）

新增／編輯行程、重複單次／全部及同表單新增待辦，原本送出後立即關閉，遠端拒絕時草稿也消失。依持續自主開發委託，DataActions 的 addEvent／updateEvent／replaceEventOccurrence／addTodo 回傳既有單一 queue 的確認 Promise；保留原本不等待的呼叫方式，ignored rejection 有 handler，但 awaiting caller 仍取得原錯誤，DataProvider 的 warning／saving／write barrier 分類不變。Repository、owner update／RPC、snapshot／cache 成功才更新的邊界不變。

EventSheet 只有確認成功才關閉；等待時 ref 防重複提交，native disabled fieldset 暫停草稿欄位，保存／取消、背景與 Escape 均不能關閉。Escape 在 window capture 暫時攔截，涵蓋 disabled 控制項失焦到 body 的情況，settle／unmount 即移除；原 CalendarScreen 的關閉順序不變。失敗保留日期、時間、時區、日曆、標題、地點、備註與重複選項，顯示可重試提示；重複重試重新選範圍，不記住失敗時的選擇。失焦到 body 才回到保存按鈕，不搶其他控制項；離開畫面或切換帳號後，舊請求不能關閉新的表單。

沒有自動重送；transport 拒絕可能無法確定遠端是否已完成，文案要求先確認資料再重試，不承諾手動重試的新增請求具備 idempotency（**補正：DP-142 起新增以草稿 id 落點，重試不再重複，見上方該節**）。corrupt／future 等 fail-closed 復原仍優先，草稿不阻擋資料邊界卸載。刪除與其他表單不在本項。沿原稿欄位／token，fieldset 保留原 body padding、取消 native border／margin 與 min-width；無 CSS palette、schema、Auth、公告或部署變更。

驗證：修正前等待保存回歸失敗；986 個單元案例／61 檔與七項 posttest 通過，PowerShell 實際 Intl America/New_York 的 87 個相關案例通過。完整 e2e 145 通過／五項既有 desktop 跳過；最後補提示 viewport 斷言的六項再跑全過。dev-only synthetic account 覆蓋 transport／remote error、五種保存、快取逐字保留及明確重試，沒有真實雲端／真機證據。production 390×844、375×667、360×640、1280×900，漫畫淺／深及像素深色，最終 sheet 在 viewport、body 可捲動、padding 12px 14px 18px／border 0、無水平溢出或 console error／warning；375×667 失敗提示 150..184px 在 viewport。原稿新增事件實際渲染同標題／地點／備註並對照，截圖／量測留於本機 %TEMP%/daypop-dp133-qa/，不宣稱未搬的欄位逐像素相同。

### 標題長度與舊遊客資料（DP-125，2026-10-04）

事件與待辦（含子項）的新標題最多 300 個 Unicode code point，與 PostgreSQL `char_length` 一致；emoji 的 surrogate pair 算一字，組合 emoji 與結合符號按實際 code point 計。輸入沿原稿控制項，native `maxLength=600` 只作 UTF-16 外圍上限，真正的 300 字閘門由共用 domain helper、輸入提示／儲存按鈕與 submit guard 執行。超限顯示「標題最多 300 字，請縮短後再儲存」，保留草稿，不截短標題；直接 repository 命令也會在遠端 request 前拒絕，DataProvider 保持 ready 並沿 DP-123 的 refused 提示繼續 queue。

舊遊客 schema v1–v4 的超長標題仍完整可讀，不因此進入 corrupt、裁切或自動改名；讀取 v4 不改原始 bytes，既有 migration 保留完整標題。後續本機寫入只允許同一種類、同一 id 且完全未變的超長標題原樣保留，其他待辦勾選、設定、刪除與合法新增不被阻擋。編輯該標題須先縮到上限；事件其他欄位的 repository patch 可保持原標題，sheet 編輯則提示先縮短。JSON／ICS 匯出保留完整標題，JSON 取代匯入與新 ICS 列嚴格驗證（超長備份須先修正標題才可匯入）；ICS 附加可保留既有超長列。登入快取（含 v3 migration）保持嚴格，不能把遊客相容規則套到帳號。未提升 schema／release、修改 DB 約束或部署。

### 日詳情待辦換日介面（DP-130，2026-10-06）

**DP-132 補正（2026-10-06）：** 兩個日期表單同時開啟時，另一表單取消／Escape 原本只看自己的 pending flag，會在 sheet 的其他日期寫入等待時關閉草稿、嘗試聚焦已停用的觸發鈕。取消按鈕與表單內的 Escape 現在也共用 datePending；該筆保存 settle 前不關閉任何日期草稿，失敗 settle 後恢復原取消／焦點契約，父子草稿、完成狀態與資料均保留。外層 sheet 與其他操作／queue／repository handlers 不變，沒有日期或樣式重設計。

承接已合併的 DP-129，依持續自主開發委託，父待辦與已顯示子項新增「改日期」按鈕與 native date 表單，放在各列下方而不壓縮標題。原稿 :561 沒有換日能力，這是刻意擴充，沿現有卡片、surface／surface-2／fg／muted／border、8px 欄位圓角與 2px accent 焦點，輸入採 16px。日期的 min／max 對齊既有 domain 的 0100–9999 年範圍，不改 validation 或轉成 timed instant。

表單明示「只更改這一項，其他待辦日期不變」。Enter 儲存，同日保存／取消／Escape 不寫入且還原觸發按鈕焦點；Escape 不傳到外層關閉日詳情。空白／無效日期保持草稿並提示修正，沒有清除日期按鈕或無日期管理入口。等待時停用本表單輸入與儲存／取消、防止重複提交；同一日詳情一次只保存一筆日期，其他日期輸入／儲存／觸發鈕暫停，避免父項換日重掛仍在等待的子項表單，其他 mutation 維持原 queue。可恢復失敗保留草稿、提示重試。所有保存仍走 DataProvider 的 awaited rescheduleTodo 與既有單一 queue。

只有 repository 確認成功才移出來源日，日詳情繼續顯示來源日期，不自動跳到目標日。父項換日後，同日子項依既有分組獨立顯示；子項換日也不改父項日期或完成比例以外的其他資料。保存後焦點回到同一日詳情仍存在的「完成」按鈕；若等待時使用者已聚焦其他控制項或開啟另一日期／切換帳號，不搶走焦點。日期、完成、優先度、階層、排序、日曆與分享範圍的持久化契約沿 DP-129，不移動子樹。沒有 schema／RPC、Auth、release 或部署變更，排序與 DP-014 其餘段落仍未結案。

### 待辦換日資料契約（DP-129，2026-10-06）

依持續自主開發委託，先新增 `rescheduleTodo(id, date)`，介面接線由 DP-130 獨立完成。只接受既有 `isDateKey()` 能驗證的日期字串，不接受 null、空白或不存在的日期，也不將日期轉成裝置時區的 instant；DST 日期與 Pacific/Apia 的 2011-12-30 仍是合法日曆日期。沿既有驗證的年份範圍，不在本項擴充 validation。可為已匯入的 null 日期列指定有效日期，但本段不開放清除日期，避免日詳情換日後沒有無日期管理入口。

共用純函式 `rescheduledTodo()` 只更新單列 dueDate／updatedAt，保留 parentId、完成、優先度、排序、日曆、分享範圍、標題與建立時間；父與子不連動，跨日期階層維持 DP-116／121 的既有分組與可見性。不搬整棵子樹，也不重排目標日期的 sortOrder。missing id／invalid date 使用 TodoInputError，沿 refused 保留 ready snapshot 並繼續單一 queue。guest 仍先通過 corrupt／future write barrier，舊超長標題可原樣保留。

authenticated 僅送 `{ due_date }` 的 owner-scoped update／single，不 upsert 已刪除列或傳 client timestamps；成功才更新 snapshot／account cache，遠端 error／transport rejection 皆保留最後確認資料、不自動重送。沒有 schema／RPC、Auth、release 或部署變更；DP-129 是資料前置完成，不能宣稱日詳情已有換日能力或 DP-014 已結案。

### 待辦優先度（DP-128，2026-10-05）

依持續自主開發委託，日詳情的父待辦與已顯示子項新增 native select，對應 canonical `none`／`low`／`medium`／`high`。原稿 :561 沒有選擇器，但 seed／寵物建議已使用 priority 資料；這是刻意擴充，沿既有欄位 surface／fg／border／radius 與 2px accent 焦點，不新增 palette。16px 字級避開手機輸入縮放；不調整排序、日期、完成或父子關係，也不把父優先度套到子項。新待辦維持原先 `none`。

`setTodoPriority()` 與其他 mutation 共用單一 queue。domain `todoWithPriority()` 只更新 priority／updatedAt，不存在的 id 或非法值使用既有 `TodoInputError`，request 前拒絕且不毒化 queue；guest 仍先執行 corrupt／future write barrier，舊超長標題可原樣保留。authenticated 僅發 owner-scoped、priority-only update／single，不能 upsert 已被刪除的列；timestamps 由 DB 生成，成功才更新 snapshot／account cache，失敗不自動重送。

選擇即保存，等待時停用該控制項並拒絕重複提交；畫面顯示最後確認的 priority，失敗保持原值、提示重新選擇。沒有草稿保存／取消模式，不以樂觀值冒充成功。父項的選單與逾期標記上下共用一欄，避免窄螢幕將長標題擠成一字一行；子項／標題編輯／完成操作維持原有語意。未改 schema、Auth、release 或部署，DP-014 的排序與其他段落仍未結案。

### 待辦標題編輯（DP-120，2026-10-04）

依日常使用優先與持續自主開發委託，採用 agent 建議，在日詳情的父待辦與任何已顯示子項加入標題編輯。原稿 :561 沒有此能力；保留既有展開／勾選／刪除意義，增加 24×24 編輯按鈕與 native inline form，沿原稿卡片、欄位與 surface／surface-2／fg／muted／border，輸入採 16px。這是新產品決策，不宣稱逐像素搬移。

共用 `renamedTodo()` 只 trim title／更新 timestamp，保留日期（含 null）、完成、排序、父子關係、日曆、分享範圍與建立時間。guest 仍經 write barrier；account 只送 `{ title }` 的 owner-filtered update／single，不能 upsert 已刪除列，timestamps 由 DB 生成；成功才更新 snapshot／cache，失敗不自動重送。DataProvider 的新 awaited action 與其他寫入共用單一 queue，missing／blank 為既有 `TodoInputError`，拒絕後 queue 繼續。

Enter 保存；空白拒絕，未更改／取消／Escape 不寫入；Escape 不關閉外層日詳情，返回編輯按鈕焦點。保存中禁止重複提交與取消，等成功才關閉；仍掛載的 editor 在可恢復失敗時保留草稿並顯示重試提示。資料 corrupt／future 等 fail-closed 復原仍優先，不以 editor 草稿阻擋復原或帳號切換。只完成標題編輯；日期、優先度、排序與寵物行為仍分開處理，未新增 schema／RPC／release 或部署。

### 待辦刪除一致性（DP-115，2026-10-04）

既有 `todos_parent_owner_calendar_fk` 是 ON DELETE CASCADE；`withoutTodo()` 原本只移除 id 那一列，留下缺失 parent 的子項。回歸確認 guest 因完整文件驗證而拒絕保存（原資料沒有被覆寫），authenticated 則可能在遠端刪除成功後，因 snapshot 驗證失敗而回報錯誤。共用 domain 函式改成清除完整子樹，包含已完成、亂序與多層匯入的後代，保留不相關待辦／其他資料；parent index 加迭代遍歷避免資料量或深度造成遞迴堆疊問題。兩個 adapter 都沿現有 seam；authenticated 仍是一個 owner-scoped delete，由既有 DB FK 原子 cascade，不分別送出多個 delete。遠端拒絕／transport rejection 保留整棵 snapshot，不樂觀移除。測試用 FakeSupabase 獨立模擬既有 composite FK；不修改 schema、RPC、Auth、release 或部署，也不把 harness 證據當成真實 RLS／服務 durability 驗收。先完成這個子項 UI 前置，再開放建立子项。

### 待辦子項操作（DP-116，2026-10-04）

日詳情沿原稿 :561 的卡片／展開／完成比例／細項輸入。父與子完成狀態獨立（原稿 `toggleTodo()`／`toggleSub()` 也是各自保存），勾完子項不自動勾父項；刪除父項則沿 DP-115 清除全部後代。`NewTodoInput.parentId` 為可選的純領域欄位，沿既有 `todos.parent_id` mapping／repository queue；新子項繼承已存在 root 的 calendarId、dueDate 與 sharingScope，sortOrder 依同父的兄弟序列新增。不存在的 parent、對子項繼續新增、不同 calendar 的輸入與 self parent 在任何遠端寫入前拒絕；原始 root 新增契約不變。不新增 DB 欄位／RPC／schema version。

畫面只分組當日 dueDate 的列，按既有 sortOrder 呈現；多層匯入的後代以可捲動子項列表與有限縮排保留，不提供新多層建立。跨日期子項在自己日期以獨立卡片呈現，維持原先可見性；無日期待辦仍沿原有日期篩選，不由此重新安排。遍歷用 visited 防止既有異常 parent cycle 卡住畫面。拖曳排序控制與優先度等後續搬移仍明示，沒有假拖曳把手；列表／綜覽現有逐列統計維持，寵物 XP 屬 DP-041。

接入子項後新增回歸重現「先刪父項、再從尚未重繪的表單排入新增子項」會被 DataProvider 視為致命錯誤。此類輸入拒絕使用獨立 `TodoInputError`，保留 ready snapshot、顯示 write-failed 訊息且 queue 可繼續；不得廣泛吞掉 persisted domain validation 或 storage write barrier 錯誤。

Guest local adapter 與 authenticated Supabase adapter 必須共用同一套 canonical domain contract；不能讓 UI 同時理解本機簡化模型與資料庫模型。

| 領域 | Canonical contract |
| --- | --- |
| Calendar | 所有 event／todo 都有 `calendarId`；guest bootstrap 也會建立穩定的預設本機日曆。 |
| All-day event | 使用 `startDate` 與 inclusive `endDate`；ICS adapter 負責在邊界轉成 exclusive `DTEND`。 |
| Timed event | 保存 ISO instant 的開始／結束時間與 IANA timezone；DB 與 domain 都要求 end 晚於 start。 |
| Todo | 使用 `calendarId`、`dueDate`、完成時間、排序與 sharing scope；不延續 UI 專用的相對日期字串。 |
| Preferences | 包含 timezone、week start、theme、calendar grid mode、reminders 與 pet preferences。 |

執行順序是：先保護現有 v1 storage，再完成 domain／DB mapping 與 runtime validation，最後才建立兩個 repository adapter。第一次升到 schema v2 時必須保留 v1 fixture、migration test 與 future-version test。

### 實作結果（DP-012）

- Canonical event 改為全天／timed discriminated union；全天使用 inclusive `startDate`／`endDate`，timed 使用 ISO instant `startsAt`／`endsAt` 與 IANA `timezone`。Calendar、Recurrence、EventException、Todo、Sticker、Preferences 皆有對應 runtime validation。
- `src/domain/databaseMapping.ts` 是 domain 與 generated Supabase `Row`／`Insert` types 的唯一 mapping；client insert 刻意不帶 `created_at`／`updated_at`。這層只定義 contract，不在 DP-012 接上網路 CRUD。
- 本機 envelope 已升到 schema v2。首次啟動與 v1 migration 都會立即持久化一個 UUID default calendar，避免每次讀取產生不同 ID；v1 的非 UUID event／todo ID 會在一次性 migration 重建為 UUID 並指向該 calendar。v1 fixture、migration 與 future-version 測試持續保留。
- DP-012 當時的 `month_weeks` 暫時相容編碼已由 DP-018 收掉；歷史值 `6` migration 為 fixed-six，`4`／`5` migration 為 adaptive，runtime mapping 不再理解數字列數。
- DP-012 當時只保存 RFC 5545 rule text；DP-027 已在獨立 domain 層補齊 occurrence expansion、DST、single／all exception mutation 與 ICS round-trip。提醒上限、`created_at` hardening 與 DB timezone 受控驗證也已分別由 DP-036／027 完成；mapping 層仍只負責列轉換。

### 實作結果（DP-024）— Account bootstrap 是 DB 單一路徑

- 新帳號由 `auth.users` AFTER INSERT trigger 在 Auth 建立帳號的同一交易內初始化；任何一步失敗都會讓 signup 一起失敗，不會留下只有 profile 或只有 calendar 的半套帳號。`AuthProvider`、`SupabaseDayPopRepository` 與 DP-026 不另做第二條隱含 bootstrap。
- `daypop_private.bootstrap_account(uuid)` 依 canonical domain defaults 建立缺少的 profile、漫畫淺色 preferences 與一個「我的日曆」預設 calendar。它先取得 account-scoped transaction advisory lock，再使用 conflict-safe insert；重試不增加預設資料，既有 profile／preferences／default calendar 也不被覆寫。Migration 套用時以同一 helper 補齊舊帳號。
- `daypop_private` 不在 exposed schema；public／anon／authenticated 都沒有 schema usage 或 function execute。Helper 維持 security invoker，只有不可由 client 呼叫的 auth trigger handler 使用 SECURITY DEFINER，且固定空 `search_path`；handler 只接受受信任 trigger row 的 `new.id`，不是接收 client account id 的 RPC。
- DP-024 只保證帳號資料已可安全初始化。Authenticated adapter 切換、遠端 CRUD、裝置快取與重載仍屬 DP-026；在此之前必須先完成 DP-062 的寫入順序保護。

### 實作結果（DP-062）— Repository mutation 依 UI 呼叫順序序列化

- `DataProvider` 對 screen 維持 fire-and-forget actions，但所有 mutation 共用一條 promise queue；只有上一筆 settled，下一筆才會真正呼叫 active repository。
- 不採「讓 requests 並行、只丟棄 stale response」。`SupabaseDayPopRepository` 以共享 snapshot 產生下一份完整文件；較早 request 若最後才寫入，durable store 本身仍可能倒退，即使 React 畫面忽略它，重新載入仍會看到錯誤順序。序列化同時保護畫面 snapshot 與遠端落地順序。
- 每筆成功或失敗都會消化 queue tail。失敗沿用既有 `failed`／`blocked` 狀態，但不會讓 queue 永久 rejected，也不會阻止使用者在錯誤回來前已送出的下一筆操作。
- DP-062 不提供離線寫入佇列、retry、Realtime 或多裝置 conflict merge；短暫失敗復原與 adapter／cache lifecycle 仍由 DP-026 處理。

### 實作結果（DP-026）— Auth identity 決定 adapter，Supabase 是唯一 durable store

- `SessionDataProvider` 必須等 Supabase Auth 的 initial session 判定完成，才選擇 guest `LocalDayPopRepository` 或 authenticated `CachedSupabaseDayPopRepository`。identity 使用 user id；guest、帳號 A、帳號 B 以 keyed `DataProvider` remount 隔離 React snapshot 與 DP-062 mutation queue，同帳號 token refresh 不重建資料邊界。
- 帳號快取 key 為 `daypop.account-cache.<encoded user id>`，envelope 同時保存 schema version 與 account id，並再次做 canonical runtime validation。它與 `daypop.user-data` 分離，只能由成功的遠端 load／mutation 更新；corrupt、future-version 或 account mismatch 都不得視為空資料、不得跨帳號 fallback，也不得整份上傳 Supabase。
- Supabase load 成功才顯示遠端文件；短暫讀取失敗且同帳號快取有效時可顯示最後確認資料，但必須保持持續警告與手動重新載入。DP-024 已保證 default calendar 與 preferences；缺任一 bootstrap row 是 drift／初始化失敗，不能用舊快取掩蓋或在 browser 建立第二條 bootstrap。
- 遠端 mutation 失敗時保留最後確認 snapshot 並標示「尚未同步」。不自動 replay：request 的 response 可能在 server commit 後才遺失，自動重送可能產生重複 event／todo／sticker。使用者重新載入後以 Supabase 狀態 reconcile；MVP 不加入離線 write queue、Realtime 或多裝置 conflict merge。
- 設定頁的「已同步／同步中／尚未同步」直接來自 repository pending count 與 persistent warning，不再顯示原稿的固定假字串。遊客模式仍明講只保存於本機，登入不會自動上傳既有 guest document；一次性匯入屬 DP-025。

### 決策（DP-056）— 匯入是 tagged transaction，不是泛用 whole-document setter

- Repository 只接受已驗證的 tagged import command：JSON `replace` 帶 portable canonical data，ICS `appendIcs` 只帶本次 events 與 event exceptions。不得增加可任意覆寫整份文件的 setter；append 必須在 commit 當下套到最新 snapshot，不能寫回 preview 時建立的舊 `next`。
- Guest adapter 在 commit 時重讀 versioned envelope、沿用 write barrier、完整驗證後只寫一次。Authenticated adapter 走 `replace_daypop_data(jsonb)`／`append_daypop_ics(jsonb)` 原子 RPC，成功後必須重新 load 遠端 canonical snapshot 才更新 account cache；失敗不寫 cache、不自動重送。
- 兩支 RPC 都是 SECURITY INVOKER、空 `search_path`、只授權 `authenticated`；owner 一律取 `auth.uid()`，payload 不接受 owner 欄位，server 端重做 top-level／row allowlist、必要 key、筆數上限與 DB constraints。JSON replace 取代 portable calendar data／preferences，ICS 只 append events／exceptions。
- 備份不攜帶 attachment binary、object path、signed URL 或 metadata row，只記略過數。JSON replace 若帳號仍有 attachment 或 attendee rows 必須 fail closed；為關閉 count 與 event delete 間的新 child insert predicate gap，RPC 以固定順序取得 `event_attachments`、`event_attendees` 的 table `SHARE` lock。這是罕見匯入期間的刻意粗粒度同步；不得改回只鎖既有 event rows，advisory lock 也只有在所有 direct DML writer 都共同參與時才成立。
- 第 14 檔 migration 由 CLI workflow 套用；39／39 rollback pgTAP、RLS／execute grant、零測試殘留、generated types 與 advisor 0 已驗證。MCP 對同專案 SQL 會序列化，且 `dblink` 需要不可取得的 DB credentials，因此只有「RPC 實際持有 ShareLock」已自動驗證，真正兩連線 interleaving 不得宣稱已通過。

### 實作結果（DP-025）— Legacy 只在邊界轉成 canonical document，一次性寫入保持原子

- `src/legacy/legacyImport.ts` 是 `calpet.v2` 唯一解析邊界。它嚴格驗證舊 calendars／events／todos／stickers／settings，將日期、timezone、recurrence、exception、reminder 與 preferences 轉成 canonical contract，再由 `parseDayPopUserData()` 對「目前帳號資料＋預計匯入資料」做第二次整體驗證；UI 與 repository 不理解 legacy shape。
- 舊 event／todo／sticker ID 不帶入 DB，全部改配 UUID，所以同 collection 的重複 ID 可安全拆開；calendar ID 仍負責 event 關聯，重複或 dangling reference 無法判定時 fail closed。預覽明列各類筆數、重配 ID 數與延後的 invitees／attachments；舊 `aiKey` 不進 payload，也先從 SHA-256 fingerprint source 排除。
- 登入後只透過 `public.import_legacy_daypop(fingerprint, payload)` 做一次性匯入。RPC 先鎖自己的 profile，所有 row insert／preference update 都以 `SECURITY INVOKER` 受既有 owner RLS 與 DB constraints 約束，最後才寫 completion marker；同 fingerprint retry 回傳 `already_imported`，不同 fingerprint 拒絕，任何中途失敗由同一 transaction 完整回滾。
- Authenticated 只取得兩個 marker 欄位的最小 update privilege；profile trigger 另要求 RPC transaction 內、`ON COMMIT DROP` 的 `pg_temp` context 同時匹配 account id 與 fingerprint，直接 REST update 無法偽造 marker。Private guard 不在 exposed schema且不可直接 execute；公開 RPC 固定空 `search_path`，anon 無 execute。
- 原始 `calpet.v2` 在成功、失敗與 retry 後都不修改或刪除，`CALPET_FIRED` 也不碰。這是刻意的可回復策略；日後若要清理，只能另立有明確備份／確認 UX 的任務。附件 upload／metadata／signed URL 仍屬 DP-028，不能由 legacy import 偷帶。
- 第 9 檔先建立 marker／RPC；套用後 advisor 新增對 exposed SECURITY DEFINER 的警告，因此第 10 檔以追加 migration 改成 invoker＋guard，沒有回寫已套用歷史；第 11 檔同樣以追加 migration 修正 pgTAP 發現的 PL/pgSQL `completed_at` 名稱衝突。最終遠端／repo 11 檔一致，24／24 rollback pgTAP、generated types 與 security advisor 0 均通過。

### 實作決策（DP-028）：附件 binary 與 metadata 分離，刪除採 durable compensation

- Canonical domain 只保存 `event_attachments` metadata；binary 固定放在 private `event-attachments` bucket。object path 為 `<owner uuid>/<event uuid>/<attachment uuid>`，不含原始檔名，避免路徑注入、名稱碰撞與檔名外洩。檔名只留在 owner-only metadata 與短效下載回應。
- 上傳只接受明列的圖片、PDF、純文字與 iCalendar MIME，單檔 1 byte–10 MiB；browser 先驗證，bucket 與資料表 constraints 再各自強制一次。SVG、HTML、script 與未辨識 MIME 不接受。
- Storage 與 Postgres 無法共享同一交易，因此每次上傳先建立 `attachment_cleanup_jobs`，再傳 binary，最後由 `SECURITY INVOKER` RPC 在單一 DB transaction 內「消耗 cleanup job＋寫入 metadata」。metadata 驗證或 RLS 失敗時 queue deletion 會回滾，binary 仍可在下次連線清理。
- 刪除附件或事件也先由 `SECURITY INVOKER` RPC 在同一 DB transaction 登記 object path 並刪除 metadata／event，client 成功刪除 Storage object 後才刪 queue row。Storage DELETE policy 必須看得到 orphan cleanup job；metadata 尚存時不可直接刪 object，避免留下指向不存在 binary 的 live row。
- private object 的 SELECT policy 同時要求 owner path，以及同 owner metadata 或 orphan cleanup job：前者供 signed URL 下載，後者讓 Storage API 的 upload response／remove 在補償階段通過。INSERT 另要求 matching cleanup job，DELETE 則只接受 matching cleanup job；前端只建立 60 秒 signed URL，domain／cache 不保存 URL。guest adapter 不提供附件 capability，也不把 binary 塞進 localStorage。
- 第一檔套用後，rollback pgTAP 發現 delete RPC 的 `INSERT ... ON CONFLICT DO NOTHING` 會在 RLS 下要求看見仍被 live metadata 隱藏的 queue row，導致 owner delete 被拒絕。已套用 migration 不回寫；第 13 檔 `20260809085514_fix_attachment_cleanup_enqueue.sql` 以追加 `CREATE OR REPLACE FUNCTION` 移除不必要的 conflict 分支。成功 finalize 會原子消耗 staging job，delete retry 又已無 metadata 可 enqueue，因此不需要 conflict handling。

## 3. 偏好設定語意

### 設定頁分成五組（DP-164，2026-10-15）

原稿的設定是一串同層的小標：外觀主題 → AI 助理 → 我的日曆 → 桌寵 → 一般 → 資料備份。DayPop 在中間與後面加了帳號、資料與隱私、版本與更新、還沒有的功能，結果是九個同等份量的區塊，順序也不好找。

**決策：依審查建議分成「外觀、夥伴、日曆、帳號與資料」，其餘放進「關於」。**

| 組 | 內容 |
| --- | --- |
| 外觀 | 主題卡片、跟隨系統／淺色／深色 |
| 夥伴 | 桌寵卡片（顯示桌寵、寵物名字、說明） |
| 日曆 | 我的日曆；顯示與時區（月曆列數、每週起始日、預設時區） |
| 帳號與資料 | 帳號（登入狀態、舊資料匯入）；資料備份（JSON、.ics）；資料與隱私 |
| 關於 | 版本與更新；還沒有的功能；頁尾說明 |

- 每組是畫面 `<h1>` 之下的 `<h2>`，用標題字體 20px，介於畫面標題（28px）與小標（12px）之間；第二組起上方一條 `--line` 細線。組內各部分沿用原本的小標，只有一個部分的組（外觀、夥伴）不再重複小標。版本卡片的標題因此由 h2 改為 h3。
- 原稿的「一般」三列都和日曆有關，移到「日曆」並改名「顯示與時區」。
- 「新增日曆」按鈕原是 inline-block，它的下邊距不會和下一個小標的上邊距合併，間距是 36px；改成 block 後回到其他區塊的 18px。
- 內容、控制項與 `DataPrivacyCard`／`docs/data-and-privacy.md` 的對照（DP-118）都不變，「資料與隱私」仍在資料備份之後。
- **取捨**：遊客的「登入／註冊」由第三個區塊移到第四組，在 390×844 上往下多約一個畫面。登入入口目前只在設定裡；如果之後覺得太難找，可以另開任務在別處提示遊客模式，不必再改這個順序。

驗證：`SettingsPreferences.test.tsx` 新增一個案例，固定五組的順序、組內的小標，以及主題、寵物名字、時區、帳號、隱私說明與版本卡片各在哪一組；還原時失敗。

### 資料備份顯示「這台裝置上次匯出」（DP-175，2026-10-16）

原稿的資料備份只有兩顆按鈕，看不出上次備份是什麼時候。這是 agent 依任務條目的建議執行，不是專案擁有者逐項定案，PR 審查即是否決點。

**決策：記在裝置上，依遊客／帳號分開。**

- 存在 `AppStorage`，與 `daypop.release-notes-seen` 同類的裝置層級介面狀態：不進 user data、不同步、不在備份裡、不需要 schema。代價是換裝置或清除網站資料後就沒有紀錄，所以文案寫「這台裝置上次匯出」。讀不到、格式不對或 storage 拒絕寫入時一律當成沒有紀錄，不丟錯。
- **遊客與每個帳號各一個 key**（`daypop.last-backup.guest`、`daypop.last-backup.account.<encoded id>`），比照帳號快取。遊客的備份不是登入後那個帳號的備份；共用一個 key 會讓帳號看起來已經備份過。沒有紀錄時，遊客顯示「這台裝置還沒有匯出過備份。」，帳號顯示「這台裝置還沒有匯出過這個帳號的備份。」
- 紀錄只有檔案的 `exportedAt` 與日曆、行程、待辦、貼圖、未含附件的筆數，不存標題或任何內容。畫面顯示時間與「含 N 個日曆、N 筆行程、N 筆待辦、N 張貼圖與設定；不含附件。」（有附件時寫「N 個附件不在備份內。」），讓人自己判斷備份是否太舊。
- 時間依 `preferences.timezone` 顯示（DP-064 的單一來源），格式 `2026/10/16 14:05`。由 `formatToParts` 組字串，因為 `format()` 在日期與時間之間放的分隔字元由引擎的 ICU 決定（Node 是 U+2009 窄空白），各瀏覽器不一定相同。
- **紀錄只在 `downloadJsonBackup()` 裡寫入**，設定的「匯出資料」與錯誤畫面的「下載備份」（DP-143）都經過它，兩處都會被記到，也不可能有一處忘了記。下載丟錯時不記。`.ics` 只有行程，不算備份，不記。
- **「上次匯出」是檔案交給瀏覽器的時間**，頁面看不到使用者之後是否取消了存檔，所以取消的下載也會算進去。這點只寫在程式註解與這裡，畫面不另加說明。
- 隱私說明卡片「登出與刪除」那句加上「上次匯出的時間和筆數」，`docs/data-and-privacy.md` 同步一列。

驗證：`lastBackup.test.ts` 8 個案例（遊客／帳號分開、無效值、storage 失敗、時區與午夜、文案），`SettingsDataTransfer.test.tsx` 3 個（匯出後顯示並在重新掛載後保留、`.ics` 與下載失敗不記、帳號不讀遊客紀錄），三個 e2e 檔各加斷言：遊客匯出與 reload、帳號附件未含、設定壞掉時錯誤畫面的下載也有紀錄。

### 月格標籤只放標題，放不下的算進 +N（DP-165，2026-10-15）

原稿的月格色塊是「時間＋標題」（`.dc.html:1210` 的 `(e.allDay?'':e.start+' ')+e.title`），每格固定畫三個再加「+N」。在 360×640 量到兩個問題：

- 一格約 50px 寬，8.5px 字下時間本身就佔滿，每個色塊都只剩「10:00 ···」，標題一個字都看不到。
- 列高 73px（固定 6 列時 61px）放不下三個色塊加「+N」。格子是 flex 直欄，色塊與農曆有 `overflow: hidden`，於是被壓扁：四件行程的格子色塊剩 9px、農曆 5px；固定 6 列剩 6px／3px。

**決策：月格只負責「哪一天、有幾件、是哪幾件」，完整內容交給日詳情。**

- 色塊只顯示標題。續日保留「續」（DP-064／DP-126），否則看起來像當天才開始。時間留在色塊的 `title`（桌面滑過可見）與排序：全天在前，其餘依開始時間，與原稿的 `dayEvents()` 相同。
- 依實際列高只畫放得下的完整色塊，最多仍是三個，其餘算進「+N」。連一個色塊加「+N」都放不下時只留「+N」，數字優先於標題。底部保留一行貼圖的高度；格內的日期、農曆、色塊與「+N」不再縮小，放不下時只會切掉第二行以後的貼圖（日詳情會列出全部）。
- `src/screens/calendar/monthCellLayout.ts` 的高度是在 Chromium 量到的 calendar.css 自然高度。改 CSS 而沒有跟著改這裡，`e2e/month-cell-fit.spec.ts` 會失敗。
- 390×844 的一般月份（114px）仍是三個加「+1」，與原稿相同。
- **當日清單就是點格子打開的日詳情**（時間範圍、標題、地點、衝突標籤）。月格是連續捲動的，沒有固定的下半部可以放清單，所以不另加。選定日的樣式（`--surface-2` 背景、主色粗體日期）沿用原稿。
- 寵物與 FAB 維持原稿的浮動層，會蓋住最下面一列的部分格子。月格連續捲動，被蓋住的日子往上捲就看得到，所以不加留白。
- 字級、列高、列數偏好與 DP-069 的鍵盤移動都不變。格子的無障礙名稱「日期，N 個行程」也不變。

驗證：`month-cell-fit.spec.ts` 在 360×640（手機專案）與兩個專案的原生尺寸、自動與固定 6 列下，確認色塊與農曆沒被壓扁，日期、農曆、色塊與「+N」都在格子內，色塊數加「+N」等於行程數、色塊裡沒有時間；還原修正時 6 個案例都失敗。另有 `monthCellLayout.test.ts` 4 個與 MonthView 4 個單元案例。

### 月格回到原稿的 1px 線；漫畫深色的細線改灰（DP-166，2026-10-15）

審查認為深色主題的格線太重。量十二組主題 `--line` 對底色的對比，只有漫畫是黑／白線（淺 18.9、深 18.7），其他五套在 1.0–1.5，數字上看不出「深色特別重」。放大截圖才看到原因不在色票：

- **月格每一格是 `<button>`，CSS 只設了右、下兩條 1px 線，沒有把瀏覽器內建的 2px outset 邊框歸零。** 上、左兩邊因此多了一條跟文字同色的線，深色時是白的，每條格線實際約 3px。極簡深色原本設計的淡格線就這樣變成一片粗白格。這是 2026-08-02 搬移日曆骨架時就有的漂移，十二組主題都受影響；全畫面探測，只有月格這一處。
- 修正：`.cal-cell` 先 `border: 0` 再設右、下線。所有主題的月格回到原稿的 1px，每格也寬了 2px。

**決策：漫畫深色的 `line` 由原稿的 `#ffffff` 改為 `#5a5a5a`。** 修好邊框後，1px 白線仍是深色畫面上最亮的東西；改成灰色後，日期與行程更突出。`line` 只用在 1px 細分隔線（月格、週格、列表、卡片內框、設定列），標題列、按鈕與分段控制的粗外框用的是 `border`，仍是白色，漫畫的粗線感保留。對底色約 2.8:1，仍清楚可見。這是繼 DP-070、DP-140 之後又一個刻意偏離原稿的色票，原值註明在定義處；漫畫淺色的黑線不動。

驗證：`e2e/month-grid-lines.spec.ts` 在淺色與深色下確認月格四邊是 0／1／1／0px，且月、週、列表、設定上沒有任何控制項帶著瀏覽器的立體邊框；拿掉歸零時兩種模式都失敗。

### 動效與「減少動態效果」（DP-168，2026-10-15）

視覺改版的第一項。盤點 `src` 下全部 CSS 與會捲動的程式：

| 動效 | 時長 | 減少動態效果 |
| --- | --- | --- |
| 今天格閃爍 `cal-flash` | 1.3 s | 關閉 |
| 寵物眨眼 `cal-pet-blink` | 4.4 s 循環 | 關閉 |
| 日詳情浮起 `cal-fadeup` | 0.26 s | 關閉 |
| 行程表單上滑 `cal-sheet-up` | 0.22 s | 關閉 |
| 範圍、日曆、匯入三個對話框彈出 | 0.24 s | 關閉 |
| 三種開關的滑鈕 | 0.2 s | 關閉（日曆管理的原本漏掉） |
| 三種開關的背景色 | 0.2 s | 保留，顏色變化不是移動 |
| 月曆「今天」與翻頁的平滑捲動 | 瀏覽器 | 改為直接跳到位置 |

**決策：**

- **不改時長，也不新增按壓或完成的慶祝動效。** 時長都來自原稿，落在 0.2–0.26 秒，已在審查建議的範圍；閃爍與眨眼較長是刻意的。新增動效屬於後續寵物互動（DP-169 起）的範圍。
- **移動一律用 `transform`／`opacity`。** 三種開關的滑鈕原本動的是 `left`，改成 `transform: translateX(…)`；開與關的終點位置在瀏覽器量過，與原本完全相同。
- **所有會移動的東西都要在 `prefers-reduced-motion: reduce` 下停掉**，或一開始就寫在 `no-preference` 區塊裡。由程式啟動的捲動用 `smoothScrollBehavior()`（`src/shell/motion.ts`）決定。
- `src/theme/reducedMotion.test.ts` 從磁碟讀所有 CSS 檢查這條規則（Vitest 給測試的 CSS 內容是空字串，`?raw` 也一樣，所以不能用 import）。顏色的 transition 不算移動。

### 偏好設定

- `theme` 保留，目標行為為 `system | light | dark`。實作時要一起處理 CSS、`prefers-color-scheme`、`meta[name=theme-color]` 與 PWA manifest 顏色，不能只保存欄位。
- `month_weeks` 不作為長期模型。它會由明確的二選一設定取代：固定六列或依當月自動顯示 4–6 列；migration 前採用 `fixed_six_week_grid boolean` 作為資料庫名稱，domain 可用語意化 enum 暴露給 UI。
- `pet_enabled` 保留。浮動寵物可以暫時拖走，也必須可以永久關閉。

### 實作結果（DP-018）

- 視覺主題 id 與色彩模式是兩個獨立偏好：`themeId` 保存六套 canonical theme，`theme` 保存 `system | light | dark`。新資料預設為漫畫淺色；既有本機／DB 的 `theme` 值不因 migration 被覆寫。
- `system` 會即時追蹤 `prefers-color-scheme`；解析後的 palette 同步套用 CSS variables、`meta[name="theme-color"]` 與 `color-scheme`。Manifest 的靜態啟動畫面色改為 canonical 漫畫淺色白底，不能假裝追蹤尚未執行 JavaScript 時的個人偏好。
- Domain 使用 `calendarGridMode = adaptive | fixed-six`；DB 使用 `fixed_six_week_grid boolean`。連續捲動月格在 adaptive 模式依目前月份顯示 4–6 列，fixed-six 一律顯示六列。
- 本機 user-data envelope 升到 schema v3；保留 v1 fixture，另新增 v2 fixture，v2→v3 只補上當時不存在的 `themeId = manga`，其餘已保存偏好與 revision／timestamp 原樣保留。future／corrupt write barrier 不變。

### 決策（DP-113，2026-10-04）— DayPop 自有帳號與版本畫面

依持續開發委託採用 agent 建議：帳號、版本、登入、更新提示與版本公告沿用原稿設定卡片、日曆編輯 dialog 與 scope 按鈕的既有 theme token；不再固定紫色骨架 palette，也不新增另一套配色。卡片取 surface／fg／muted／border／bd／radius／shadow，dialog 取 surface／radius-lg 與 font-head／title-ls，欄位取 bg／fg，主操作取 accent／accent-fg、次操作取 surface-2／fg。焦點用 fg 描邊，錯誤與成功訊息維持文字與語意，放在 surface-2／fg 上；不依賴紅／綠顏色辨識結果。既有六主題 palette 完全不改，未宣稱所有原稿 accent 組合符合文字對比規範。

原稿沒有 Auth 或 PWA 更新畫面，本項是自有畫面採用 canonical 控制項，不是逐像素還原不存在的原稿。保留現有資訊架構、文案、Auth／更新操作與較寬的 dialog（登入 440px、更新 480px 上限）；遮罩沿原稿 50% 黑色、留在 App viewport 內，dialog 自身最多佔可用高度並可捲動。短螢幕可觸及關閉按鈕，桌面不得逸出展示框。帳號／版本卡片可換行，長 Email 與公告文字可折行。`accountAndDialogs.css` 只作用於這些自有畫面；移除 `shell.css` 原紫色 bridge，其他舊樣式的清理不併入。本項不改 Auth、儲存、schema、版本、公告內容或部署，DP-014 父項仍有未完成段落。

### 決策（DP-118，2026-10-04）— 設定內的資料與隱私說明

依日常使用優先委託，從 DP-034 拆出使用者可在 App 內閱讀的資料保存／管理說明。原稿沒有這段內容，沿 DP-113 的自有設定區塊規則，放在「資料備份」之後，以現有 canonical 卡片與 native details 展開，預設收合，鍵盤焦點沿現有 summary 規則。文案只陳述 repo 已實作的行為：遊客留在目前瀏覽器、帳號以 Supabase 保存且裝置保留 cache、guest 不自動上傳、未提供家庭分享、附件需登入且下載連結會到期、備份未加密且不含附件、登出不刪除雲端或 device cache、副本需自行管理，以及現有逐筆刪除／日曆刪除會移動內容／尚無一鍵清空或帳號刪除入口。

這是一份目前功能說明，不加入同意勾選、外部導向、分析或追蹤請求；不宣稱正式法律政策、合規、絕對保密或伺服器資料保留期間。沒有刪除資料、清快取或改 Auth 的 handler。DP-034 的完整刪除流程、監控、效能與真機等其餘驗收仍須另做，不能因說明卡片而結案。

### 決策（DP-140，2026-10-07）— 原稿色票的文字對比，小幅調色

專案擁有者同意「小幅調色」：優先處理按鈕文字，保留六套主題風格，必要時才新增 token。開工時沒有只看當初量到的那一個畫面，而是用 `themes.ts` 的色票對六套主題 × 淺／深色全部重算，再在實際畫面上逐一量每段文字對它真正的背景。

**改了七個色票值，主色一個都沒動。** 主色是每套主題的識別，所以當按鈕文字對比不足時，改的是寫在主色上的字，不是主色本身：

| 主題 | 色票 | 原稿 | 調整後 | 原稿對比 → 調整後 |
| --- | --- | --- | --- | --- |
| 暖陽 淺 | `accentFg` | `#fff8f0` | `#1a130d` | 3.73 → 4.68 |
| 鮮活 淺 | `accentFg` | `#ffffff` | `#1a0f08` | 3.12 → 6.04 |
| 像素 淺 | `accentFg` | `#f4f2df` | `#0f120e` | 3.64 → 4.60 |
| 暖陽 淺 | `muted` | `#7a6a58` | `#6f6050` | 最低 4.11 → 4.60 |
| 極簡 淺 | `muted` | `#71717a` | `#6b6b74` | 最低 4.36 → 4.55 |
| 商務 淺 | `muted` | `#5a6b82` | `#58697f` | 最低 4.45 → 4.59 |
| 鮮活 淺 | `todayFg` | `#c23c08` | `#ba3a08` | 4.30 → 4.58 |

- 按鈕字在這三套主題改成深色：淺色字壓在中明度的主色上本來就不可能達標，除非把主色調暗，而那會改變主題的樣子。鮮活與像素直接沿用它們深色模式已經寫在主色上的深色墨水；暖陽深色模式的墨水在淺色主色上只有 4.23，所以再暗一點。
- `muted` 與 `todayFg` 都是原稿色在同一色相上調暗到剛好達標。`muted` 的保證包含它實際會出現的四種背景：`bg`、`surface`、`surface2`，以及週檢視「今天」欄標題所在的 `todayBg`（第一輪計算漏了這一個，實際畫面量測才找到）。
- 不需要新增 token：這三個 token 本來就只有「文字」一種用途（`--accent-fg` 全部 15 處都畫在 `background: var(--accent)` 上）。
- 復原畫面的紅色小標改用既有 `--fg`，紅框保留；`#e4002b` 當 14px 文字在六套主題的深色 surface 上都不足（3.10–3.77）。DP-139 錯誤畫面為了避開它而加的修飾類別因此不再需要，已移除。

`src/theme/textContrast.test.ts` 對十二組釘住上述保證，並把**沒有處理**的部分列成精確的已知例外清單，色票變動讓清單變長或變短都會失敗。實際畫面稽核（390×844，月／週／列表／日詳情／行程表單／搜尋／綜覽／設定，逐段文字對其合成後的真實背景）之後，剩下的 65 組不足全部歸入四類，沒有無法解釋的項目：

- **主色當文字**（9 組，暖陽／鮮活／像素淺色的分頁列、月份標籤、節日）與**寫死的 `#e4002b` 當文字**（10 組，刪除按鈕等）：DP-144。
- **`--faint` 當文字**（34 組，十二組全部都有：主題說明、資料備份說明、頁尾、綜覽計數）與**月格行程色塊上的白字**（12 組，日曆色 `#f06c5c` 上 3.0）：DP-145。

這兩項都是動到多個畫面、或牽涉使用者自選日曆色的設計決定，所以分開，不在這次小幅調色裡處理。

### 決策（DP-144，2026-10-13）— 危險色文字使用獨立 token

依專案擁有者 2026-10-12 核准，先處理固定紅色當文字的部分。`dangerText`／`--danger-text` 專供刪除按鈕、逾期待辦、復原畫面的危險按鈕／錯誤內容與非持久化警告標題。每套主題各有淺／深色值：原稿 `#e4002b` 向黑色（淺色）或白色（深色）混合至四種背景 `bg`／`surface`／`surface2`／`todayBg` 均達 4.5:1，十二組最低 4.503:1。這是用途新增，沒有改動紅色背景／邊框、日曆自選色、主色或既有偏好；按鈕與寫入行為沿用原契約。

`textContrast.test.ts` 將原本紅色文字的精確已知例外改成十二組 × 四種背景的保證；主色文字仍維持已知例外，下一個 PR 處理，不因這一部分完成而結案 DP-144。

### 決策（DP-144，2026-10-13）— 主色當文字時使用 `accentText`

第二個 PR 新增 `accentText`／`--accent-text`：表單文字按鈕、目前分頁、主題勾選、列表今天日期／完成符號、月格週末／選取日／月份與節日文字使用它。`accent` 保留原稿值，仍供按鈕底色、邊框、焦點框與行程裝飾色條使用。新 token 由各主題原主色向黑／白混合到 `bg`／`surface`／`surface2`／`todayBg` 均達 4.5:1；十二組中五組已達標，直接保留原值，其餘七組調整文字色。

這也取代 DP-070 為節日保留不足對比的舊決策：節日仍用主色系且加粗，改為文字專用值。`lunarContrast.test.ts` 同時計算普通、交錯月格（實際透明色合成）、選取與今天背景，十二組節日都達標；`MonthView.test.tsx` 確認節日與一般農曆接到各自 token。主題／模式保存、domain 資料、schema、Auth 與部署沿用原契約；本機 lint、typecheck、1,095 個單元案例、七項 posttest、build／check:build 通過。

### 決策（DP-145，2026-10-13）— 小字與日曆色塊的文字對比

依已核准建議，說明、空白狀態、未選取分頁、時刻軌、位置、副標題、計數與已完成待辦改用已達標的 `muted`，保持字級、版面與刪除線。`faint` 原值保留給裝飾色條／背景與停用的復原按鈕；待辦完成勾選原本的白字改用既有 `accentFg`，讓暖陽／鮮活／像素淺色也可讀。

`calendarTextColor()` 放在 theme 顯示層，以 WCAG 相對亮度比較黑字與白字，取對比較高者；任一不透明 RGB 底色至少有一者達 4.5:1。月格、週格（含全天列）及行程表單的日曆選取標籤共用，十個原稿色盤、預設 `#f06c5c`、缺失日曆的灰色及其他合法六位十六進位自選色均適用。只計算畫面文字色，不寫回日曆，也不動色盤與使用者資料；普通、全天、重複與續日的 domain identity 保持原契約。`textContrast.test.ts` 驗證色盤、預設、黑／白、灰階切換邊界與大小寫自選色，共 17 項；本機 lint、typecheck、1,112 個單元案例、七項 posttest、build／check:build 通過。

## 4. App 內浮動寵物

寵物是 App viewport 內的 floating companion，不是作業系統桌面程式。現有 React `<aside class="pet-helper">` 只是正常文件流中的摘要佔位；未來 DP-040 才會建立浮動層、七個動畫狀態與拖曳。

> **2026-10-17 補正**：上一段寫於 DP-051 之前，已經過期（2026-10-13 審查指出）。DP-051 起日曆頁的寵物就是浮動層 `PetLayer`（`.cal-pet-layer`），`pet-helper` 只剩 `src/styles.css` 的舊樣式。DP-040 已拆成 DP-169–172，見下方 DP-169。

`grab` 狀態保留。拖曳位置只屬於裝置 UI state，不進行家庭分享；位置要限制在 viewport 並避開 safe-area，使用者也能透過 `pet_enabled` 關閉寵物。

### 寵物對話泡泡（DP-169，2026-10-17）

原稿點寵物會跳出漫畫對話泡泡（`:488-530`、`:1138-1157`、`:1307`）。`docs/claude-design-source-of-truth.md` 把原型的對話泡泡列為行為基準，所以照原稿搬，沒有採 2026-10-13 審查提議的「剩餘數＋下一個行程」。這是 agent 依原稿與既有規則的判斷，不是專案擁有者逐項定案，PR 審查即是否決點。

**照原稿的部分**

- 寵物是按鈕，名稱帶「今天還有幾件待辦」；點一下或 Enter／Space 打開泡泡。每次 App 啟動後第一次打開是問候：「嗨，我是{名字}！今天還有 N 件待辦，其中 M 件重要，要一起看看嗎？」，今天清空時改問明天的安排；之後再打開就直接是清單（原稿 `petTap()` 的 `greeted`）。「問候過了」由 `App` 保存，日曆畫面在切換分頁時會卸載，放在那裡問候會每次重來；重新載入才重來，與原稿一樣。
- 清單：今日待辦是今天的（不論完成）加上更早還沒完成的（標「逾期・原M/D」），明日待辦是明天的（不論完成）；可勾選、刪除、新增，今天沒有時顯示「今天清空啦，太棒了！」。只列最上層的待辦（DP-121），和徽章由同一個 `petBubbleTodos()` 計算，兩者不會不一致。順序先依日期再依保存的順序，等於原稿的陣列順序。
- 位置與外觀：距 viewport 左 12px、底 150px、寬 270px，尾巴在寵物頭上；白紙黑字的漫畫泡泡在每個主題、深色也一樣（原稿就寫死這兩色）。點泡泡外面（連分頁列）只會關掉泡泡，不會同時觸發底下的東西；✕ 與 Escape 也關閉。

**刻意偏離，各有理由**

1. **不做啟動 950ms 後自動問候。** 每次開 App 都會先蓋住日曆，也會讓所有 e2e 的第一下點擊被泡泡外的捕捉層吃掉。問候改在當次第一次點寵物時出現。
2. **不放「給我建議」與 AI 模式。** AI 助理還沒有（DP-043）；DayPop 的規則是在設定裡說明還沒有的功能，而不是畫一個按了沒反應的按鈕（DP-014）。問候只剩「看待辦」一顆，佔滿整列。
3. **勾選後不說讚美話、不加 XP。** 原稿的 `petSay()` 綁著等級系統，屬 DP-041；那一項的前置條件是獎勵要在待辦確認保存為完成之後才給，`toggleTodo` 目前對畫面不回傳確認。
4. **文字顏色。** 原稿泡泡裡的待辦標題用主題的 `--fg`。實際渲染原稿量到，漫畫深色時標題是 `rgb(255,255,255)`，泡泡底也是 `#fff`，標題完全看不見；六套主題的深色 `--fg` 都是 `#cfeccb`–`#ffffff` 的淺色，同樣看不見。改用泡泡自己的墨色 `#141414`。已完成的標題（`--faint`，漫畫淺色量到 `#9a9a9a`）、空清單提示（`#999`）與 ×（`#bbb`）對白底只有 1.9–2.9:1，改為 `#666`（5.7:1）。
5. **新增欄位 16px**（原稿 12px）：iOS Safari 對小於 16px 的欄位聚焦時會放大整頁。× 補成 24×24 的點擊範圍，字樣不變。
6. **搜尋點待辦仍打開那一天的日詳情**（原稿 `:1295` 是開泡泡）：原稿的待辦只有「今天／明天」兩種，DayPop 的待辦可以在任何一天，泡泡只列今明兩天，打開泡泡多半看不到搜到的那一筆。
7. **寵物仍只在日曆分頁**（原稿每個分頁都有）。這是 DP-051 起的現況，這次沒有改。

**可及性**：泡泡是 modal，沿用 `useModalFocus`（DP-154）：其餘畫面 inert、Tab 在泡泡內循環、Escape 關閉、焦點回到寵物。問候時焦點在「看待辦」；進入清單時移到「今日待辦」標題；勾掉逾期或刪除讓那一列消失時，焦點移到該區標題，不掉到 `<body>`。新增沿用 `useConfirmedTodoAdd`（DP-137／142）：確認前不清空、失敗保留文字、同一份草稿重試帶同一個 id。axe 的問候畫面只有兩段文字可量（問題與「看待辦」），其餘頁面在透明捕捉層後面，axe 判為無法判定，所以那一次稽核的最低量測數設為 2；清單畫面照常至少 5。

**實作**：`src/domain/petBubble.ts`（清單、計數、問候文字）、`PetLayer.tsx`（按鈕與開關）、`PetBubble.tsx`、`petBubble.css`。泡泡經 `ViewportLayer` 放進 viewport，z-index 55（原稿的捕捉層），所以蓋得住分頁列；位置加回兩側與底部的 safe area，矮螢幕（DP-078 的條件）跟著 50px 的分頁列下移 14px。高度有上限，放不下時清單在泡泡裡捲動。沒有新資料欄位、schema、storage 或 repository 方法，寫入都經既有的 `addTodo`／`toggleTodo`／`deleteTodo`。

**驗證**：`petBubble.test.ts` 9 個（今日含逾期、明日、計數、順序、子項、跨月與兩次夏令時間）、`PetLayer.test.tsx` 15 個（名稱與徽章、問候與「問候過」、清單、勾選與刪除的焦點、兩種新增與失敗重試、標題上限、三種關閉與焦點歸還、inert）、`CalendarScreen.test.tsx` 2 個（關閉桌寵時不畫、經真正的 repository 依顯示時區 `Pacific/Kiritimati` 寫入今天與明天）、`App.test.tsx` 2 處（切換分頁後不再問候；工程用語掃描加入問候與清單）、`e2e/pet-bubble.spec.ts`（位置與尾巴、新增後日詳情與重新載入、點分頁列與月格只關泡泡、鍵盤、375×667 與 932×430 在畫面內並可捲動）與 `accessibility.spec.ts` 的漫畫淺／深色兩個模式。

## 5. PWA 與發布

- 安裝圖示要包含 180×180 Apple touch icon，以及 192×192、512×512 PNG；Safari 26 已支援 SVG Home Screen icon，但為了舊版 iOS 與明確的 `apple-touch-icon` 相容性，SVG 仍只作補充，不取代 PNG fallback。
- 自動版本檢查要節流：定時檢查可維持較長間隔；回到前景或恢復連線的自動檢查，距上次成功／嘗試未滿 5 分鐘時不重送。使用者手動按「檢查更新」永遠可以立即執行。
- release note 在該版本正式部署後視為不可變；後續修正必須使用新版本號與新公告。App release version 與 user-data schema version 持續分開管理。
- 公告要能被看到（DP-090）：service worker 對導覽採網路優先，重新開啟 App 就已經在跑新版，更新對話框只會出現在「舊版仍在執行」的 session。因此每台裝置第一次執行某版時，由 App 自己顯示該版公告一次；「看過哪一版」是裝置層級的介面狀態（`daypop.release-notes-seen`），不寫進 user data、不同步，讀寫失敗只會讓公告多出現一次。手動「檢查更新」一定要有可見結果，自動檢查維持安靜。
- 更新公告是由使用者手上的舊版程式畫出來的（DP-089）：0.3.0（含）以前的對話框不能捲動，只要還可能有人停在那些版本，公告長度就以舊版畫面放得下為準。
- **`version.json` 在讀取的地方驗證，不在畫面上兜底（DP-153，2026-10-14）。** 這個檔是 generator 產生的，但它經網路進到 App，原本只用型別斷言接住。更新提示、版本公告與設定的版本卡片都直接畫它的欄位，所以一個 HTTP 200、`changes` 缺漏或不是字串陣列的回應，會在繪製時丟錯。兩個對話框位在分頁的 error boundary 之外，整個 App 因此被最外層的「日蹦暫時無法啟動」取代。同版本的路徑在啟動時自動觸發，所以還沒看過該版公告的裝置一開啟就會遇到。
  `parseReleaseInfo()` 現在在 fetch 邊界檢查 `version`、`releasedAt`、`title` 為非空字串、`changes` 為字串陣列，並有寬鬆的上限：每段文字 500 字、最多 50 條；目前最長的一版是 11 條、每條最多 53 字。只保留這四個欄位。不合格的回應丟 `ReleaseInfoError`，走所有失敗檢查共用的路徑：自動檢查安靜，設定頁顯示「本次檢查失敗：更新資訊格式不正確」，手動檢查顯示「暫時無法檢查更新」。**不要改成在繪製時以空陣列掩蓋**：那會把壞掉的回應當成一個沒有變更內容的新版本提示更新。
  觸發條件很窄：回應必須是合法 JSON，`version` 是字串且不比目前版本舊。依程式碼判讀，回 HTML 的 captive portal 會在 `response.json()` 失敗，`version` 不是字串會在比較版本時丟錯，這兩種本來就落在失敗路徑。沒有發現線上的 `version.json` 損壞過。驗證：所有已發布的公告與目前的 `version.json` 都通過解析；hook 的 10 個案例（兩條路徑 × 五種格式）與 e2e 的兩個案例在還原修正後都失敗，e2e 失敗時畫面就是最外層錯誤畫面。

## 6. 資料庫與日期邊界

### 週檢視的三日模式（DP-167，2026-10-15）

七欄各 60px 要 456px（含 36px 時間軸），390px 的手機只能橫向捲動，閱讀與拖曳都吃力。原稿沒有三日檢視，這是新增的模式。

**決策（依任務的建議與 agent 的建議）：**

- **入口**：週格左上角、時間軸上方的「3日」按鈕（`aria-pressed`，無障礙名稱「3日檢視」），開啟時填滿主色。它是週檢視的一個模式，所以不在原稿的月／週／列表控制項上加第四個選項。缺點是 7 欄橫向捲到右邊時它會跟著捲走，捲回來就看得到。
- **範圍**：從 cursor 起三天，不對齊週起始日。從週檢視進入時 cursor 就是今天（或搜尋／綜覽帶來的那天），所以是「今天起三天」。‹ › 一次移動三天，「今天」把今天放在第一欄；關掉時回到 cursor 所在的那一週。標題顯示「8/12 – 8/14」。
- **行為與週檢視相同**：同一個 `WeekView`，只把可見範圍換成三天。拖曳與拉長度、跨午夜片段（DP-064／DP-072）、全天列（DP-114）、現在線與動態時刻軌都照舊，只是限在畫面上的三天；拖曳超過最後一欄會停在最後一欄，和週檢視停在週六一樣。三欄平分寬度，畫面不再橫向捲動。
- **橫向拖曳的欄寬**：週的欄寬固定 60px，三日的欄寬是量到的，`columnShift()` 因此改收欄寬與欄數（預設值維持週檢視的行為）。
- **不保存**：和月／週／列表的選擇一樣是畫面狀態，重新開啟回到七天。不新增 preferences 欄位或 migration；要不要記住，等兩種檢視的選擇一起決定。

驗證：WeekView 4 個單元案例（三欄與查詢範圍、全天與跨午夜限在三天內、以量到的欄寬換算拖曳日期並夾在最後一天、按鈕狀態），CalendarScreen 2 個（標題、上下頁、關掉回到週、今天），`timeGrid` 1 個。e2e `three-day-week.spec.ts` 在手機與桌面確認三欄與標題、全天列對齊且不橫向捲動、全天／跨午夜／現在線、上下頁與今天，以及用實際欄寬拖一欄會存成隔天；實際瀏覽器時區印出為 Asia/Taipei。

### 四位年份的日期序列化（DP-151，2026-10-13）

Canonical date key 已接受 `0100-01-01` 至 `9999-12-31`，但 `toDateKey()` 與 `instantDateInZone()` 原本直接插入數字年份，將 `0100`／`0999` 輸出成三位數。這不符合 YYYY-MM-DD，匯入的有效行程在 EventSheet 的 native date 欄位會變成空白。兩個輸出邊界改為將年份補滿四位，不裁切較長值、不放寬 `isDateKey()`，也不將 0–99 年納入支援。十個新案例核對兩端年份、0999／1000 跨年、own／display 日期與既有行程表單的預填／保存；六個案例在修正前失敗，包括實際空白的 input.value。這只是已有保存契約的格式修正，不改 schema、日期／時區語意、資料 migration、Auth、版號／公告或樣式。

- 全天事件在 DayPop domain／DB 使用 inclusive `end_date`；ICS import/export 在 adapter 邊界轉換 exclusive `DTEND`。
- IANA timezone 由 domain validation 與可測的資料庫 trigger／受控寫入邊界驗證，不使用直接查詢 `pg_timezone_names` 的 CHECK，因為該資料來源不適合 immutable CHECK expression。
- `reminder_minutes` 與 `default_reminder_minutes` 要限制元素數量、非負範圍與可接受上限。
- `created_at` 應由資料庫／repository 控制，public client 不應能任意偽造。
- UI 的 23:xx 行程必須正確跨到次日，不能只把小時 `% 24` 後留下同一天日期。

以上 invariant 必須在 account CRUD 接線前完成 migration、generated types 與測試。

DP-012 已完成 domain 的日期／instant／IANA timezone validation、inclusive 全天邊界與 generated DB mapping；既有 DB 的全天／timed shape constraint 也已有對應測試資料。Reminder array 上限與 `created_at` 防偽已由 DP-036 完成，DB timezone 受控驗證由 DP-027 完成。上述 account CRUD 前置 invariant 現在已就位；實際 bootstrap 與遠端持久化仍分別依 DP-024／026 驗證。

### 實作結果（DP-063）— 牆上時間位移一律以日曆日重算，不用固定毫秒

上面「23:xx 行程必須正確跨到次日」的 invariant，實作上還有一個更嚴格的條件：**跨日順延必須在目標日期上重新解析同一個牆上時鐘，不能對 instant 加固定的 24 小時。** DST 當晚的本地日是 23 或 25 小時，固定位移會落在錯誤的牆上時鐘 — 實測 America/New_York 2026-03-08 的 23:00–00:30 被存成 23:00–01:30，90 分鐘變成 150 分鐘。

- `src/domain/eventTime.ts` 的 `timedEventFromWallTime()` 是這個規則的唯一實作點，回歸測試在 `src/domain/eventTime.test.ts`。
- `src/domain/date.ts` 的 `daysBetween()`／`weeksBetween()` 以 `Math.round` 取整，同樣是為了讓 23／25 小時的一天仍然算一天。
- 例外只有 `src/storage/localDataMigration.ts`：v1 資料固定錨在無 DST 的 `+08:00`，每一天都剛好 24 小時，因此保留固定位移並在原地註明原因。
- **DP-027 的 recurrence occurrence 已套用同一條規則**：「隔天的同一個時間」是日曆運算，不是加 86400000 毫秒；每日／每週／每月重複跨越 DST 時會維持牆上時鐘，春季快轉中不存在的 local start 依 RFC 略過。
- 全天事件的 `endDate` 是 inclusive 且可以晚於 `startDate`，因此任何編輯都必須讓兩端一起移動（DP-063 修正 `applyEventPatch()`）。DP-026 從 `events` 讀回的多日全天事件就是這個形狀。

### 實作結果（DP-036）— 提醒與時間戳由 domain／DB 雙層保護

- 原稿自訂提醒會把數值 clamp 在 10080 分鐘（七天）；canonical domain 與 DB 因此統一採每個值 `0..10080`，每個陣列最多 10 項且不可含 `null`。這同時套用 `events.reminder_minutes` 與 `user_preferences.default_reminder_minutes`。
- `public.set_updated_at()` 保留既有名稱與九個 UPDATE trigger，新增九個 INSERT trigger。INSERT 一律以 `statement_timestamp()` 覆寫 `created_at`／`updated_at`；UPDATE 保留 `old.created_at` 並刷新 `updated_at`。Function 維持 security invoker、固定空 `search_path`，並撤銷 `public`／`anon`／`authenticated` 的直接 execute。
- Repository 的 domain → DB insert mapping 原本就刻意不送 `created_at`／`updated_at`；DB trigger 是阻擋繞過 repository 的第二道邊界，不取代 mapping contract。
- 23:xx 新增行程沿用 DP-063 的 `timedEventFromWallTime()`，DP-036 再從 `createEventFromInput()` 驗證 UTC 23:30–00:30 會保存為隔日結束。DB 的 `events_time_shape` 繼續保證 `ends_at > starts_at`。
- 第六檔 migration 已以 CLI workflow 套用；遠端 generated types 與 repo 相同（constraint／trigger 不改變列型別）。Rollback pgTAP、12 項會丟錯的 transactional assertions、RLS 與 security advisor 均通過。

### 實作結果（DP-027）— Recurrence 使用日曆欄位展開，timezone 在 domain／DB 雙邊界驗證

- Canonical recurrence 欄位只保存 RFC 5545 RECUR value，不混入 `RRULE:`、`DTSTART` 或 `TZID`。`src/domain/recurrence.ts` 以精確固定的 `rrule@2.8.1` parse 規則，拒絕 duplicate part、無效 `COUNT`／`UNTIL` 組合與 all-day 不相容時間欄位；單一查詢 window 超過 10,000 occurrences 時 fail closed，不靜默截斷。
- RRule 只在 floating UTC frame 產生日曆欄位；timed occurrence 再逐筆以 event 的 IANA timezone 經 `wallTimeToInstant()` 解析。因此 daily／weekly／monthly 規則不靠固定毫秒位移，跨 DST 保持牆上時間；不存在的 local start 略過。Timed `UNTIL` 是真 UTC instant，必須在 wall-time 解析後比較。
- EventException 以原 occurrence identity 表示單次取消或指向 non-recurring replacement；重複編輯同一次會重用 exception／replacement id。更新或刪除 base event 是「全部」操作，刪除 series 同時清掉 exception 與 replacement，避免 orphan。
- `src/domain/ics.ts` 是純 adapter，不負責檔案 IO 或匯入合併。DayPop all-day inclusive `endDate` 在 export 轉為 exclusive `DTEND`、import 再轉回；timed event 保存 TZID，single cancel／replacement 分別對應 EXDATE／RECURRENCE-ID，並實作 UTF-8 75-octet folding。DP-056 已在 `dataTransfer.ts`／browser IO／repository RPC 邊界完成檔案選擇、preview、duplicate handling 與 all-or-nothing merge；不得把 `Blob`／`FileReader` 反向塞進此純 adapter。
- 第七檔 migration `20260808100626_validate_event_timezones.sql` 在 `user_preferences.timezone` 與 `events.timezone` 的 INSERT／UPDATE 邊界查詢 `pg_timezone_names`；不建立錯誤的 immutable CHECK。Trigger function 是 security invoker、固定空 `search_path`，且撤銷 public／anon／authenticated 直接 execute。Migration 由 CLI workflow 套用；24 項 rollback pgTAP、9 張 public tables RLS、generated types 與 security advisor 均通過。
- 事件 sheet 的 recurrence／timezone 控制項、畫面 occurrence wiring 與 single／all scope dialog 是 DP-014 的 UI 搬移，不在 domain task 內自行改設計。跨午夜事件如何跨兩日呈現在月格／週格仍是 DP-064，不能因 occurrence engine 完成就暗自決定。

### 決策（DP-064，2026-08-14）— 跨午夜行程：instant 判斷衝突，本地午夜切顯示片段

原稿只存 `HH:MM` 字串，永遠遇不到跨午夜；DayPop 存 instant，所以三個檢視都用同日 `HH:MM` 比較是錯的。這不是「還原原稿」而是新的產品決策，由專案擁有者於 2026-08-14 定案如下。**未實作前不要各檢視各改各的。**

#### 規則

1. **衝突偵測改用 instant 的半開區間 `[start, end)`。** 兩個 occurrence 重疊的條件是 `a.start < b.end && b.start < a.end`，比較的是 instant 而不是當日分鐘數。`00:30` 結束與另一事件 `00:30` 開始**不算**衝突。這順帶修正了兩個不同 timezone 的事件互比 wall clock 的問題。
2. **日／週／月的呈現，依畫面使用的時區在本地午夜切成 display segments。** 23:00–00:30 顯示為第一天 `23:00 → 24:00`、第二天 `00:00 → 00:30`，第二天的片段標示「續」。
3. **不得真的拆成兩筆 domain event。** display segment 只是同一個 occurrence 的兩個顯示片段，必須帶著原 occurrence 的 identity；repository、`events` 資料表與 ICS 匯出都不受影響。
4. **月格也要顯示 continuation。** 一個 23:00–隔天 14:00 的事件若只出現在第一天，隔天整個上午都看不到它，比計數不準更誤導。
5. **綜覽的「共 N 筆」以 occurrence ID 去重**，不可把兩個顯示片段計成兩筆。
6. **週檢視目前固定 07:00–22:00（`GRID_START_HOUR`／`GRID_END_HOUR`）**；該週有落在範圍外的事件時要**動態延伸顯示時段**。不可沿用原檔 `if(h<20)h=20` 的夾擠，也不可把 23:00 夾到 22:00 —— 那會畫出錯誤的時間。

#### 7. Display timezone 的唯一來源

「依畫面使用的時區」在現況其實有三個候選，必須先定死，否則片段落在哪一天、午夜在哪裡、now line 位置、拖曳後怎麼寫回都會各自解讀：

| 候選 | 目前用在哪 |
| --- | --- |
| `event.timezone` | `eventTime.ts` 的 `eventDate()`／`eventStartTime()`／`eventEndTime()` |
| `preferences.timezone` | 目前主要是新增事件的預設值 |
| 瀏覽器／裝置時區 | `todayKey`、週格的 now line |

**定案：display timezone = `preferences.timezone`。**

`UserPreferences.timezone` 是必填欄位，`validateDayPopUserData()` 會經 `validateTimezone()` 拒絕缺少或不支援的值，guest corrupt envelope 與 account cache 也依 §1 fail closed，DB 另有 timezone trigger。因此**顯示層不得在遇到無效值時靜默改用裝置時區** —— 那會掩蓋 canonical data 損壞，並讓事件落到不同的日格。已載入的 `DayPopUserData` 一律以 `preferences.timezone` 為準，無效是 fail-closed 條件，由既有閘門處理。

裝置時區只用於**尚未有 canonical preferences 的生命週期**（bootstrap 前、資料載入前的首屏）；一旦 `DayPopUserData` 載入，這個 fallback 即失效。

**跨午夜與前景恢復（DP-150，2026-10-13）：** 日曆與綜覽原本只在其他操作觸發 render 時重新讀「今天」，App 停在畫面上跨午夜時，日期標頭、高亮與待辦逾期會留在昨天。共用 `useTodayKey(preferences.timezone)` 透過 `useSyncExternalStore` 訂閱裝置時鐘：每 60 秒檢查、window focus 與 document 回到 visible 時立即檢查。snapshot 是顯示時區的日期字串，同日檢查不造成重畫，偏好時區變動立即重新計算；卸載時清掉 timer 與 listeners。瀏覽 cursor／selected day、展開狀態與表單草稿都不隨時鐘移動，只有使用者按「今天」才導航。這是 DP-064 已定義日期來源的刷新修正，不改日期／timezone 契約、UI 樣式、repository、schema、Auth 或公告。前景定時刷新最多延遲一分鐘；背景 timer 可能受瀏覽器節流，依 focus／visibility 恢復，不宣稱背景持續執行或可靠提醒（DP-042）。

回歸涵蓋午夜無操作、前景恢復、修改 display timezone、同日不重畫及卸載清理；日曆保留原日期／草稿／durable bytes，綜覽保留瀏覽期間並更新逾期。Playwright 在 390×844／1280×900、實際 browser timezone America/New_York 與 display Asia/Taipei 實跑，經 Taipei 午夜時裝置仍是前一天；日期高亮、兩次午夜的逾期、輸入焦點與資料逐字保留均有斷言。沒有真實背景休眠、iOS／Android 或 staging 證據。

它是**唯一**決定下列事情的時區：

- occurrence 落在哪一個日格
- display segment 在哪裡切（本地午夜）
- 週格的時刻軌、now line 與拖曳座標換算
- 綜覽的分組日期

**事件自身的 `timezone` 仍然保留為資料**，而「用哪個時區把使用者的輸入解析成 instant」要看操作種類 —— 這兩者不能混為一談：

| 操作 | 使用者實際指定的是 | 解析基準 | `event.timezone` |
| --- | --- | --- | --- |
| 事件 sheet 改日期／時間 | 該事件自己的牆上時間 | **`event.timezone`** | 不變 |
| 週格拖曳、拉長度、跨欄換日 | 格線上的**顯示座標** | **display timezone** | 不變 |
| 事件 sheet **明確更換時區** | 新選定的時區＋同一個牆上時間 | 新選定的 timezone | **更新為新值** |

**DP-064 的顯示切片與週格拖曳不得暗自改寫 `event.timezone`。** 這條只約束本決策涉及的路徑；使用者在事件 sheet 明確更換時區時，仍依既有的 `EventPatch.timezone` contract（`mutations.ts`：「Reanchors the same wall time in a different IANA timezone」）更新並重新錨定 —— 該控制項屬 DP-014，本決策不封死它。

拖曳 commit 的規則：把拖曳後的 display wall coordinate 依 display timezone 解析成 instant，`event.timezone` 欄位不變。事件 sheet 之後顯示的是換算後的 event-local 時間，這是正確結果。

> 反例（為什麼不能用 `event.timezone` 解析拖曳結果）：紐約 09:00 的事件在台北 display timezone 顯示為 21:00。使用者往下拖一小時到 22:00，若把 22:00 當成紐約牆上時間解析，事件不是移動一小時，而是跳了十幾個小時。

也**不可改用「對 instant 加固定 delta」**代替：跨 DST 轉換時兩者結果不同，而使用者拖到的是格線上的牆上時間位置，因此必須以 display wall time 為準（沿用本節 DP-063 「跨日一律以日曆日重算」的同一條原則）。跨日／跨欄拖曳沿 **display calendar** 的日界計算。

當事件的 timezone 與 display timezone 不同時，sheet 應標示它屬於哪個時區（UI 由 DP-014 負責，這裡只定語意）。

> ⚠️ **這會改變現況。** 目前 `eventDate()` 以事件自己的 timezone 決定日期，所以跨時區事件現在落在「它自己那個時區的那一天」。改用單一 display timezone 後，它會落在使用者日曆的那一天 —— 這才是一個日曆格線該有的行為（一格只能屬於一個時區），但屬於本決策新增的定義，實作時要有對應的回歸測試，並在 PR 說明中明講。

#### 8. Occurrence identity 用哪一個 key

「共 N 筆」與 display segment 的 identity **沿用 `ResolvedEventOccurrence.key`**（`recurrence.ts`，形式為 `${sourceEventId}:${occurrenceKey(occurrence)}`）。它由 source event 加上原 occurrence 組成，replacement 也維持原 occurrence 的 identity，因此是穩定且唯一的。

`EventOccurrence` 本身沒有 `id`，**不可改用 `event.id` 去重** —— 那會把同一個 recurring series 的不同 occurrence 錯誤合併成一筆。

#### 9. 週格動態範圍的推導規則

必須是可測試的公式，而不是「有就延伸」：

- **基線維持 07:00–22:00**，任何一週都不會比它更窄。
- 由**當週的 display segments**（切片後、非全天）推導：
  `start = min(7, floor(最早片段的起始小時))`、`end = max(22, ceil(最晚片段的結束小時))`。
- 結果 **clamp 在 0–24**。
- 片段結束在本地午夜時，在**第一天**表示為 `24:00`（分鐘數 1440），不是隔天的 `00:00`；隔天的續段從 `00:00` 起算。

#### 落點

- **切片邏輯放在 domain**（預期為 `src/domain/displaySegments.ts`），與 `eventTime.ts`／`recurrence.ts` 同層，三個檢視共用同一份。切片以本地日界計算，沿用 §6「跨日一律以日曆日重算」的規則 —— DST 當天的一日不是 86400000 毫秒。
- **衝突偵測目前有兩份實作**：`MonthView.tsx` 的 `hasOverlap()` 與 `DayDetailSheet.tsx` 的 `overlappingIds()`，兩者都用 `minutes()` 比較同日時鐘字串。改用 instant 後應收斂成 domain 的單一函式，不要在兩處各自改。
- **週檢視**的 `src/domain/timeGrid.ts` 把 `GRID_START_HOUR`／`GRID_END_HOUR` 當模組常數。**真正依賴它們、必須改成接受該週推導起訖的只有四處**：`blockGeometry()`、`GRID_HEIGHT`、`hourRail()`、`nowLineTop()`。漏掉任何一個都會讓時刻軌、now line 或色塊互相對不上。既有的 20px 最小高度只可用於「真的很短的事件」，**不可用來掩蓋負高度**。
  - **拖曳的三個函式不需要改**：`snapMinutes()` 只用 `HOUR_HEIGHT` 換算垂直位移，`moveRange()`／`resizeRange()` 只處理 0–1440 的日內邊界，`columnShift()` 只用欄寬做水平移動 —— 它們都不依賴起訖小時。不要為了這個任務去動它們的簽章。
  - > **20px 最小高度的套用順序（2026-08-16，實作者判斷）**：原檔 `buildWeek()` 是 `if(h<20)h=20; if(top<0){ h+=top; top=0; }` —— 先套下限、後裁切，所以裁切會從已是下限的高度再減一次。整塊被裁到軌上方時（拖曳預覽做得到，`moveRange()` 夾的是日內而非軌內）會算出負高度：`blockGeometry(0, 30, {7,22})` 得 `-286`。本節既然禁止負高度，DayPop 的 `blockGeometry()` 就**改為先裁切、後套下限** —— 這是刻意偏離原稿，已記在 `docs/prototype-behavior-baseline.md`。實測原檔那個順序的症狀是：瀏覽器把 `height:-286px` 當無效值忽略，元素保留上一個有效值，**預覽因此凍在最後一次算得出正值的高度並停止跟隨指標**，不是塌掉。一般情形不受影響（06:00–08:00 於 07:00 軌仍是 top 0、height 44）。這裡的 20px 是用在「可見高度真的為零」的幾何情形，本節禁止的是拿它去掩蓋**時間資料**造成的負長度，那一種已由 `eventDisplaySegments()` 保證 `endMinutes >= startMinutes`。
  - > **實作時發現的後果（2026-08-16，這一條是實作者的判斷，不是擁有者定案）**：上一句的「只處理 0–1440 的日內邊界」正好說明**跨午夜的 occurrence 無法用現行拖曳模型表示**。一次拖曳送出的是單一天的 `date`＋`start`／`end` 牆上時間，而 `moveRange()` 會把區間夾在同一天內；把它套到 23:00–00:30 的第一段，送出的 patch 會把事件截成 60 分鐘，等於靜默刪掉使用者的資料。因此**跨午夜事件的每一個片段都不提供拖曳與拉長度**，點擊改為開啟事件（單日事件的拖曳行為完全不變）。要真的支援跨午夜拖曳需要新的 patch 形狀（以 instant delta 或起訖各自帶日期），已登記為 **DP-072**，不在 DP-064 內。
  - 需要新增的是**拖曳 commit 的呼叫端**：把拖曳後的 display wall coordinate 依 display timezone 轉回 instant（見上面第 7 點）。
- **綜覽**的 `src/domain/overview.ts` 以 `items.length` 累計；改為依 `ResolvedEventOccurrence.key` 去重後，`count` 與逐日列表的關係要一併說明（一筆跨日事件在兩天各出現一次，但總數只加一）。

#### 不在此決策內

- 全天事件的呈現不變（原稿的週檢視本來就不顯示全天事件，見 DP-015 的說明）。
- 跨午夜的**提醒**時間點屬 DP-042。
- 這條決策不改變資料模型：`events` 仍是單一 instant 區間，不新增「片段」資料表或欄位。

### 決策（DP-114，2026-10-04）— 週檢視顯示全天事件

依專案擁有者「可開始日常使用優先、持續開 PR／自行合併」委託，採 agent 建議在週檢視日期欄頭下方加入全天列。這是刻意擴充原稿（原稿略過全天事件），避免當週安排消失；上方 DP-064「全天呈現不變」只描述當時範圍，現由本決策補充。七欄保持 60px、時刻軌 36px，沿用日曆色塊／canonical token；沒有全天事件時不佔額外空間。有事件時逐欄列出所有項目、不以固定高度隱藏，沿週 pane 捲動。多日事件使用 inclusive startDate/endDate，在每個佔用日出現，後續日標「續」，不拆 domain event。全部資料仍由週 window 的既有 occurrence resolver（含日曆可見性、取消及 replacement）取得，點擊／Enter／Space 開啟具體 occurrence 並沿既有單次／全部編輯流程。全天日期沒有 timezone，不套 timed display segment／instant 換日；全天列不參與時刻軌範圍、now line、拖曳或 resize。沒有 schema／repository／release／部署變更。

### 呈現補齊（DP-126，2026-10-05）— 多日全天行程跨檢視一致

DP-114 的週列已呈現 inclusive 多日全天行程，但月曆、列表、日詳情與綜覽仍只將它放在起始日，導致當天正在進行的行程消失。依持續自主開發委託，將相同規則補到這四處；這是原稿單日期全天模型的刻意擴充，不宣稱還原原稿。沿用既有卡片、色塊與「續」標記，不新增控制項或樣式。

`allDayDisplaySegments()` 是五處共用的日期邊界：按 inclusive startDate/endDate 與畫面 window 先裁切兩端，再逐日展開；後續日期標「續」。沒有 timezone 或 timed instant，UTC 欄位僅作日曆算術框架，不以裝置的本地日界跨日；工作量限於畫面可見範圍，不從一個多年事件的起點走到今天。保留 resolver 的取消／替換與日曆可見性結果。

續日點擊仍交出完整 resolved occurrence，日期是該次起始日；單次取消／替換作用於整個 occurrence，不是拆掉被點到的一天。月格仍開日詳情，週／列表／日詳情仍走既有單次／全部 scope；綜覽仍以系列入口編輯，不改其範圍語意。所有顯示列保留 occurrence key，綜覽各月計數與跨月總數沿既有去重規則，同一 occurrence 可在兩個月出現但年總數只計一次。沒有 schema、repository、release 或部署變更。

### 日期範圍編輯（DP-127，2026-10-05）— 全天行程的結束日期

依持續自主開發委託，接續 DP-126，在事件 sheet 的全天模式補上 native 結束日期欄位。原稿 :588 只有一個日期，這是刻意擴充；沿既有 `.cal-field`／`.cal-field-note` 與 alert token，不新增 CSS 或改動 timed／待辦的欄位。開始日期保留既有「日期」accessible name，畫面標明開始／結束；說明包含結束當天。有效的開始日期變更會讓結束日期跟著移動，明確改結束日期才改變跨度；空白、倒置、無效或超出 canonical 四位年份的範圍拒絕保存並保留草稿。取消沿原有關閉流程不寫入。

`NewEventInput.endDate` 與 `EventPatch.endDate` 是可選的純領域欄位，只適用全天。新建省略時仍是一日；patch 省略時保留原跨度，明確指定時採 inclusive 結束日期。timed event 不能夾帶此欄位，`timedInterval` 也保持互斥。`allDayDates.ts` 的 UTC 欄位只作無時區日期算術，移動不依裝置午夜或 DST；命令輸入錯誤以 `AllDayInputError` 在 request 前拒絕，DataProvider 沿 refused 保留 snapshot／warning 並繼續 queue，資料毀損與 future barrier 仍優先。

重複事件的單次編輯保存該 occurrence 的完整範圍；全部編輯先按該次的開始日位移平移系列錨點，再將明確的新跨度套到錨點，不能把後面那次的結束日期複製到系列。若平移後超出可保存範圍，關閉範圍詢問並留在表單讓使用者調整，尚未寫入。兩種 adapter 沿既有 all-day start/end mapping 與 occurrence RPC 保存，沒有 DB schema／RPC signature、release、Auth 或部署變更；帳號瀏覽器驗證仍為 FakeSupabase，不等於真實雲端、真機或 staging 驗收。

### 決策（DP-083，2026-10-03）— 重複週格拖曳沿用單次／全部選擇

專案擁有者委託 agent 對未定事項提出建議並直接執行，再以 PR 自行合併。採 DP-083 的 (b)：單日重複 occurrence 在週格可拖曳、跨欄換日與拉長度，放開後沿用事件 sheet 的「只改這一次／套用全部／取消」對話框。這是刻意偏離原稿 `wkUp()` 不詢問便拆成獨立事件的行為，目的為讓同一系列在兩個入口的修改範圍一致；決策可由後續 PR 修訂。

- 放開時只保存待確認 patch；選範圍以前不呼叫 repository。取消／Escape 回到原色塊、恢復焦點且不寫入。對話框 Tab／Shift+Tab 維持在三個按鈕內。
- 「只改這一次」透過既有 `replaceEventOccurrence()` 建立 replacement 與 exception；已拆出的 replacement 是獨立事件，之後拖曳不再詢問。
- 「套用全部」先按本節 DP-064 以 display timezone 解析**具體 occurrence** 的格線座標，再換算成事件自己的牆上時間。新起訖時鐘套到系列，日期則依該次在事件時區移動的日數平移系列錨點，不能直接把被拖那次的日期拷到錨點。先解析後換算同時處理「錨點在冬季、該次在夏季」的 DST 偏移，不用固定 instant delta，也不改 `event.timezone`。
- 非重複事件沿用直接寫入。跨午夜片段仍不提供拖曳與拉長度（DP-072）；iPhone 真機拖曳回饋的 DP-077 仍未驗證或結案。

### 決策（DP-075，2026-10-03）— 快速新增支援常用中文時刻

專案擁有者授權 agent 對未定事項給建議並直接執行。快速新增在原稿 ASCII 時刻語法上加入一般中文數字時分（零／〇、一到九、十到五十九、兩／两）、全形數字，以及「點／時」後的半／一刻／三刻。這是新的產品決策，並非修復搬移失真；仍先交給既有事件 sheet 確認，儲存前不寫入。

- 小時只接受 0–23、分鐘只接受 0–59；不從過長或無效數字中截取合法尾段。只正規化被辨識的時間 token，標題與地點的數字保持原樣。時間後以空白分隔的數字標題（例如「三點 三個願望」）不當成分鐘；要指定這種分鐘可寫「三點 三十分」。
- 相對時刻（例如「差十分三點」「三點差十分」）、廿／卅與財務大寫數字不推測；無效／不支援的時刻與時段字保留在標題，以全天草稿交給使用者確認。仍保留原稿的單獨「中午」12:00、既有上午／下午換算、日期／重複／地點／提醒解析順序及 placeholder。提醒實際保存仍等待 DP-042。
- 只有日期／時間的非空輸入也開啟新增 sheet；空標題儲存沿用 DP-076 的「新事件」。這補正 `submitQuick()` 殘留的 title guard，讓已實作的 sheet fallback 能從快速新增抵達；取消／Escape 不留資料。

### 決策（DP-111，2026-10-03）— 事件時區控制項

依專案擁有者自主開發委託，DP-014 的事件時區選單直接沿用原稿 :605 的五個城市／順序及現有 `.cal-field` canonical token，不需新增 scaffold token。明確更換時區沿既有 `EventPatch.timezone` contract 保留表單日期與時鐘、重新錨定 instant；取消不保存，重複事件仍問單次／全部。新建事件以 `preferences.timezone` 預選，編輯以自己的 `event.timezone` 預選，清單外的已保存 IANA 值補入，未更換時不送 `timezone` patch。

選單的 GMT 偏移改按各城市對該事件日期／開始時鐘的解析結果顯示，而非複製原稿寫死的夏季偏移；表單日期或時間未填完整時只顯示城市。使用者提示說明「更換時區會保留日期與時間，並改變實際開始時刻」。全天事件與待辦沒有 canonical timezone，故不顯示不能保存的控制項，切回有時間的事件才恢復選擇。這兩處是有意的原稿差異；DP-064 的 display timezone 與週格拖曳規則維持，DP-014 其他未完成段落仍保留。

### 保存修正（DP-112，2026-10-03）— 編輯既有多日時間區間

DP-072 前置核對重現：既有約 49 小時的 timed event，僅改標題或原樣送出 sheet 的日期／時鐘也會被壓成 1 小時。`applyEventPatch()` 現在於時間未變動時保留原起訖 instant，包括秒數與 DST 回撥後一次的讀法；未變動的時區標籤也以該 instant 的實際偏移顯示。真正變更日期／時鐘／時區時，若來源區間的日數跨度超出一般同日或隔夜時鐘所能推導的最小跨度，保留那些額外日數，按操作時區解析新的結束日；不得用固定毫秒數跨過 DST。

一般同日／隔夜事件仍依既有開始、結束時鐘推導，以免跨時區系列拖曳把 1 小時夜班誤拉成 25 小時。sheet 的操作時區是來源 `event.timezone`（顯式換時區後在新時區重錨）；grid 的操作時區是 display timezone，保存時仍保留事件自身的 timezone。這項修正不新增 patch 形狀或 UI，真正在格線拖曳跨午夜片段仍屬 DP-072。時間變更與 occurrence expansion 的分鐘精度維持既有契約。

### 決策（DP-072，2026-10-03）— 跨午夜週格拖曳

依持續自主開發委託採用 agent 建議：從任何片段拖曳都移動完整 occurrence 的兩端；最後一段底緣只調整結束，其他片段沒有 resize 把手。位移按 display timezone 的日曆日期與牆上分鐘解析，每端各帶完整日期，DST 不使用固定 instant delta；仍保留事件 timezone 與單一 domain event。跨欄以被拖片段所在日為基準夾在可見週，完整事件的其他端點可在週外。單日拖曳維持原推導。

新增 `EventPatch.timedInterval` 帶已解析的完整 instant 起訖，與單日期時鐘／換時區欄位互斥，只適用 timed event。區間為正且有效才可預覽／提交；resize 短於 15 分鐘時拒絕保存，保留未動起點的精確 instant。未移動／取消／pointercancel 不寫入。重複事件沿 DP-083 scope，套用全部將新區間換成事件時區的牆上起訖與日數，再以該次的日期位移重錨到系列，兩端分別解析系列錨點上的 DST。這是新產品能力，原稿不能完整表示這些區間；DP-077 真機視覺回饋的驗證限制維持。

## 7. 工程治理

### 決策（DP-162，2026-10-16）— axe 可及性 smoke，截圖基線延後

依審查建議先加 axe，不做截圖比對：十二組主題 × 各檢視的截圖成本高，字型繪製也容易造成不穩定的差異。這是 agent 依條目建議執行，PR 審查即是否決點。

- `e2e/accessibility.spec.ts` 以 `@axe-core/playwright` 4.13.0（開發相依，MPL-2.0，不進 production bundle；4.14.0 在動工前一天才發布，所以選兩個月前的版本）檢查 WCAG 2.0／2.1／2.2 A 與 AA 的規則。漫畫淺色與深色在手機與桌面走過設定、新增日曆、月／週／列表、新增行程、日詳情、搜尋（含結果）與綜覽；六套主題 × 淺／深色在手機走過設定、月曆、日詳情與新增行程。資料是一筆有時間的行程、一筆全天行程、一筆待辦，時間固定在 2026-10-14。**第一次跑完全部 0 違規**，所以沒有已知例外清單；之後出現的違規就是新的。
- **`.dp-texture` 讓 axe 完全量不到對比。** 它是主題紋理層，`position: absolute`、`z-index: 38`、`pointer-events: none`、`aria-hidden`，蓋在整個 App 上。`elementsFromPoint` 會略過 `pointer-events: none` 的元素，所以瀏覽器回報的堆疊裡看不到它，但 axe 以版面計算堆疊，把每個文字都判成「背景被其他元素蓋住」，歸為無法判定而不是違規。探勘時第一輪就是這樣得到「0 違規」：124 個節點全部無法判定，故意放進去的低對比文字也沒被抓到。spec 因此在稽核時隱藏它。五套主題的紋理是 `none`（完全透明），像素主題是每 3px 一條 5–7% 的掃描線，**這一點對比沒有被量到**。同樣的原因，Lighthouse 等以 axe 為基礎的工具直接量這個 App 也會得到「沒有問題」。
- **每次稽核都必須真的量到對比**：通過的對比節點至少 5 個。第一次跑最少的是新增日曆對話框的 6 個，背後的畫面在 50% 遮罩下，axe 正確地歸為無法判定。之後若又有覆蓋層讓 axe 看不到，測試會失敗，不會默默變綠。
- 反向驗證：不隱藏紋理層時在設定頁失敗（只量到 3 個）；注入淺灰色的畫面標題時在搜尋頁以 color-contrast 失敗。
- **量不到的部分**：日曆、設定與綜覽的標題列底下是網點（`--halftone`，radial-gradient），axe 把上面的標題歸為無法判定（`bgGradient`）。實測：同樣注入淺灰標題，設定與綜覽沒被抓到，沒有網點的搜尋標題列以 color-contrast 失敗。被捲動容器部分遮住的月格、只有一兩個字的格子也歸為無法判定。這些文字的色票由 `src/theme/textContrast.test.ts` 保證。axe 不會走焦點，不取代 DP-154 的焦點 e2e；結果也不是螢幕閱讀器或真機的證據（DP-032）。

### 決策（DP-146，2026-10-12）— 診斷資訊由使用者複製，只含版本、畫面與錯誤類型

專案擁有者對遠端錯誤回報的答覆是：目前自己使用可以延後，先提供可複製的診斷資訊，包含版本、分頁、錯誤類型；準備開放他人使用時再接基本監控並同步隱私說明；回報內容需排除行程文字、附件、Email 與登入憑證。

兩個錯誤畫面因此各有一顆「複製診斷資訊」。內容由 `buildDiagnostics()` 這一個純函式決定，共五行：標題、`__APP_VERSION__`、出錯的畫面（分頁名稱，最外層為「啟動」）、錯誤類型、錯誤被接住的時間（UTC，fallback 第一次 render 時固定，不是按下按鈕的時間）。

**錯誤訊息本文不在裡面。** 它是自由文字，在這個 App 裡可能來自處理某一列時丟出的例外，或伺服器回覆的轉述；無法保證不含行程標題、Email 或 token。與其事後過濾，不如不收。訊息仍在畫面上的「錯誤訊息」裡，使用者看得到、可以自己決定要不要轉述。同理，`Error.name` 通常是建構式名稱，但程式可以把它設成任意字串，所以只接受識別字形式，其餘寫成「（其他）」。這一層保證由單元測試釘住：故意放進行程標題、Email 與 token 字樣的錯誤，產生的文字裡一個都不會出現。

複製只在使用者按下時發生，用 `navigator.clipboard.writeText`。剪貼簿不存在或被拒（非安全來源、權限被拒）時，改顯示同樣內容的唯讀文字框，自動全選、聚焦並捲入視野，讓使用者手動複製；第一次實測時文字框底部被分頁列蓋住 20px，聚焦本身不會捲動部分可見的元素，所以補上 `scrollIntoView`。文字框字級 16px，避免 iOS Safari 聚焦時放大頁面。

沒有任何資料離開裝置，所以 CSP 的 `connect-src`、`DataPrivacyCard` 與 `docs/data-and-privacy.md` 都不需要改。遠端監控仍掛在 DP-034；屆時回報的欄位應以這份清單為起點，而不是從錯誤物件整個序列化。

### 決策（DP-139，2026-10-07）— 畫面錯誤在本機接住，不送出裝置

整個 App 原本沒有 error boundary。React 在錯誤逸出 render 時會卸載整棵樹，使用者看到的是空白頁；若錯誤來自某筆已保存的資料，重新載入會得到同一張空白頁，而且到不了「設定 → 匯出備份」。這是 DP-034「錯誤監控」清單裡不需要外部服務就能先做的一半。

`ErrorBoundary` 掛在兩層，責任不同：

- **分頁畫面一層（`App`）。** 以分頁為 key 包住目前的分頁畫面。某個畫面丟錯時只有它被換成 `ScreenErrorFallback`；`AppShell` 的分頁列、橫幅與其他分頁不在 boundary 內，照常運作。sheet 與 dialog 雖然 portal 到 viewport，在 React 樹上仍屬於開啟它的畫面，所以它們的 render error 也由這一層接住。以分頁為 key 是為了讓另一個分頁永遠從乾淨狀態開始，不必在各個離開路徑上記得清錯誤。
- **最外層（`main.tsx`）。** 包住所有 provider。provider、shell 或上層 dialog 出錯時，主題 token 與 shell 樣式都不能假設存在，所以 `RootErrorFallback` 用自帶的樣式，顏色取預設主題漫畫淺色。這一層不提供「再試一次」：壞的是畫面之上的樹，原地重繪多半再壞一次，重新載入才是誠實的選項。

fallback 沿用復原畫面（`recovery.css`）的版面與 token，不另立一套「App 出問題」的外觀。文案只說得出口的事：資料沒有被刪除（boundary 不讀寫任何資料）、其他分頁仍可使用、可以到設定匯出備份；當壞掉的就是設定時不提這一句，免得把人導回原地。錯誤訊息收在 `<details>` 裡，給使用者轉述用。

**DP-143 補充（同日）：** 「到設定匯出」在設定本身壞掉時不是出口，也要求看著錯誤畫面的人知道匯出在哪裡。fallback 因此直接提供「下載備份」。資料由 `App` 透過 callback 交給它（`App` 本來就持有 ready 狀態的資料與版本號），fallback 仍然不碰資料邊界；備份的產生收進 `src/screens/backupDownload.ts` 的 `downloadJsonBackup()`，設定的「匯出資料」改用同一個函式，兩處不可能產生不同的檔案。下載在事件 handler 裡執行，不在 render，所以它自己出錯不會再觸發 boundary：錯誤會顯示在按鈕下方，「再試一次」與「重新載入 App」照常可用。原本依分頁切換文案的 `settingsHint` 已不需要而移除。最外層的 `RootErrorFallback` 位在 provider 之上，沒有資料可匯出，維持只有重新載入。

**不做遠端回報。** boundary 不呼叫任何服務，也不自行記錄（React 已把接住的錯誤寫進 console）。把錯誤送出裝置需要先選服務、放寬 CSP 的 `connect-src`，並在隱私說明卡補上對應文字；那是產品與隱私決定，仍掛在 DP-034。也因此 `DataPrivacyCard` 與 `docs/data-and-privacy.md` 不需要更動。

**boundary 接不到的：** 事件 handler、Promise 與計時器裡的錯誤不經過 render，不會觸發它。那些路徑維持既有處理（寫入失敗由 DataProvider 的橫幅與各表單回報）。這一項也不改 DP-016 的 fail-closed：資料讀不了仍然先到 `DataRecoveryScreen`，不會落到這裡。

測試方式值得留給後人：dev server 逐檔提供原始模組，所以 e2e 可以用 `page.route()` 把某個畫面模組換成會丟錯的版本，不必在正式程式裡留測試掛鉤，也因此能涵蓋沒有單元測試的 `main.tsx` 組成。這只在 dev server 下可行；production build 是打包過的。

驗證：App 層單元案例在修正前以「錯誤直接逸出、整棵樹卸載」失敗，兩個 browser 案例在還原 `App.tsx`／`main.tsx` 時失敗（截圖為全白頁）。lint、typecheck、1018 個單元案例／63 檔、七項 posttest、build／check:build 通過（JS 665,849 raw／195,191 gzip，CSS 102,385／25,569，皆在上限內）。browser：某畫面出錯後分頁列可用、設定可下載內含該筆行程的 JSON 備份、回到日曆資料仍在、遊客資料逐字不變，按「重新載入 App」後恢復；App 無法啟動時顯示說明，資料不變，重新載入後恢復。375×667、390×844、1280×900 目視兩個 fallback，按鈕高 45–48px、無水平溢出。六套主題 × 淺／深色量測 fallback 的文字對比：本項新增的樣式都不低於 4.5:1（標題改用 `--fg`，因為 `#e4002b` 在漫畫深色 surface 上只有 3.59:1）；低於 4.5:1 的只有沿用的原稿 token —— 主色按鈕字在暖陽／鮮活／像素淺色為 3.73／3.12／3.64，`--muted` 在暖陽淺色為 4.48 —— 這是全 App 共用的配色，登記為 DP-140，不在本項改動。只在 Chromium 驗證，沒有真機證據。

### 決策（DP-119，2026-10-04）— 可執行的產物大小上限

依持續自主開發委託採用 agent 建議：在 `performance-budget.json` 保存 JS 800 KiB raw／220 KiB gzip、CSS 128 KiB raw／32 KiB gzip 的總量上限。`check:build` 加總 production 所有 `.js`／`.mjs`（包含 worker）與 `.css`，逐檔 gzip 後加總；配置缺漏／無效、讀取失敗或任一超限都走既有失敗流程。既有 CI 三種 base 與 staging 部署閘門自動沿用，不改 workflow。限制依 DP-118 後 main 的實測基線保留約 18–31% 空間，後續調整須在 PR 說明原因；Vite 單一 chunk 的 500 kB 警告保留。

這是 aggregate artifact 大小限制，不代表首屏下載量或實機效能。`npm run test` 的 posttest 執行獨立 Node 回歸，保留既有 Vitest 選檔與環境；計量範圍、基線和限制見 `docs/performance-budget.md`，DP-034 父項仍未完成。


- 最小 CI 已建立：`npm ci` → lint → typecheck → unit test → build → build asset check；DP-030 另以獨立 job 跑 Playwright mobile／desktop Chromium，失敗才保存 browser diagnostics。CI 不使用任何 secret；Supabase local reset／pgTAP 原本留待有 Docker 的受控環境，DP-084 起改由第三個 job 在 GitHub runner 內實跑（只啟動本機 Postgres，不 link 遠端專案），DP-085 再讓同一個 job 重新產生 `database.types.ts` 並與提交的版本比對。這個 job 也經由 `deploy-staging.yml` 的 `uses:` 成為部署閘門的一部分。
- CI 同時固定 Node major version；`package.json#engines` 與版本檔應保持一致。DP-086 起 runner 映像也固定為 `ubuntu-26.04`，不用 `ubuntu-latest`：後者會在沒有任何 PR 的情況下換作業系統，而 Playwright 的系統依賴與 Supabase 的 Docker 流程都依賴 OS。升級視為一次需要完整 CI 驗證的變更。
- Browser e2e 採雙邊界：guest CRUD／reload 必須走 production 真實入口；authenticated repository／附件流程可走 dev-only harness，以既有 `FakeSupabase` 提供決定性 Auth、DB 與 Storage 回應。harness 不進 production build，不得連真實專案、帶正式帳號或宣稱取代 RLS／pgTAP 驗證。
- mobile Chromium 以 390×844 驗證 App-only shell，desktop Chromium 以 1280×900 驗證 canonical 404×824 展示框；兩者都把 console error／warning 與 page error 視為失敗。iOS Safari、Android Chrome、真實 OAuth／redirect 與 staging data persistence 仍是 DP-032／033 的 release acceptance。
- LICENSE 暫不替專案擁有者做決定。Public repository 在沒有 LICENSE 時仍是保留所有權利；若要接受外部貢獻，再由擁有者選擇授權條款。

## 8. 2026-08-01 review handoff 採納結果

| 提案 | 決定 |
| --- | --- |
| P0 malformed／future schema 資料遺失 | 採用，提升為最高優先；已用探針重現。 |
| storage 不可用時降級 | 調整後採用；只允許有明顯警告的非持久化模式。 |
| theme | 保留並完整接線，不移除。 |
| `month_weeks` | 採用語意修正，改為 fixed-six vs adaptive。 |
| 寵物規範與 `grab` | 採用；更新為 App 內浮動情境並保留七狀態。 |
| CI、domain ↔ DB mapping、PNG icons | 採用並調高任務優先度。 |
| Node pin、更新節流、日期／提醒／時區約束、release note 不可變 | 採用並併入對應任務／規則。 |
| LICENSE | 延後，等待專案擁有者選擇。 |
