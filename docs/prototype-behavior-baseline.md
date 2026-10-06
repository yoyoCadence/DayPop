# DayPop 原型行為與設計保全清單

**DP-134（2026-10-06）更新**：行程表單的一般刪除、重複「刪除全部」與「只刪這一次」確認成功才關閉，失敗保留編輯畫面與草稿，提示在刪除按鈕正下方；重複刪除的重試重新選範圍，沒有自動重送。帳號模式刪除後回應遺失時，明確重試收到 `false` 也會移除該筆，不再留下刪不掉的幽靈行程。原稿刪除是同步的，這是沿原表單／範圍對話框的狀態擴充，取代下方 DP-133「刪除另列後續」；附件刪除的同型問題與其他表單的刪除入口仍待後續，詳見 ADR §2。

**DP-133（2026-10-06）更新**：行程表單新增／編輯、重複單次／全部與新增待辦確認成功才關閉，失敗保留草稿並明示先確認資料再重試；等待防重複提交且取消／背景／Escape 不關閉。原稿同步本機保存沒有等待狀態，這是沿原表單欄位／token 的狀態擴充，DataActions 結果經既有單一 queue，其他不等待呼叫仍相容；write barrier／帳號切換優先且不自動重送。dev-only synthetic account 的六個 mobile／desktop browser cases 不當作真實雲端或真機驗收，刪除與其他表單另列後續，詳見 ADR §2。

**DP-130（2026-10-06）更新**：日詳情父待辦與已顯示子項可透過列下方的 native date 表單換日，僅改這一項，父子日期獨立；確認成功才移出來源日，保留完成、優先度、階層、排序、日曆、標題與分享範圍。Enter 保存，同日／取消／Escape 不寫入且還原觸發焦點，等待防重複提交、可恢復失敗保留草稿；移出後焦點回到同一 sheet 的完成按鈕，不搶其他控制項或新 sheet 的焦點。原稿 :561 沒有換日能力，這是沿既有卡片／欄位 token 的刻意擴充，見 ADR §2；下方「日期移動未接」為歷史，排序與 DP-014 其餘段落仍未完成，沒有清除日期或無日期管理入口。不改 schema／RPC、Auth、release 或部署；帳號 browser 驗證仍用 dev-only FakeSupabase。

**DP-128（2026-10-05）更新**：日詳情的父待辦與已顯示子項可選無／低／中／高優先度，僅保存該筆 priority，父子獨立且不改排序、完成、日期或標題。原稿 :561 無選擇器，此為沿既有主題／native 欄位的刻意擴充，決策見 ADR §2。保存中停用；失敗保持最後確認的選項並提示重選。下方「優先度操作仍未接」為歷史，排序／日期移動與 DP-014 其餘段落仍待完成。

**DP-127（2026-10-05）更新**：事件 sheet 的全天模式可建立／修改 inclusive 結束日期。有效開始日變更會平移整段，結束日可延長／縮短；無效範圍保留草稿且不寫入。重複單次保存該次範圍，全部先平移系列錨點再套新跨度，越界保留表單。原稿沒有結束日期，是接續 DP-126 的刻意擴充，沿既有日期欄位與 token，未新增 CSS。guest／account 經既有 seam 與映射，無 schema／release／部署變更；決策及 harness 限制見 ADR §6。

**DP-126（2026-10-05）更新**：多日全天行程在月曆、週、列表、日詳情與綜覽均按 inclusive 日期顯示每個佔用日，續日標「續」。`allDayDisplaySegments()` 先裁切可見 window 再以無時區日曆日期展開，不拆資料列；續日編輯／單次取消／替換仍交出完整 resolved occurrence，綜覽跨月總數沿既有去重。這是原稿單日期全天模型的刻意擴充、接續 DP-114；既有卡片／色塊／欄位 token 與控制項不變。`e2e/all-day-spans.spec.ts` 在紐約裝置時區＋台北 display timezone 的 mobile／desktop 共四個案例驗證五處呈現、續日標題編輯與 reload、單次取消及替換；沒有 schema、repository、release 或部署變更，真機／staging 未由此驗證，見 ADR §6。

**DP-121（2026-10-04）更新**：列表檢視、寵物徽章與綜覽只計最上層待辦，子項只在日詳情的父待辦卡片裡出現。這是還原原稿：原稿子項存在 `t.subs` 裡，列表（`:690`）、徽章（`:1304-1306`）與綜覽（`:1253`）都只看最上層。判定重用日詳情的 `todoGroupsOn()`，所以與父項不同天的子項等匯入資料仍會出現。

**DP-120（2026-10-04）更新**：日詳情父待辦及顯示中的子項可 inline 改標題，完成／日期／階層／日曆／分享範圍保留。原稿無此操作，因此記為產品擴充；native form 沿原稿卡片與欄位 token、16px 輸入，Enter 保存、取消／Escape 不寫入且還原焦點，可恢復失敗保留草稿。guest write barrier 與 account title-only owner update 共用 queue，成功才確認 snapshot／cache；排序／優先度／日期移動／寵物 XP 未接，未改 schema／RPC／release／部署，見 ADR §2。

**DP-118（2026-10-04）更新**：設定新增「資料與隱私」收合說明，清楚交代遊客／帳號、私人附件、未加密備份、登出不刪除與逐筆刪除／刪日曆移動內容等實際效果，並標明尚無一鍵清空或帳號刪除。原稿沒有這段內容，沿既有 canonical 卡片與 native details；這是說明擴充，不新增管理能力、外部 link 或追蹤，事實依據與剩餘界線見 docs/data-and-privacy.md。

**DP-116（2026-10-04）更新**：日詳情待辦接回原稿 :561 的子項展開／收合、完成比例及新增／勾選／刪除。新增僅一層，繼承父項日期／日曆／分享範圍，父與子完成獨立；既有多層與跨日期匯入資料仍可操作，刪除沿 DP-115 子樹邊界。實際渲染原稿並比對漫畫淺／深色及桌面像素深色，未提供尚無行為的拖曳 handle；下方「子項 UI 待 DP-014」為歷史，排序／優先度／日期移動／寵物 XP 仍未接。沒有新 schema 或部署，決策與相容規則見 ADR §2。

**DP-114（2026-10-04）更新**：週檢視新增與日期／時間格對齊的全天列，inclusive 多日事件後續日標「續」，點擊與鍵盤開啟具體 occurrence，重複修改／刪除沿現有 scope。沒有全天事件就不畫額外列，全天資料不影響時間軌、now line 或拖曳。原稿實際渲染與 markup 都略過全天事件；本項是依日常使用優先委託採用的新產品決策，取代下方「週檢視不顯示全天事件」的現況說明，完整規則見 ADR §6。

這份清單記錄 `日曆桌寵 Calendar Pet.dc.html` 在重構前的產品範圍。完整設計來源與視覺不變條件見 [Claude Design 設計基準](claude-design-source-of-truth.md)。新 React App 會漸進搬移；尚未搬移不代表可直接刪除、重新設計或以目前工程骨架取代原型功能。

**DP-083（2026-10-03）更新**：單日重複事件在週格已可拖曳、跨欄換日及拉長度，放開後沿用 sheet 的單次／全部範圍對話框。這是依專案擁有者自主開發委託採用的建議，刻意偏離原稿 `wkUp()` 直接拆出該次、不詢問的行為；下方歷史紀錄中「重複色塊不可拖曳、待決策」以本段為準。跨午夜片段與真機回饋仍分別由 DP-072／077 處理。解析與系列錨點規則見 ADR §6 的 DP-083 條目。

狀態說明：`工程骨架` 是 React App 已有基本功能、但尚未通過 Claude Design 視覺驗收；`原型限定` 是只存在舊 `.dc.html`；`假功能` 是畫面存在但沒有真正後端能力。

**DP-113（2026-10-04）更新**：帳號／版本區塊與登入、更新提示、版本公告已改吃既有 canonical theme token，六套淺／深色均跟隨保存的偏好；`shell.css` 的紫色 scaffold bridge 移除。原稿沒有 Auth／PWA 畫面，因此採實際渲染的原稿設定卡片及日曆編輯 dialog 作為控制項依據，保留 DayPop 原有資訊架構／操作與較寬的 dialog，不宣稱逐像素相同。短螢幕捲動與桌面 frame 內遮罩維持；未改 Auth、更新、資料或通知等能力。下方「帳號與版本工程骨架／橋接仍待搬移」為歷史，現行決策見 ADR §3，DP-014 其他段落仍未結案。

**DP-072（2026-10-03）更新**：跨午夜／多日 occurrence 已可從任一週格片段移動整筆，最後一段可調整結束端點；預覽一併重切全部片段，仍保存單一事件及原 timezone，重複仍問 scope。位移每端按 display timezone 的日曆日／時鐘解析，完整區間跨資料邊界；單日原推導與 canonical CSS 維持。這是原稿不具備的新產品決策，規則見 ADR §6；下方「跨午夜不可拖曳、待 DP-072」為歷史，DP-077 的 iPhone 即時回饋仍未宣稱通過。

**DP-111（2026-10-03）更新**：有時間的事件已接回原稿 :605 時區控制項，五個城市／順序與 canonical select 樣式沿用；GMT 標籤依事件日期／時間顯示，清單外的已保存值補入。更換時區保留日期與時鐘、重新錨定實際時刻，重複修改沿用 scope。全天／待辦沒有 canonical timezone，故隱藏；選擇語意與有意的原稿差異見 ADR §6。下方「時區控制項尚未搬移」的歷史敘述以本段為準，DP-014 其他段落仍未完成。

**DP-112（2026-10-03）更新**：編輯既有多日 timed event 不再以單一天重算而縮短。未改時間時保留精確起訖 instant／秒數／DST 回撥讀法；改日期或時區時保留超出一般同日／隔夜推導的日數跨度。時區選單的未變動回撥時刻標籤也顯示實際 instant 的 GMT。沿用現有表單、scope 與 canonical 樣式，不新增原稿沒有的結束日期欄位；跨午夜片段拖曳仍待 DP-072。保存規則見 ADR §6。

**DP-075（2026-10-03）更新**：快速新增加入中文數字時分、兩／两、半／一刻／三刻及全形數字；這是依自主開發委託擴充原稿的 ASCII 時刻語法。無效與相對時刻保留文字供確認，非空但只含日期／時間的輸入也能進 sheet，空標題儲存沿用原稿「新事件」。既有 placeholder／表單／確認前不保存維持，完整範圍見 ADR §6。

每一項假功能都在 `tasks.md` 的「原型假功能與待補能力」列出負責任務，停用後不會被遺忘。

## 核心畫面與資料

| 行為 | 原型狀態 | React App 狀態 | 搬移驗收重點 |
| --- | --- | --- | --- |
| 月檢視與月份切換 | 可用 | 已搬移（DP-051／DP-018） | 今天、跨月日期與事件提示正確，且 header、segmented control、快速新增、連續捲動月格、底部導覽、FAB 與浮動寵物位置符合原稿。點月格開啟日詳情 sheet（DP-057）；設定可保存依月份自動 4–6 列或固定六列。 |
| 快速新增自然語言解析 | 可用 | 已搬移（DP-051／DP-060） | 相對日期、星期、上午／下午、地點、提醒與重複的解析結果與原稿一致。DP-060 起依原稿把解析結果交給事件 sheet 確認，不再直接建立；標題／日期／時間／地點會預填，取消即整筆丟棄。重複的 domain 行為已由 DP-027 完成，sheet 控制項與 draft 交接已由 DP-082 接上，因此解析到的重複會預填進選單；提醒待 DP-042。完成前送出時必須明講，不得靜靜丟棄。 |
| 農曆與節日標示 | 可用 | 已搬移（DP-051） | 2024–2040 對照表、節日優先於農曆日、超出範圍顯示空白而非猜測。 |
| 週檢視、列表檢視 | 可用 | 已搬移（DP-053） | 日期範圍、排序與切換後選取狀態一致；週檢視含拖曳改時間、調整長度與跨欄換日。**週檢視不顯示全天事件**，這與原稿一致：原稿 `buildWeek()` 以 `if(e.allDay) return;` 略過全天事件，markup 也沒有全天列。要顯示全天事件是新的產品決策，不是待補的搬移。**跨午夜行程**原本同樣依原稿只畫在起始日、且結束早於開始時色塊夾成 20px；DP-064 已定案並實作為 display segments（見 `docs/architecture-decisions.md` §6）。**這裡另有一處刻意偏離原稿**：原檔 `buildWeek()` 的順序是 `if(h<20)h=20; if(top<0){ h+=top; top=0; }` —— **先套 20px 下限、後裁切**，所以裁切會從已經是下限的高度再減一次，把高度變成負的。原檔真的會寫出 `height:-286px`（瀏覽器視為無效值而忽略，色塊因此凍在上一個有效高度、不再跟著指標）。ADR §6 明文禁止負高度，因此 DayPop 的 `blockGeometry()` **改為先裁切、後套下限**。這是新的產品決策而不是還原原稿；一般情形與跨越軌首的長事件結果都與原稿相同（06:00–08:00 仍是 top 0、height 44），只有整塊被裁到軌上方時不同。 |
| 底部四分頁與 App viewport | 可用 | 已搬移（DP-050） | 手機不渲染假外框／假狀態列；桌面展示框只在瀏覽器分頁且視窗夠寬時出現。 |
| 搜尋與綜覽 | 可用 | 已搬移（DP-058／DP-063） | 搜尋事件／待辦、閒置與無結果狀態、點結果跳到日曆並開啟；綜覽的類型／年月週切換、筆數與可折疊分組皆可用，貼圖分頁已由 DP-055 接上，日曆篩選 chips 已由 DP-059 接上（依原稿只篩事件）。DP-063 依原稿把事件的比對範圍補回 `標題＋地點＋備註`，並在結果副標顯示地點；待辦依原稿仍只比對標題，沒有到期日的待辦結果不可點開（沒有可開的日子，寵物對話泡泡待 DP-040）。 |
| 新增／編輯／刪除事件 | 可用 | 已搬移（DP-053／DP-060／DP-082） | sheet 依原稿排列：標題 → 日曆 chips → 全天 → 日期 → 開始／結束 → 重複 → 地點 → 備註 → 刪除。重複與時區的底層行為已由 DP-027 完成；**重複控制項已由 DP-082 依原稿 `:599` 接上**（六個選項逐字同原稿，寫的是 DP-027 的 RRULE），**單次／全部範圍 dialog 也已由 DP-082 依原稿 `:430-439` 接上**（四段文案逐字同原稿 `:1372`：修改／刪除兩種情境各有標題、說明與兩顆按鈕），只剩時區控制項待搬移；提醒待 DP-042、附件待 DP-028、邀請對象尚無 domain 型別。`全天` 已於 2026-08-27 改為原稿 `:586` 的 44×25 開關。**原稿的 `repeat` 只有六個字串，DayPop 存的是完整 RECUR 值**，所以 ICS 匯入帶進來的規則（`FREQ=DAILY;INTERVAL=3` 等）六個選項表達不出；這種事件的選單會多一個「自訂規則（維持原樣）」並保持規則不動，不得靜靜顯示成「不重複」再於儲存時覆寫。 |
| 重複事件與例外 | 可用但模型隱含 | Domain 行為完成（DP-012／DP-027） | RFC 5545 RECUR validation、DST-safe occurrence expansion、cancel／replacement exception、單次／全部 mutation 與 ICS inclusive／exclusive round-trip 已完成。DP-081 起四個檢視都畫得出每一次 occurrence，DP-082 起事件 sheet 建得出重複事件，**並且點開某一次再儲存或刪除時會問「只改這一次／套用全部」**：全部走 `updateEvent`／`deleteEvent`，單次走 `replaceEventOccurrence`／`cancelEventOccurrence`。**從搜尋／綜覽打開時不問**，因為那兩個畫面搜的是 base event，結果本身就是整個系列。**週檢視的重複色塊仍不可拖曳**：底層已經齊備，但原稿 `wkUp` 是不問就拆成獨立事件，與 sheet 剛開始顯示的對話框互相矛盾，屬未定的產品決策。完整檔案匯入／預覽／合併已由 DP-056 完成。 |
| 日詳情 sheet | 可用 | 已搬移（DP-057／DP-063） | 點月格開啟；行程列含全天／時間範圍與衝突標籤、空狀態、＋新增事件與待辦清單；貼圖列與選擇器已由 DP-055 接上，標題下方的地點副標已由 DP-063 補回（原稿的 `e.hasLoc`）。待辦子項與排序欄位已由 DP-012 完成，操作 UI 待 DP-014。**跨午夜行程的衝突判定**與原稿同樣以同日 `HH:MM` 比較，因此不會被判為衝突；要改是新的產品決策，見 DP-064。 |
| 新增／完成／刪除待辦 | 可用 | 新增／完成／刪除可用（DP-057） | Canonical Todo 已含 parent、sort order、priority、due date 與 completion instant；子項／排序操作與日期移動 UI 待 DP-014，新增入口目前在日詳情與事件 sheet，寵物對話泡泡待 DP-040。 |
| 貼圖 | 可用 | 已搬移（DP-055） | Canonical Sticker 同時保留 glyph 與可版本化 asset key；月格依當日數量調整字級（1／2／3／4+ → 19／15／12／10px）並置底，日詳情有貼圖列與 63 個 glyph 的選擇器（點既有貼圖即刪除、選一個後選擇器關閉），綜覽的貼圖分頁以 glyph 取代色條並可點開當日。 |
| 主題與個人偏好 | 可用 | 已接上保存（DP-018） | 六套 theme id 與 system／light／dark 分開保存；system 即時跟隨裝置，並同步 CSS、theme-color meta 與 manifest 靜態啟動色。本機 v2→v3 與 DB migration 都保留既有值。 |
| 日曆管理（顯示、改名、顏色） | 可用 | 已搬移（DP-059） | 設定的「我的日曆」可新增、改名、換色與切換顯示；顏色套用到月／週／列表／日詳情／綜覽／搜尋，隱藏只是顯示過濾不刪資料。與原稿的差異：刪除日曆時其事件／待辦／貼圖會移到倖存的預設日曆，不留孤兒資料，且只剩一個日曆時拒絕刪除。 |

## 輔助能力

| 行為 | 分類 | 後續處理 |
| --- | --- | --- |
| App 內建寵物小幫手 | 原型可用；React 已有最小摘要 | 保留 App 內定位；素材與狀態機延後，不做 OS 桌面寵物。 |
| JSON／ICS 匯入匯出 | 已搬移（DP-056） | Domain／repository contract、guest commit、authenticated atomic RPC、browser IO、設定頁四個按鈕與匯入預覽皆已完成。JSON 是確認後取代，ICS 是確認後附加；兩者都先 validation／preview，失敗保持原資料。**兩處刻意偏離原稿，都是任務指定而非實作者自選**：(1) **JSON 匯入也要預覽** —— 原檔只對 `.ics` 顯示預覽，JSON 匯入是 `onImportFile()` 解析完就 `commit()`，一個截斷或不相干的檔案會直接蓋掉行事曆；DayPop 改為任何匯入都先產生計畫、由使用者確認後才寫入。(2) **不匯入 AI key** —— 原檔會從檔案還原 `settings.aiKey`；DayPop 的 canonical 文件沒有這個欄位，而且備份內容以允許清單逐欄建立，未知欄位無法夾帶。另有一項不屬於原稿範圍的決定：**備份不含附件**（檔案裡只有 private Storage 的 `objectPath`，離開該帳號沒有意義），preview 會告知略過筆數；JSON replace 遇到現有附件或 attendee 時 fail closed。 |
| 瀏覽器通知 timer | 原型限定 | 不宣稱是可靠背景提醒；Web Push 另案設計。 |
| 附件 | 假功能 | 使用 Supabase 私人 Storage、signed URL、限制與 RLS 後才啟用。 |
| 天氣 | 假功能 | 未選資料來源、權限與失敗體驗前維持停用。 |
| AI 助理 | 模擬／不安全原型 | 延後；若恢復必須走 server-side／Edge Function，禁止把 API key 放前端。 |
| 雲端同步狀態 | 原稿是假功能 | 已接上（DP-026／DP-023）：登入帳號依真實 repository pending／warning 顯示「已同步／同步中／尚未同步」；短暫讀取失敗顯示同帳號最後確認快取與持續警告，寫入失敗不冒充成功。遊客模式仍只顯示本機保存。2026-08-22 已以真實 Email 與 Google 帳號驗證 redirect、identity linking、遠端保存、登出隔離、重登與 reload；Email 註冊成功後改為清除 credentials 並以完成畫面取代表單，不能重複提交。 |

## DP-030 自動化 browser baseline

- **DP-106（2026-10-02）**：`e2e/production-startup-quota.spec.ts` 在真正 production 遊客 App 的 mobile／desktop 共 2 個案例，App 啟動前先以原生 localStorage 把額度填到連開機 probe 都寫不進去；驗證開機即進入記憶體模式並四分頁持續警告，但仍顯示磁碟上讀得到的偏好與行程、不重跳已看過的版本公告，真實 JSON 匯出帶出完整資料，磁碟 entries 不變，釋放額度並 reload 後恢復保存。**這一項含 runtime 修正**（修正前同情境顯示空白預設資料、匯出為空）；canonical UI 不變，原稿沒有對應行為可對照。範圍與限制見 [`deployment.md`](deployment.md) §5.16，DP-034 父任務未完成。

- **DP-104（2026-10-02）**：`e2e/production-unavailable-storage.spec.ts` 在真正 production 遊客 App 的 mobile／desktop 共 2 個案例，以 Chromium 原生 `--disable-local-storage` 並先核對 API 為 null，驗證開機記憶體模式、四分頁持續警告、行程／待辦與偏好的跨分頁編輯、真實 JSON 匯出及 reload 回預設。只新增回歸，runtime／canonical UI 不變；此證據不是 SecurityError 或實際隱私政策封鎖，完整範圍見 [`deployment.md`](deployment.md) §5.15，DP-034 父任務未完成。

- **DP-103（2026-10-02）**：production 復原 spec 新增 corrupt／future × mobile／desktop 共 4 個備份遇 quota 案例，真實下載逐字保留原始內容、文案指出下載檔案是備份、只在記憶體重設／編輯並持續警告；釋放額度仍不補寫，reload 讀回原 blocked 文件且重新要求備份。原生 quota 填充抽至共用 test fixture，runtime／canonical UI 不變；開機 storage、下載取消／真機等限制見 [`deployment.md`](deployment.md) §5.14，DP-034 父任務未完成。

- **DP-102（2026-10-02）**：`e2e/production-storage-quota.spec.ts` 在真正 production 遊客 App 的 mobile／desktop 共 2 個案例，以原生 localStorage 填滿額度觸發 `QuotaExceededError`；驗證分頁修改與真實 JSON 匯出保留完整資料、四分頁持續警告、原始磁碟 entries 不變，釋放額度後同一 session 不補寫，reload 讀回原始資料。僅新增測試，既有 runtime／canonical UI 不變；開機 probe、記憶體復原及其他限制見 [`deployment.md`](deployment.md) §5.13，DP-034 父任務未完成。

- **DP-101（2026-10-02）**：`e2e/production-storage-recovery.spec.ts` 在真正 production 遊客 App 的 mobile／desktop 共 4 個案例驗證 corrupt／future bytes 不因無關舊備份而開放重設，真實下載／相符備份後可重設並 reload，原始備份、legacy、帳號快取與其他 key 保留。修正 `resetUserData()` 的當下原始內容核對及復原 UI 的 backup 選擇，符合既有 ADR §1；限制見 [`deployment.md`](deployment.md) §5.12，不取代 DP-034 放行。

- **DP-097（2026-10-01）**：production 更新回歸新增 script 下載／安裝快取回 503 的 mobile／desktop 共 4 個案例，在原實作重現 unhandled rejection 與準備中無法解除。更新失敗會在原 dialog 以既有樣式顯示 alert、重新開放按鈕，保留原 App／controller／資料，恢復回應後可立即重試或稍後提醒再檢查成功。單元案例另驗證失敗早於／晚於 update resolve，以及舊 activated worker 正常退役不得誤判；canonical 視覺與 CSS 未改。實際斷線／quota／activation／多分頁等限制見 [`deployment.md`](deployment.md) §5.11。

- **DP-096（2026-10-01）**：`e2e/production-update.spec.ts` 在 mobile／desktop 共新增 4 個完整 production 遊客更新案例，驗證稍後提醒／手動重查／立即更新、App 自動 reload 到新版 bundle、資料／偏好與公告已讀保存；gate 暫停新版安裝，重現並修正 installing worker 尚未就緒就提早 reload 的時序。`useAppUpdate` 沿用既有 statechange／controllerchange，只補上安裝中的等待；canonical UI 未改。測試使用隔離 origin、真正 production entry 與兩份 Vite build，未驗證 Auth、完整離線、真機或 staging；來源與限制見 [`deployment.md`](deployment.md) §5.10。

- **DP-095（2026-10-01）**：`e2e/service-worker.spec.ts` 直接在 mobile／desktop Chromium 執行 generated worker，以隔離的最小靜態 shell 驗證 install／waiting／明確啟用／controllerchange、只清理舊 app-shell cache，以及 guest／account cache／legacy bytes、IndexedDB 與其他 cache 保留。另驗證 `/DayPop/` scope、已取得 shell／asset 的離線讀取與版本資訊不得回 stale cache。不是完整 React 更新 UX 或真機 PWA 驗收；測試來源與限制見 [`deployment.md`](deployment.md) §5.9，canonical UI 與 runtime 未修改。

- **DP-094（2026-10-01）**：`e2e/account-ics-transfer.spec.ts` 在 mobile／desktop 共新增 4 個帳號 ICS 案例，驗證真實下載／選檔、取消、碰撞 UID 與取消／替換例外、只附加並保留原附件／待辦／偏好及 guest bytes、非法檔案整份拒絕且可重選，以及清除 synthetic account cache 後重登重新讀取。帳號資料透過 UI 建立，附件只留在原事件，ICS 副本沒有附件。沿用 dev-only FakeSupabase，沒有修改 canonical UI 或 runtime；限制見 [`deployment.md`](deployment.md) §5.8，未驗證真實服務、第三方互通、真機或 staging。

- **DP-093（2026-10-01）**：`e2e/ics-transfer.spec.ts` 在 mobile／desktop 共新增 8 個遊客 ICS 案例，驗證真實下載、預覽／取消、UID 碰撞重新命名、重複取消／替換例外、只附加並保留所有既有資料、外部浮動時間／TZID／UTC／全天及文字轉義，以及整份拒絕後仍可匯入。device timezone 設為紐約、preferences 為台北，預設日曆不放第一筆，reload 不重新灌 fixture。交接與格式限制見 [`deployment.md`](deployment.md) §5.7；未驗證 authenticated ICS、第三方服務、真機或 staging。

- **DP-092（2026-10-01）**：`e2e/account-json-backup.spec.ts` 在 mobile／desktop 共新增 4 個帳號 JSON 案例，驗證確認還原、清除 synthetic account cache 後重登重新讀取、guest bytes 隔離，以及有附件時拒絕取代且資料保留。修正該回歸發現的 DataProvider 錯誤分類：預期匯入拒絕由原預覽顯示，保留 snapshot／既有警告並正確結束 saving，不再卸載整個 App。harness 限制與交接見 [`deployment.md`](deployment.md) §5.6；未驗證真實 Supabase 或真機。

- **DP-091（2026-09-30）**：`e2e/json-backup.spec.ts` 在 mobile／desktop 共新增 8 個遊客 JSON 備份案例，走真實 download 與選檔，驗證預覽／取消不寫入、確認取代及 reload 保存、無效檔案拒絕。資料含重複例外、子待辦、貼圖與偏好；不是用同份空資料來回匯入。範圍與剩餘限制見 [`deployment.md`](deployment.md) §5.5；不取代 DP-034 正式上線驗收。

- `e2e/guest-crud.spec.ts` 走 production 真實入口，於 390×844 與 1280×900 驗證 guest event／todo 的建立、修改、reload 保存與刪除。
- `e2e/auth-attachment.spec.ts` 走 dev-only auth harness，掛載真實 App、SessionDataProvider 與 authenticated repository，使用既有 FakeSupabase 驗證登入、帳號同步、事件、附件 upload／signed URL／delete 與登出隔離；它不驗證真實 Supabase provider、RLS 或正式資料。
- `e2e/responsive-shell.spec.ts` 驗證手機不出現展示框、桌面維持 canonical 404×824 frame，並檢查設定頁與 sheet 不水平溢出。三個 specs 都要求 console error／warning 與 page error 為 0。
- 這 6 個 browser cases 已由 `npm run test:e2e` 與 GitHub Actions 重複執行；以下清單仍保留為逐段 canonical 視覺搬移與 DP-032 真實裝置 QA 的人工驗收依據。

## 每段搬移的 smoke checklist

- [ ] 390px 手機寬度沒有水平溢出，觸控目標可操作。
- [ ] 使用相同資料狀態與原始 `.dc.html` 逐畫面比對，不以單張截圖或現有 React scaffold 當作設計來源。
- [ ] 漫畫淺色主題的資訊層級、色彩、字級、間距、粗黑邊框、底部 sheet、FAB、底部導覽與浮動寵物一致。
- [ ] 全新使用者以漫畫淺色啟動；已有主題偏好的使用者在 App 更新或資料 migration 後仍保留原選擇。
- [ ] 月／週／列表、搜尋、綜覽、設定及主要 sheet／dialog 均有核對，不只驗收月曆首頁。
- [ ] 桌面寬度不遮蔽主要內容，鍵盤 focus 可見。
- [ ] 手機／安裝 PWA 不渲染假裝置外框；桌面展示框不影響 App safe area 或造成雙重邊框。
- [ ] 新增資料後重新載入仍存在。
- [ ] App 更新只替換 App shell，不清除 `daypop.user-data`、`calpet.v2` 或其他網站資料。
- [ ] 舊資料匯入成功前不修改或刪除 `calpet.v2`。
- [ ] 空白、錯誤、離線／連線恢復狀態不冒充成功。
- [ ] lint、typecheck、unit 與 production build 通過。

## 已知原型文字／產品風險

- 原型以單一 `calpet.v2` JSON blob 儲存所有資料，沒有 schema version、使用者隔離或 migration。
- AI provider key 與一般設定混存在瀏覽器資料中，不得搬入正式架構。
- 附件、天氣與 AI 的部分 UI 仍是展示效果，不可當成已完成能力；同步狀態已由 DP-026 改接真實 repository 狀態，但不代表已實作 Realtime、多裝置 merge 或完整離線寫入。
- 重複事件、時區、DST、ICS、提醒與通知需要獨立測試資料，不能只靠畫面 smoke test。
