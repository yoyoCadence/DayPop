# AGENTS.md

This file is the shared collaboration contract for Codex, Claude Code, and human contributors.

---

## 0. Project Context

> At project creation, the agent should fill or update this section from the user's initial project description.
> If key details are missing, ask concise follow-up questions before implementation.

- **Project name:** 日蹦 DayPop
- **Project goal:** 將 Claude Design 匯出的日曆原型落地成可長期維護的 mobile-first PWA，讓使用者建立行程、待辦、貼圖與個人偏好，透過帳號安全保存資料，並保留 App 內建寵物小幫手的陪伴體驗。MVP 優先確保架構正確、核心日曆完整且在主要裝置穩定可用；跨裝置同步、完整離線編輯與 AI 助理延後。後續產品階段加入「家庭群組」：邀請成員、選擇分享個人日曆並共同維護，同時允許單一事項保持私人。
- **Target users:** 以手機為主要輸入裝置、需要管理個人行程／待辦的個人使用者；MVP 假設同一帳號主要在同一裝置使用，桌面瀏覽器可用但跨裝置即時一致性不是首要目標。第一階段以私人資料為主，不預設團隊協作。
- **Tech stack:** React + TypeScript + Vite 的 mobile-first PWA；測試與品質工具為 Vitest、Testing Library 相容的 jsdom、ESLint 與 TypeScript project references。後端方向為 Supabase Auth + Postgres + Storage 與 `@supabase/supabase-js`，資料庫將以 Supabase CLI migrations 管理。Claude Design 匯出的 `.dc.html`、generated `support.js` 與 `寵物素材規範 Pet Asset Spec.md` 共同構成原始設計來源；正式產品不依賴 generated runtime。
- **High-risk areas** (auth / DB schema / payments / deployment / etc.): 原始設計在 React 搬移時發生視覺／資訊架構漂移、Supabase Auth session／redirect 流程、RLS 與跨使用者資料隔離、本機資料毀損／future schema／storage 不可用、既有 `localStorage` 資料遷移、跨裝置同步衝突、重複事件與時區／夏令時間、通知可靠性、附件存取政策、使用者刪除與資料保留、將 AI API key 存在前端的現有安全風險、匯入檔案驗證。
- **Architecture constraints:** `docs/claude-design-source-of-truth.md` 定義不可自行重設計的 canonical UI／interaction contract，`docs/prototype-behavior-baseline.md` 記錄功能搬移狀態，跨模組決策記錄於 `docs/architecture-decisions.md`，Supabase MCP 階段的交接狀態與界線記錄於 `docs/supabase-mcp-handoff.md`。React 重構必須逐頁對照原始 `.dc.html` 的實際渲染；單張截圖與現有 React scaffold 都不是完整設計來源。新使用者預設採「漫畫」淺色主題，其他五套原稿主題仍須保留；更新與 migration 不得覆寫既有使用者已保存的主題。安裝到手機時只渲染 App 內容，桌面預覽才可顯示原型手機展示框。前端不得持有 `service_role` 或任何伺服器密鑰；所有公開 schema 資料表必須啟用 RLS，且私人使用者資料以 `auth.uid()` 隔離。正式資料需拆成可獨立保存的列，不可延續單一 JSON blob 作為雲端模型。資料存取必須經 repository/service 邊界：guest 與 authenticated adapter 共用 canonical domain contract；遊客模式使用帶 schema version 的本機資料，登入模式以 Supabase 作為 durable store，裝置端保留版本化快取。本機資料解析失敗、來自較新 schema 或 storage 不可用時必須 fail closed，不得用空資料覆寫；非持久化記憶體模式必須持續警告。任何 schema version 提升前先完成 write barrier 與回歸測試。App release version 與 user-data schema version 必須獨立；已正式部署版本的 release note 不可回寫修改。service worker 只可更新／清理 `daypop-app-shell-` cache，不得操作使用者 localStorage／IndexedDB。MVP 不實作 Realtime、多裝置衝突合併、完整離線寫入佇列或家庭分享。舊 `calpet.v2` 資料需有一次性匯入與可回復策略，成功前不得覆寫或刪除。登入 UX 參考 Orbit：Email＋密碼、Google OAuth、忘記／重設密碼、session restore 與遊客模式。家庭功能日後以獨立的 group／membership／invitation／calendar-share 模型擴充；分享必須由每位日曆擁有者明確開啟，單一事項可設為 private，RLS 需依有效 membership 與分享權限判斷，不得只信任前端篩選。AI 若日後保留，必須改由受控的 server-side／Edge Function 代理。寵物是 App 內建小幫手；素材與進階 AI 行為不得阻塞日曆 MVP。
- **Verification commands:** `npm run lint`、`npm run typecheck`、`npm run test`、`npm run build`、`npm run check:build`（需先 build，檢查輸出無遠端依賴且帶 CSP）與 `npm run test:e2e`。這些項目都由 `.github/workflows/ci.yml` 在 PR 與 `main` 的 push 上自動執行，Node major 由 `.nvmrc` 與 `package.json` 的 `engines` 共同固定為 24，runner 映像固定為 `ubuntu-26.04`（DP-086，不用會自行換版的 `ubuntu-latest`；升級時 `ci.yml` 三處與 `deploy-staging.yml` 兩處一起改），CI 不使用任何 secret。Supabase schema 還需可由 `npx supabase db reset` 重建並通過 RLS／migration 驗證；本機跑這條流程需要 Docker。DP-084 起 CI 另有 `database` job 在 runner 內實跑同一組 npm scripts：`supabase:start`（只啟動本機 Postgres）→ `supabase:reset` → `supabase:test`，DP-085 再加上 `supabase:types` 後 `git diff --exit-code -- src/lib/database.types.ts`；同樣不使用 secret、不 link 任何 Supabase 專案。DP-088 起該 job 以 `SUPABASE_INTERNAL_IMAGE_REGISTRY: ghcr.io` 從 ghcr.io 拉映像：CLI 預設的 public.ecr.aws 對匿名拉取有速率與流量額度限制，而 `gen types` 被拒時不像 start／reset／test 會自動改拉 ghcr.io。
  - **跨時區驗證：任何平台都要把該次實際生效的 `Intl.DateTimeFormat().resolvedOptions().timeZone` 印出來當佐證。** 沒有這一項就分不出「真的換了時區」與「設定沒生效、靜默跑在本機時區」。這是通則，適用於所有貢獻者與 CI。以下三點是補充：
    - **本機這台 Windows 開發機有一個特例**：從 **Git for Windows 的 Bash（MSYS）啟動原生 Windows 程式**時，含 `/` 的 `TZ` 值會在 MSYS→Win32 的環境轉換邊界消失。實測 `TZ=America/New_York` 時，Bash 自己與 `/usr/bin/env`（MSYS 程式）都**看得到**該值，但原生 `cmd` 收到的 `%TZ%` 未定義、原生 Windows Node 的 `process.env.TZ` 是 `undefined`。**這不是 Node 的問題，也不只影響 Node**；不含 `/` 的值（`UTC`、`EST5EDT`）能通過，這也是為什麼 `TZ=UTC` 一直有效。本機要跨時區跑就改從 **PowerShell** 設：`$env:TZ='America/New_York'` 會如實得到 `America/New_York`。
    - **不可由這個特例外推。** 標準 Unix Bash、Linux CI、macOS 與 WSL 都沒有這條轉換邊界，命令前綴 assignment 就是標準語意；Node 官方也明載 Windows 支援基本 IANA timezone ID。上面那條只描述「MSYS bash → 原生 Windows 程式」這一條邊界，不能當成 Bash 的通則，也不能反推別人的驗證無效。
    - **`vi.setSystemTime()` 只釘住瞬間，不會選擇時區。** 要用它做跨時區驗證，必須另外搭配測試內明確的 `timeZone`／`preferences.timezone`（見 `CalendarScreen.test.tsx` 的 `today sources` 那組），或一個已確認生效的 process `TZ`。Playwright 走自己的路徑，用 `newPage({ timezoneId })`。
    - CI 跑在 UTC，本機在 UTC+8，**兩者相差一天的那段時間是真的會讓測試紅的**。

---

## 0.1 Current Technical State

- **新增的重試不重複（DP-142，2026-10-07）：** `NewEventInput`／`NewTodoInput`／`NewCalendarInput` 多了可選的 `id`。行程表單（行程與待辦各一個）、日詳情兩個新增欄位（`useConfirmedTodoAdd`）與新增日曆對話框各自在同一份草稿的生命週期內固定一個 id，每次嘗試都帶上；確認成功或重新開啟才換新的。兩個 adapter 以 `creationTarget()` 決定落點：帳號端的新增本來就是主鍵 `upsert`，所以「已寫入但回應遺失」之後的明確重試會落在同一列（內容以重試的草稿為準），不再多出一筆；snapshot 已有該 id 視為已確認，不送 request 也不覆寫；省略或不是 UUID 時照舊由 adapter 產生。這取代 DP-133／137／141 文件裡「新增不具備 idempotency」的但書，UI 文案未改。測試用的 `FakeSupabase.lostResponses` 可模擬「寫入後回應遺失」。貼圖（沒有重試介面）、附件上傳、匯入與單次修改的 RPC 不在本項；schema／RPC／RLS（沿既有 upsert 與 owner policy）、Auth、公告與部署不變。見 ADR §2。

- **日曆對話框等待確認（DP-141，2026-10-07）：** 設定的「新增日曆／編輯日曆」原本由 `SettingsScaffoldScreen` 在按下儲存或「刪除此日曆」的同時關閉，寫入失敗時對話框已不在。`addCalendar`／`updateCalendar`／`deleteCalendar` 改回傳既有 queue 的確認結果（與 DP-133／134 相同，不等待的呼叫如顯示／隱藏開關照常可用）；`CalendarEditDialog` 自己在確認後才呼叫 `onClose`。等待時整個對話框停用、不能取消或重複送出，按下的按鈕顯示「保存中…」或「刪除中…」；失敗留在畫面上，名稱與顏色不變，提示在該按鈕下方，失焦到 body 才把焦點還給它，沒有自動重送。標題在開啟時決定，確認刪除後資料先更新也不會閃成「新增日曆」。原稿是同步的本機保存，這是狀態擴充，見 ADR §2。repository（含 DP-138 的非原子刪除）、其他設定區塊、schema、Auth、公告與部署不變。至此有草稿的表單（行程、待辦新增、日曆）都會等待確認；勾選、刪除待辦與貼圖沒有草稿，維持不等待。

- **畫面出錯不留白（DP-139，2026-10-07）：** `src/shell/ErrorBoundary.tsx` 掛在兩處。`App` 內以分頁為 key 包住四個分頁畫面：某個畫面繪製時丟錯，只換成 `ScreenErrorFallback`（沿復原畫面的樣式，「再試一次」「重新載入 App」與可展開的錯誤訊息），分頁列與其他分頁照常可用，所以「設定 → 匯出」仍到得了。`main.tsx` 最外層另包一層，provider 或 shell 出錯時顯示不依賴主題的 `RootErrorFallback`。在此之前沒有任何 boundary，render error 會卸載整棵樹、留下空白頁。**只接住並說明，不讀寫資料，也不把錯誤送出裝置**；遠端錯誤回報需要另行決定服務、CSP 與隱私說明，仍是 DP-034 未完成的部分。事件 handler 與非同步錯誤不是 boundary 接得到的，維持各自既有的處理。`e2e/screen-error-boundary.spec.ts` 以攔截 dev server 模組的方式實測真實 `main.tsx`。資料邊界、schema、Auth、公告與部署不變，見 ADR §7。

- **日詳情新增待辦保留輸入（DP-137，2026-10-07）：** 日詳情的「新增清單項目」與卡片內「新增細項」原本一呼叫 `onAddTodo` 就清空輸入框，寫入失敗或被拒絕時打好的標題就不見了。兩個表單改用 `useConfirmedTodoAdd()` 等待 `addTodo`（DP-133 起已回傳既有 queue 的確認結果）：確認後才清空，失敗保留輸入並在表單下方提示「待辦尚未確認新增，輸入內容已保留；請先確認清單再重試」，沒有自動重送。等待時輸入框是 `readOnly` 而不是 `disabled`，重複送出由 ref 擋下，焦點與手機鍵盤不會中斷，可以連續新增；day sheet 不上鎖，關閉後舊請求安靜結束。DataActions、repository、勾選／刪除／貼圖、schema、Auth、公告與部署不變。原稿是同步的本機新增，這是狀態擴充，見 ADR §2。另登記 DP-138（帳號刪除日曆不是原子操作，需要 migration，等專案擁有者決定）。

- **附件按鈕焦點捲走 App（DP-136，2026-10-07）：** `.cal-attachment-picker` 加上 `position: relative`，讓視覺隱藏的檔案輸入框以 label 為 containing block。原本它一路落到 `.cal-sheet-backdrop`，留在未捲動的版面位置（畫面下方）並替 `overflow: hidden` 的 `.dp-viewport` 撐出捲動範圍；焦點一落上去（Tab，或直接按「選擇附件」）瀏覽器就捲動整個 App，375×667 的「取消／儲存」被推到 -146px 且使用者捲不回來。修正後 App 捲動範圍為 0，只有 sheet body 捲動；另以 `:has(input:focus-visible)` 在 label 顯示 2px 鍵盤焦點框（不支援 `:has` 的瀏覽器維持原樣）。**通則：`.dp-viewport` 手指捲不動但焦點捲得動，任何 `position: absolute` 的視覺隱藏元素都要有自己的定位祖先。** 這也是 DP-134 記下「backdrop 多 243px 捲動範圍、成因未查」的成因。只改這兩條 CSS；附件行為、其他 sheet、schema、Auth、公告與部署不變。Chromium 重現與驗證，iOS Safari 未驗。見 ADR §2。

- **附件刪除回應遺失（DP-135）：** Supabase deleteEventAttachment 與 DP-134 的 deleteEvent 採同一契約：`delete_event_attachment_with_cleanup` 回傳任何 boolean 都移除該筆附件 metadata 的 snapshot／cache 並 flush 既有清理佇列，非 boolean 回應拒絕並保留最後確認內容。舊行為在「已提交但回應遺失」後的重試會顯示「附件已刪除」卻把附件留在清單與快取，再按也刪不掉。snapshot 已無該筆時仍不送 request。只改這個方法的結果處理；EventSheet 附件 UI、DataProvider、RPC／RLS、schema、Auth、公告與部署不變。取代下一條 DP-134 的「附件刪除的同型 `false` 處理未改」。見 ADR §2。

- **行程刪除確認（DP-134）：** EventSheet 的一般刪除、重複「刪除全部」與「只刪這一次」沿 DP-133 的同一個等待鎖，確認後才關閉；失敗保留編輯畫面與草稿，提示顯示在刪除按鈕正下方並捲入視野，重複刪除重試須重新選範圍，沒有自動重送。DataActions 的 deleteEvent／cancelEventOccurrence 改回傳可等待結果。Supabase deleteEvent 收到任何 boolean 都移除該筆 snapshot／cache 並沿既有附件清理：`false` 代表已無本人擁有的那一列（常見於上次已提交但回應遺失），舊行為會留下重試也刪不掉的幽靈行程；非 boolean 回應拒絕並保留最後確認內容。RPC／RLS、刪除語意、schema、Auth、公告與部署不變。取代下一條 DP-133 的「刪除仍待後續」；其他表單仍待後續，附件刪除的同型 `false` 處理未改。見 ADR §2。

- **行程保存草稿（DP-133）：** EventSheet 的新增／編輯、重複單次／全部與新增待辦等待既有 queue 確認才關閉；失敗保留草稿並提示先確認資料再重試，沒有自動重送。DataActions 四支方法回傳可等待結果，ignored rejection 有 handler、warning／saving／write barrier 分類不變；repository／owner update／RPC／snapshot／cache 邊界不變。等待時 disabled fieldset、保存／取消／背景／window capture Escape 防重複或關閉；settle／unmount 清理，舊請求不能關掉新表單，失焦到 body 才還原保存焦點。原稿無遠端等待，此為狀態擴充，見 ADR §2。無 schema、Auth、公告或部署變更；刪除與其他表單仍待後續。

- **日期等待取消焦點（DP-132）：** 同一日詳情兩個日期表單開啟時，取消按鈕與表單內 Escape 也共用 sheet 的 datePending；避免另一筆日期仍在等待時關閉草稿、返回已停用觸發鈕。settle 後恢復原取消／焦點，失敗保留父子草稿，外層 sheet／其他操作／queue／repository 不變。兩個回歸在修正前失敗，修正只改 EditableTodoDate 兩行；見 ADR §2。沒有 CSS、日期契約、schema、release／公告、Auth 或部署變更。

- **0.4.2 日常能力公告補齊（DP-131，2026-10-06）：** 直接讀取 staging 確認仍為 0.4.1，將未部署 0.4.2 的兩條公告補入全天結束日期／各檢視續日與待辦換日／優先度；仍為六條、177 Unicode code point，所有歷史公告逐欄不變。用既有 generator 同步 version.json，release／schema／worker template 不變。實際 5891034／0.3.0 的 lockfile production build 原始不可捲動 dialog 先以 0.4.0 校準，五種尺寸完整內容／兩顆按鈕均可見；方法與最終發布交接見 docs/deployment.md §5.20。本項未觸發部署，DP-034 未結案。

- **日詳情待辦換日（DP-130）：** 父待辦與已顯示子項的 EditableTodoDate 在列下方提供 native date 草稿／儲存／取消，16px 與既有欄位 token／2px 焦點。Enter 保存，空白／無效保留草稿，同日／取消／Escape 不寫入並還原焦點，Escape 不關外層 sheet；等待防重複提交，失敗保留草稿。awaited rescheduleTodo 沿 DP-129 的單一 queue／確認後移出來源日，父子日期獨立，不自動換頁；移出後焦點回同一 sheet 的完成按鈕，不搶其他控制項或另一 sheet 的焦點。原稿無此控制項，擴充見 ADR §2；取代下方歷史「UI 未接」，未改 schema／release／Auth 或部署，排序與 DP-014 其餘段落未結案。

- **待辦換日契約（DP-129）：** rescheduleTodo／rescheduledTodo 只更新單列 dueDate／updatedAt，沿既有 isDateKey、不轉 timed instant，父子日期獨立且不改排序／完成／優先度／階層。拒絕 null／空白／無效日期；可指定既有無日期列，但 UI／清除日期管理未接。TodoInputError 沿 refused／單一 queue、guest write barrier 與舊長標題相容；account owner-scoped date-only update／single，不 upsert 已刪列，成功才更新 snapshot／cache且不自動重送。ADR §2 記錄契約與界線；UI 接續 DP-130，未改 schema／release／Auth 或部署。

- **待辦優先度（DP-128）：** 日詳情父待辦與已顯示子項的 native select 保存 none／low／medium／high，16px、沿既有欄位 token 與 2px 焦點。只更新該筆 priority／updatedAt，不繼承父值或改排序／日期／完成；新增仍為 none。setTodoPriority 經單一 queue，TodoInputError 沿 refused、guest write barrier 優先，舊長標題原樣保留；account owner-scoped priority-only update／single，不 upsert 已刪列，成功才更新 snapshot／cache且不自動重送。等待時防重複提交，失敗顯示最後確認值與重選提示。原稿無控制項，刻意擴充見 ADR §2；未改 schema／release／Auth 或部署，DP-014 其餘段落未結案。

- **全天日期範圍（DP-127）：** EventSheet 全天模式沿既有日期欄位提供 inclusive 結束日，有效起日變更平移整段、明確結束日變更調整跨度，無效／倒置保留草稿。NewEventInput／EventPatch 可選 endDate 只適用全天，省略保持單日新增／原跨度 patch；allDayDates 的 UTC 欄位只作無時區日期算術。AllDayInputError 沿 refused／單一 queue、request 前拒絕，write barrier 不變。單次保持完整 occurrence，全部依日期位移錨點再套跨度、越界留表單；既有 DB mapping／RPC 不變。ADR §6 記錄原稿沒有此欄位的刻意擴充，未改 schema／release／部署。

- **多日全天行程呈現（DP-126）：** `allDayDisplaySegments()` 在 domain 共用 inclusive 日期／可見 window，月曆、週、列表、日詳情與綜覽均顯示每個佔用日，後續日標「續」。先裁切兩端再展開，UTC 欄位只作無時區日期算術，不可轉成 timed instant 或用裝置日界漏掉日期。續日仍開完整 resolved occurrence，單次取消／替換影響該次整個跨度，綜覽保留 occurrence 去重；上游可見性／例外結果維持。原稿無多日全天模型，本項是 DP-114 的一致性擴充；ADR §6 記錄。不改 schema、repository、release 或部署。

- **0.4.2 公告補正（DP-122，2026-10-05）：** 尚未部署的 0.4.2 公告合併成 6 條，補上隱私說明／待辦改名／標題上限，保留已合併日常功能與全部歷史公告。真正 staging 最後一版 0.3.0（5891034）production build、原始不可捲動 dialog 以 0.4.0 校準後，五種尺寸的完整 dialog 與兩顆按鈕均在 viewport；932×430 為 15..418.5，375×667 為 90.1..576.9。方法與發布交接見 docs/deployment.md §5.19。release／schema／worker template 不變，agent 未部署。

- **標題上限與舊遊客資料（DP-125）：** 事件／待辦新標題限制 300 Unicode code point，`domain/titles.ts` 共用於 validation、mutation 與四處輸入；native maxlength 為 UTF-16 外圍 600，真正上限用 code point 判斷，超限提示並保留草稿。TitleInputError 沿 refused 保持 ready／繼續 queue。舊遊客 v1–v4 超長標題仍可讀／備份，不裁切；本機寫入只保留同種類同 id 未變的超長標題，編輯須縮短，JSON 取代與新 ICS 列保持嚴格、ICS 附加保留既有列。帳號快取含 v3 migration 皆嚴格。規則見 ADR §2；未改 schema／release／部署。

- **待辦標題編輯（DP-120）：** 日詳情父待辦與已顯示子項的 EditableTodoTitle 提供 inline form，24×24 編輯按鈕／16px 輸入沿現有卡片欄位 token。Enter 保存，空白拒絕，未變更／取消／Escape 不寫入、還原焦點，Escape 不關外層 sheet；awaited 保存防重複提交，可恢復失敗保持草稿。renamedTodo 保留日期／完成／階層／排序／日曆／分享範圍；renameTodo 經既有單一 queue，guest write barrier、account title-only owner update／single，不 upsert 已刪除列，成功才更新 snapshot／cache且不自動重送。corrupt／future 復原與帳號切換仍優先。新產品決策見 ADR §2；日期／優先度／排序仍未接，未新增 schema／RPC／release／部署。

- **JS／CSS 產物大小上限（DP-119）：** 根目錄 performance-budget.json 保存 JS 800 KiB raw／220 KiB gzip、CSS 128 KiB raw／32 KiB gzip 的總量上限；check:build 計算 dist 全部 JS／MJS（含 worker）與 CSS，按 bytes 與逐檔 gzip 加總，配置缺漏／無效、讀取失敗或超限皆拒絕。既有 CI 三種 base 與 deploy 閘門沿用，不改 workflow；調高上限須在 PR 解釋原因，不能移除限制。npm test 成功後的 posttest 跑七項 Node 回歸，不改 Vitest 選檔；詳見 docs/performance-budget.md。Vite 500 kB chunk 警告維持，本項不代表首屏下載或實機效能、DP-034 父項未完成。

- **資料與隱私說明（DP-118）：** 設定的 `DataPrivacyCard` 放在資料備份之後，預設收合，沿 canonical 卡片／native details 與既有 2px summary 焦點；Enter／Space 可操作，只有說明文字，沒有 storage／repository／Auth handler 或追蹤請求。內容交代 guest／account／Supabase Auth／Google、私人附件、未加密且不含附件的備份、登出不清雲端或 cache、逐筆／父待辦刪除與日曆內容搬移，並明示尚無一鍵清空／帳號刪除。事實對照表見 docs/data-and-privacy.md，變更能力時須同步文案；不把這張卡片當成正式政策、完整刪除能力或 DP-034 父項已完成。未改 schema／Auth／release／部署。

- **日常功能發布準備（DP-117）：** 2026-10-04 直接讀取 staging `version.json` 確認線上已是 v0.4.1「更新提示與資料保護」，因此 0.4.1 公告自此也不可回寫（下方「0.4.1 尚未部署」是歷史）。本次將 App release 升為 v0.4.2「日常安排更完整」，只更新 package／lock 版號、新增公告並以既有 generator 產生 version.json／sw.js；schema 仍為 v4、worker template 不變。公告涵蓋 DP-072／075／083／111–116，不保證 DP-077 真機拖曳回饋。`check:release-notes` 對實際線上 0.4.1 通過，歷史條目逐欄不變。這是發布候選準備，未觸發 owner 手動部署，不能把 main 已合併視為 staging 已更新；DP-034 父任務仍未完成，交接見 docs/deployment.md §5.18。

- **日詳情待辦子項（DP-116）：** `DayTodoCard` 依原稿 :561 接回展開／收合、完成比例、新增／勾選／刪除；native button／form 支援鍵盤。`NewTodoInput.parentId` 沿既有欄位，新增僅一層，繼承父項日期（含 null）／日曆／分享範圍，完成狀態各自獨立。`todoGroupsOn()` 只分組原本在該日期可見的列，以 sortOrder／迭代遍歷保留多層與跨日期匯入資料；不改持久化文件或綜覽統計。DP-115 的子樹刪除仍為唯一邊界。父項被前一個 queued delete 移除等輸入拒絕用 `TodoInputError`，DataProvider 保留 ready snapshot、提示未保存並繼續 queue；不可把其他資料驗證錯誤一起視為可恢復。拖曳 handle、優先度與寵物 XP 仍未接，未新增 schema／RPC／部署。830 個單元案例／59 檔通過；4 個新 browser cases 以 America/New_York 裝置時區＋Asia/Taipei display timezone 驗證，帳號仍用 dev-only FakeSupabase。

- **週檢視全天列（DP-114）：** 依 2026-10-04 持續開發／日常使用優先委託，週格在日期下方顯示全天 occurrence；沒有全天事件時不佔列。沿週 window resolver 的可見性／例外結果，inclusive 多日每個佔用日各畫一次、後续日標「續」，只走當週七天、不拆 domain event。點擊／Enter／Space 開啟具體 occurrence，編輯／刪除沿既有 scope。日期沒有 timezone，不參與 timed rail／now line／drag／resize。這是刻意擴充原稿，取代下方歷史「週檢視不顯示全天事件」的現況；決策見 ADR §6。未新增 schema 或部署。

- **待辦子樹刪除（DP-115）：** `withoutTodo()` 對齊既有 PostgreSQL parent composite FK 的 ON DELETE CASCADE，以 parent index／迭代遍歷清除完整子孫、保留其他待辦；guest 文件與 authenticated snapshot 共用此邊界，遠端仍只發一個 owner-scoped delete，由 DB 原子 cascade。不能退回只過濾單列或並行發子項 delete。FakeSupabase 獨立模擬該 FK，雙 adapter reload 與 UI 已覆蓋匯入的子項／孫項；不新增 schema／RPC 或實際雲端驗收。子項新增 UI 為後續任務。

- **帳號與版本主題（DP-113）：** `src/shell/accountAndDialogs.css` 讓設定的帳號／版本（`.dp-account-blocks`）與 Auth、更新提示／公告吃既有 canonical 卡片／dialog／欄位／按鈕 token，已移除 `shell.css` 紫色 scaffold bridge。原稿無 Auth／PWA 畫面，依自主開發委託採用原稿控制項而保留自有資訊架構與 dialog 寬度，不宣稱逐像素還原。遮罩留在 viewport 內，dialog 本身可捲動且最多佔可用高度，帳號卡片可換行。舊 `styles.css` 仍有其他歷史樣式，不在本次廣泛清理；不得重新加回固定紫色變數。六套主題 palette、Auth／更新行為、資料、版本與部署不變；DP-014 父項仍未結案，決策見 ADR §3。

- **跨午夜週格拖曳（DP-072）：** `weekDrag.ts` 以完整起訖在 display timezone 逐端做日曆日／牆上分鐘位移，`EventPatch.timedInterval` 是純領域資料邊界，不送新 DB 欄位或 RPC 參數；與舊 date/start/end/allDay/timezone/wallTimeZone 互斥，僅適用 timed event 且正區間。任一片段移動整筆，最後片段才能 resize；24:00 結束也用完整區間，resize 保留起點精確 instant、短於 15 分鐘拒絕。`WeekView` 重切所有預覽片段但不變動 rail；pointercancel 與不同 pointer id 不可提交，重新掛回原 block 後在 scope 捕捉焦點前還原。全部 scope 以 `seriesIntervalForDrag()` 按事件時區的時鐘／日數套回系列錨點（含 DST），不複製 occurrence 的日期，也不拆 domain event。ADR §6 的舊「跨午夜不可拖曳」註記已由此決策取代；DP-077 真機即時回饋仍未驗證。

- **多日 timed event 保存（DP-112）：** `applyEventPatch()` 在未變動日期／時鐘／timezone 時保留精確起訖 instant（秒數與 DST 回撥後一次也不重算）。真正變更時間時，保留來源在操作時區超出一般同日／隔夜推導的日數跨度，結束日重新解析而非固定 `+24h`；一般隔夜推導仍保留，不能把跨時區系列拖曳後的 1 小時夜班拉成 25 小時。sheet 讀事件自身時區，grid 讀 display timezone，顯式換時區仍沿重錨契約。`eventTimezoneOptions()` 接收原 startsAt，未變動的回撥讀法顯示實際偏移。未新增 patch／schema；跨午夜格線拖曳仍屬 DP-072，真正時間變更與 occurrence expansion 維持既有分鐘精度。具體規則見 ADR §6。

- **事件時區控制項（DP-111／DP-014 子項）：** `EventSheet` 的 timed event 使用原稿五個城市／順序的 `.cal-field` select，新建由 `preferences.timezone` 預選、編輯用 `event.timezone`。`eventTimezoneOptions()` 依事件日期／開始時鐘讀取各城市 GMT（含 DST），不完整欄位只顯示城市，清單外已保存值在整次編輯內保留；Intl 計算以 `useMemo` 只隨時鐘／日期／初始時區重算。更換時區保留日期與時鐘，送既有 `EventPatch.timezone` 重新錨定 instant，未更換不送；單次／全部仍經 scope。全天／待辦沒有 timezone，控制項隱藏且不送值。選擇語意／原稿差異見 ADR §6，DP-014 其餘段落仍未結案。

- **中文快速新增（DP-075）：** 依 2026-10-03 自主開發委託，在原稿時刻語法上加入中文數字時分、兩／两、半／一刻／三刻與全形數字。`quickAdd.ts` 只正規化 clock token，不改標題／地點中的數字；小時 0–23、分鐘 0–59，無效整段與「差十分」等相對時刻保留在全天草稿，不截取合法尾段。`CalendarScreen.submitQuick()` 非空輸入即交給 sheet，即使解析後標題為空；確認前不保存，儲存沿用 DP-076「新事件」fallback。這是刻意擴充原稿，範圍與歧義規則見 ADR §6；placeholder 與日期／地點／重複／提醒解析順序維持，提醒實際保存仍等待 DP-042。

> Fill only after the project has stable facts worth preserving.

- **重複週格拖曳（DP-083）：** 依 2026-10-03 專案擁有者自主開發／自行合併委託，採拖曳後詢問單次／全部的建議。單日重複色塊可拖曳與拉長度，`WeekView.onDragEvent` 帶具體 `OccurrenceTarget`，`CalendarScreen` 在確認範圍前不寫入。單次走既有 `replaceEventOccurrence()`；全部先在 display timezone 解析具體 occurrence，再換算為事件時區的起訖時鐘及日期位移套到系列，不把後面那次的日期複製成錨點，且保留原 timezone（含錨點與該次 DST offset 不同）。共用 `ScopeDialog` 將 Tab 留在按鈕內，關閉時恢復焦點。這是刻意偏離原稿 `wkUp()` 靜默拆出那一次；ADR §6 與任務板留有理由。跨午夜拖曳與 iPhone 回饋仍分別屬 DP-072／077。

- **Write ordering:** DP-062 後，DataProvider 對畫面維持 fire-and-forget actions，但以單一 promise queue 讓所有 repository mutation 依 UI 呼叫順序落地；失敗沿用既有狀態且不會毒化 queue。這是 DP-026 接遠端 adapter 前的固定前置，不可退回並行 request 後只丟棄 stale response。
- **Main entry points:** `index.html` → `src/main.tsx` → `src/App.tsx` 是新的可執行 App；`src/domain`、`src/storage`、`src/pwa` 分別負責核心型別／日期、資料保存、版本更新。DP-012 後 `src/domain/types.ts` 是 Calendar／Event／Recurrence／Exception／Todo／Sticker／Preferences 的 canonical contract，`validation.ts` 負責 runtime validation，`databaseMapping.ts` 以 generated DB types 明確轉換 Supabase rows／inserts，`eventTime.ts` 集中 UI wall time 與 ISO instant 的邊界。DP-013 後 `src/data` 是資料邊界：`repository.ts` 的 `DayPopRepository` 是 UI 唯一可依賴的合約，`DataProvider`／`dataContext` 是取得資料與寫入的唯一 seam，`SessionDataProvider.tsx` 等 Auth initial session 完成後依 user id 選擇 guest／authenticated adapter，`cachedSupabaseRepository.ts` 提供同帳號版本化快取與短暫讀取失敗 fallback，`src/domain/mutations.ts` 是兩個 adapter 共用的純領域編輯。DP-025 後 `src/legacy` 負責偵測／驗證 `calpet.v2`、建立 canonical import plan、預覽與呼叫一次性 RPC；設定頁只消費 `LegacyImportContext`，不直接理解 legacy 或 DB shape。DP-056 後 `src/domain/dataTransfer.ts` 是 JSON／ICS 文件與 tagged import command 的純邊界，`src/browser/dataTransferFiles.ts` 才能碰 `Blob`／`FileReader`，設定頁四個按鈕與 `DataImportDialog.tsx` 負責選檔、預覽及確認。DP-018 後 `src/theme` 保存六套 canonical theme tokens，ThemeProvider 透過 `DataProvider` 保存 theme id 與 system／light／dark、即時解析 system preference 並同步 theme-color；DP-052 的自託管字體清單在 `fonts.css`，`src/shell` 提供 App viewport／safe-area／頂部狀態區／底部四分頁與桌面手機展示框，`src/screens` 存放各分頁畫面。DP-051 後 `src/screens/calendar` 是依原稿搬移的日曆 shell（header、segmented control、快速新增、連續捲動月格、FAB、浮動寵物位置），`src/domain/lunar.ts` 與 `src/domain/quickAdd.ts` 是自原檔逐行移植的農曆與快速新增解析器。`src/domain/date.ts` 是本地時間層（date key ↔ `Date`、週起始、月格），`src/domain/eventTime.ts` 是牆上時間 ↔ instant 的唯一轉換點；跨午夜行程在 `timedEventFromWallTime()` 以「隔天重新解析同一個牆上時鐘」順延，不可改回固定 `+24h`（DST 當晚的本地日不是 24 小時）。DP-055 後 `src/domain/stickerGlyphs.ts` 保存原檔的 63 個貼圖 glyph 與月格字級規則，月格／日詳情／綜覽三處貼圖 UI 均已接上真實資料。DP-059 後 `src/domain/calendars.ts` 是日曆調色盤與可見性／顏色查詢的單一來源，設定的「我的日曆」與 `src/screens/CalendarEditDialog.tsx` 提供日曆 CRUD；刪除日曆會把其事件／待辦／貼圖移到倖存的預設日曆而不是留下孤兒資料。設定分頁的帳號／版本區塊仍是尚待校正的工程骨架，不是視覺驗收基準。`日曆桌寵 Calendar Pet.dc.html`、generated `support.js` 與 `寵物素材規範 Pet Asset Spec.md` 的責任、優先序及 2026-08-02 handoff 狀態記錄於 `docs/claude-design-source-of-truth.md`，功能清單記錄於 `docs/prototype-behavior-baseline.md`。 DP-027 後 `src/domain/recurrence.ts` 集中 RFC 5545 RECUR validation、DST-safe occurrence expansion 與 exception resolution，`src/domain/ics.ts` 是 DayPop canonical event 與 iCalendar 間的純轉換邊界；事件 sheet 控制項與畫面 occurrence wiring 仍待 DP-014。
- **Storage / data model:** 新 App 的遊客資料以 `daypop.user-data` envelope 保存，含獨立的 `schemaVersion`、revision 與 timestamp；UI 經 `LocalDayPopRepository` 存取。DP-012 已將 envelope 升到 schema v2：首次啟動與 v1 migration 會持久化一個 UUID default calendar，舊 event／todo 會轉成 canonical contract，timed event 使用 ISO instant＋IANA timezone，全天 end date 為 inclusive；DP-018 再升到 schema v3，保留 v1 fixture 並新增 v2 fixture，v2→v3 只補上 `themeId = manga`，其餘偏好、revision 與 timestamp 不變。DP-016 的 write barrier 讓 `readUserData()` 回傳 `ready`／`corrupt`／`future` 三態，repository 在後兩者拒絕寫入；DP-017 的 `AppStorage` 在 localStorage probe 或 session 寫入失敗時降級為帶持續警告的 `MemoryStorage`。DP-025 已接上舊 `calpet.v2` 的一次性登入匯入：成功、失敗與重試都保留原 key，`CALPET_FIRED` 保持原樣；AI key、邀請人與附件不進 payload。Supabase 已套用 profiles、preferences、calendars、events、exceptions、attendees、attachments、todos、stickers 的 migrations、owner RLS、FK indexes 與 calendar child `NO ACTION` constraint alignment；DP-018 再以第五檔 migration 將 `month_weeks` 改為 `fixed_six_week_grid`、加入 `theme_id`，並由遠端 schema 重新產生 `src/lib/database.types.ts`。DP-036 的第六檔 migration 將兩種提醒陣列限制為最多 10 項、每項 0–10080 分鐘且不可含 `null`；九張公開資料表的 insert trigger 強制 DB timestamps，update trigger 保留 `created_at`，repository mapping 仍不送 client timestamps。遠端 generated types 與 repo 一致。DP-026 已將登入帳號接到 `SupabaseDayPopRepository`：Supabase 是 durable store，`daypop.account-cache.<encoded user id>` 只保存該帳號最後一次遠端確認的 schema v3 文件，與 guest key 分離且永不整份回傳雲端；有效同帳號快取只在短暫 remote load error 時顯示並持續警告，corrupt／future／account mismatch 快取 fail closed。遠端寫入失敗保留最後確認 snapshot、標示未同步且不自動重送；missing bootstrap rows 不以快取掩蓋，也不由前端另建預設資料。 DP-027 的第七檔 migration 在 `user_preferences.timezone` 與 `events.timezone` 寫入時以受控 trigger 驗證 PostgreSQL 支援的 timezone；function 採 security invoker、空 `search_path`，並撤銷 client role 直接 execute。DP-024 的第八檔 migration 在非 exposed 的 `daypop_private` schema 建立單一 account bootstrap helper 與 `auth.users` trigger；新帳號同一交易建立 profile、canonical preferences 與一個預設 calendar，舊帳號只補缺列、不覆寫既有值，重試以 transaction advisory lock＋conflict-safe insert 保持 idempotent。DP-025 的第 9–11 檔 migration 為 profile 增加 legacy fingerprint／timestamp，建立原子 import RPC，並以 `SECURITY INVOKER`＋transaction-local `pg_temp` marker guard 保持 owner RLS、阻擋直接偽造 completion marker；同 fingerprint retry idempotent，不同文件與中途失敗皆 fail closed。遠端／repo 現為 11 檔 migration，generated types 一致。
- **Attachment storage / schema v4:** DP-028 後 `src/domain/attachments.ts` 集中附件 MIME／10 MiB／path contract，`EventSheet` 只在 authenticated adapter capability 存在且事件已建立時顯示 upload／download／delete。Guest 與 account cache envelope 升至 schema v4；v3→v4 只加入空 `eventAttachments`，不改既有資料。Supabase 現有 private `event-attachments` bucket、owner-only Storage policies、`event_attachments` metadata constraints 與 `attachment_cleanup_jobs` durable compensation queue；上傳 finalize、附件刪除與事件刪除皆經 SECURITY INVOKER、空 `search_path` RPC，前端不保存 signed URL 或 binary。DP-056 的第 14 檔 migration 再加入 JSON replace 與 ICS append 兩支原子匯入 RPC；authenticated adapter 只送 allowlist payload，RPC 成功後重新 load 才更新 snapshot／account cache，RPC 或 reload 失敗都不寫 cache、不自動重送。遠端／repo 現為 14 檔 migration、10 張 public tables RLS 全開，generated types 一致。
- **Test coverage:** Vitest 目前有 491 個單元案例（50 個檔案）；DP-023 新增 AuthDialog 註冊完成回歸，確認 verification email 送出後立即清空 Email／密碼、移除 form／Google／重複提交入口並只顯示完成狀態。DP-056 的 `src/domain/dataTransfer.ts` 是備份／`.ics` 匯入匯出的純邏輯層（永不碰檔案系統或 repository，只產生 `ImportPlan`，套用前不寫任何東西），29 項測試涵蓋 JSON 與 ICS 的 round-trip、格式與版本拒絕、canonical 驗證失敗、上限、附件不隨備份外流、AI key 不得夾帶，以及 `.ics` 附加時只重新命名匯入列而非既有列；另有 13 項 authenticated RPC／cache／browser file IO／設定頁 preview 測試，涵蓋最小 payload、collision remap、成功後 reload、RPC／reload 失敗不更新 cache且不重送、四個按鈕、JSON 取代與 ICS append。390×844 Playwright smoke 另驗證真實 JSON download→reselect→preview→confirm，dialog 初始焦點、版面與 console 0 error／warning。DP-035 補上先前完全沒有測試的 `src/pwa/useAppUpdate.ts`，以 fake timers、fetch spy、`vi.stubEnv('PROD', true)` 與 stub 的 `navigator.serviceWorker` 進到只有 production 才存在的那條分支，涵蓋自動檢查的 5 分鐘節流、手動檢查不受節流、30 分鐘 timer 照跑與卸載後停止；DP-062 將既有 DataProvider race characterization 改為序列化回歸，涵蓋下一筆在前一筆 settled 前不啟動，以及 rejection 後 queue 仍會繼續並恢復 ready；DP-013 另加雙 adapter 平行合約測試、Supabase adapter 的 mapping／owner 範圍／失敗不落地，以及以 React `act` 驗證 `DataProvider` 與整棵 App 掛載的元件測試；除原有版本比較、storage fail-closed／降級、Supabase env、theme、農曆、快速新增、週檢視與搜尋／綜覽外，新增 canonical domain 日期／instant／IANA timezone validation、domain ↔ generated DB mapping、v1→v2→v3 migration、stable default calendar 與跨午夜轉換。DP-063 補上先前完全沒有測試的兩個日期／時間邊界模組：`src/domain/date.test.ts` 涵蓋 date key 往返、跨月／跨年／閏年、兩種週起始、`buildMonthGrid` 42 格與 `weeksBetween` 取整，並以「走完一整年、每一步都必須剛好一天」在任何時區涵蓋 DST；`src/domain/eventTime.test.ts` 以明確 IANA 時區涵蓋半小時偏移、春季快轉／秋季回撥、不存在與重複的牆上時間與跨午夜長度。另有搜尋畫面、日詳情地點與 `CalendarScreen` focus 驗證的元件回歸測試。DP-018 後以 MCP 執行 repo 同一份 7 項 rollback pgTAP，驗證新偏好預設、owner RLS、跨帳號隔離、child ownership 與刪除帳號 cascade；transaction 內暫時建立的 pgTAP extension、固定測試帳號與資料均確認已回滾，security advisor 仍為 0 警告。DP-036 再將 repo pgTAP 擴為 15 項，並以額外 12 項 transactional assertions 驗證 reminder bounds、time ordering、server timestamps、RLS 與 cascade；固定假帳號／事件確認 rollback，遠端 6 檔 migration 與 security advisor 0 警告保持一致。`supabase test db --linked` 在此 Windows 環境仍要求 Docker，因此未宣稱 pgTAP CLI 已重跑；登入介面另以 390px Playwright smoke test 驗證 provider 狀態與敏感欄位關閉後清空，正常網路流程 console 0 error／warning。DP-031 後 repo CI 已在 PR 與 `main` 自動跑 `npm ci` 與 lint／typecheck／unit／build，DP-030 再加入 mobile／desktop Chromium e2e；Supabase reset／pgTAP CI 原本未建立（DP-033 於 2026-08-22 結案時已不掛在它名下），**2026-09-29 已另立 DP-084 並加入 CI**：runner 內只啟動本機 Postgres，跑 `db reset` 與 5 檔 pgTAP（150 個斷言）；只啟動 Postgres 與完整 stack 在 reset 後的 auth／storage schema、extension 與 schema 清單經本機比對逐行相同。 DP-027 新增 RFC rule、DST spring-forward、monthly skip、過密 window fail-closed、single cancel／replacement idempotency、series cleanup 與 ICS RRULE／EXDATE／RECURRENCE-ID／inclusive-exclusive round-trip 回歸；DP-024 再將遠端 repo pgTAP 擴為 36 項，涵蓋 account bootstrap defaults、重試 idempotency、既有值保留、private function 權限與原有 RLS／cascade。36／36 rollback 通過，暫時 extension 與固定假帳號／資料確認不存在；8 檔 migration、9 張表 RLS、generated types 與 security advisor 0 均一致。 DP-026 新增 session 初始化、登入／登出、帳號切換、同裝置重登、same-account cache、corrupt／future cache、remote load／write failure 與真實同步狀態回歸；MCP rollback transaction 另驗證 calendar／event／todo＋subtask／sticker／preferences CRUD、reload 與跨帳號 RLS，結束後固定假帳號／公開資料為 0，8 檔 migration、9 張 RLS 表與 advisor 0 不變。DP-025 新增 legacy validate／preview、重複 ID remap、AI key 排除、fingerprint、RPC success／failure retry 與原始 bytes 保留回歸；repo 同一份 24 項 rollback pgTAP 驗證 invoker RPC、marker guard、原子 rollback、same-fingerprint retry、different-document 拒絕與跨帳號隔離。完成後固定假帳號／public rows、pgTAP extension 與 temp guard 均不存在；遠端 11 檔 migration、9 張 RLS 表、generated types 與 security advisor 0 一致。
- **DP-056 database verification:** 第 14 檔 migration 由專案擁有者以 CLI list／dry-run／push 套用；MCP 未下正式 DDL、未 remote reset、未查正式資料。兩支 RPC 均為 SECURITY INVOKER、空 `search_path`，只有 `authenticated` 可執行。Repo `daypop_import.test.sql` 經修正 fixture enum 與 PostgreSQL 17 `proconfig` 預期後，39／39 rollback pgTAP 通過；固定假帳號、所有 public 測試列、cleanup jobs、pgTAP／dblink extension 殘留皆為 0，security advisor 0，generated types 與 repo 忽略 CRLF 後逐字一致。RPC 內兩張 child table 的 `ShareLock` 已由測試確認；Supabase MCP 會序列化同專案 SQL，`dblink` 又要求不可取得的 DB 密碼，因此未宣稱真正兩連線 interleaving 已自動化，後續不得把這項限制改寫成已通過。
- **DP-028 verification:** Repo 的 `attachment_storage.test.sql` 以 36 項 rollback pgTAP 驗證 private bucket、最小權限、owner／cross-owner RLS、upload staging／finalize、附件與事件刪除 cleanup。第一輪測試抓到 `ON CONFLICT` 與 queue visibility 衝突，已用第 13 檔追加 migration 修正而未回寫歷史；正式 36／36 通過，固定假帳號／metadata／Storage object 殘留為 0，security advisor 0，遠端 generated types 18,354 字元與 repo 一致。 `supabase test db --linked` 仍因本機 Docker 前置而未宣稱通過，正式驗證由 MCP 執行 repo 同一份 rollback SQL。
- **Browser e2e coverage:** DP-030 新增 3 個 Playwright specs，於 mobile Chromium（390×844）與 desktop Chromium（1280×900）形成 6 個 browser cases：真實 guest 入口驗證 event／todo CRUD 與 reload 持久化；dev-only auth harness 以真實 App／SessionDataProvider／authenticated repository 搭配既有 FakeSupabase 驗證登入、帳號同步、event、附件 signed URL／刪除與登出隔離；responsive case 驗證 canonical 手機／桌面 shell、sheet 與設定頁不溢出。全案例要求 console error／warning 與 page error 為 0。harness 不進 production build，不使用 secret、真實帳號、正式資料或 Supabase MCP；DP-023／033 的真實 Email／Google provider、redirect、identity linking、帳號保存與 session restore 已由專案擁有者於 2026-08-22 在 staging 驗證通過，RLS 與實機瀏覽器仍分別由 pgTAP 與 DP-032 負責。DP-089 再加入 `e2e/update-dialog.spec.ts`：手機專案在 932×430 與 375×667 以刻意加長的假公告驗證更新對話框完整在畫面內、本身可捲動，捲到底後能以畫面座標按「稍後提醒」關閉（桌面專案跳過）。**DP-108（2026-10-03）**：`vite.config.ts` 的 `server.watch.ignored` 排除 `output/playwright/`。Playwright 產物（production fixture 的 build、報告）累積到數萬個檔案後，dev server 啟動時的檔案監看器會在主執行緒走訪它們，模組請求排不到，本機第一個 dev harness 案例因此逾時；CI 是新 checkout，不受影響。不要把那個排除拿掉，也不要把原始碼放進 `output/`。**DP-109（2026-10-03）**：production fixture 的兩份 build 改建在系統暫存目錄，讀進記憶體後立即刪除，不再在 `output/playwright/production-updates/` 累積（先前已累積 168 個目錄、約 1 GB）。
- **跨午夜呈現（DP-064）：** 專案擁有者 2026-08-14 定案，規則與落點記於 `docs/architecture-decisions.md` §6「決策（DP-064）」：衝突偵測改用 instant 半開區間 `[start, end)`；日／週／月呈現在本地午夜切成 display segments（隔天標「續」），但**不得拆成兩筆 domain event**；月格也要顯示 continuation；綜覽「共 N 筆」依 occurrence ID 去重；週檢視固定的 07:00–22:00 要能動態延伸，不可把 23:00 夾到 22:00。該節另定死三件實作前必須先有答案的事：**display timezone 唯一來源是 `preferences.timezone`**（它是必填且已驗證欄位，無效即 fail closed，不得靜默退回裝置時區；裝置時區只用於尚未有 canonical preferences 的首屏），決定日格歸屬、午夜切點、now line 與拖曳座標（**這會改變現況的 `eventDate()` 行為**）。解析基準依操作而異：**事件 sheet 改時間用 `event.timezone`，週格拖曳用 display timezone**（拖曳指定的是格線上的顯示座標；用事件時區解析會讓跨時區事件跳好幾小時，用固定 instant delta 則在 DST 出錯）。這兩條路徑**不得暗自改寫 `event.timezone`**；使用者在事件 sheet 明確更換時區仍依既有 `EventPatch.timezone` contract 重新錨定（DP-014），本決策不封死它；**去重與片段 identity 一律用 `ResolvedEventOccurrence.key`，不可用 `event.id`**；週格範圍以 `start = min(7, floor(最早))`、`end = max(22, ceil(最晚))` 推導並 clamp 0–24，午夜在第一天記為 `24:00`。實作前先讀該節，不要各檢視各改各的。**2026-08-16 已全部完成**：`src/domain/displaySegments.ts` 是切片、衝突、去重與範圍推導的單一來源，月格／綜覽／列表／日詳情／週格五處都改吃它；`timeGrid.ts` 的 `GRID_START_HOUR`／`GRID_END_HOUR` 已刪除，`blockGeometry()`／`gridHeight()`／`hourRail()`／`nowLineTop()` 一律收該週推導的 `HourRange`（刪常數而非留預設值，是為了讓編譯器找出每一個呼叫端）。**新的已知限制**：跨午夜事件的片段在週格不提供拖曳與拉長度（點擊開啟事件），因為單一天的 `date`＋`start`／`end` patch 無法表示跨日 occurrence，硬套會靜默把事件截短；已登記 DP-072，單日事件的拖曳不變。**`blockGeometry()` 的 20px 下限改為在裁切之後才套**（原檔是之前），否則整塊被裁到軌上方時會回傳負高度 —— 拖曳預覽做得到，因為 `moveRange()` 夾的是日內而非軌內。這是刻意偏離原稿，記在 `docs/prototype-behavior-baseline.md` 與 ADR §6。
- **Deployment / cache notes:** `main` 已含 PR #1 的 PWA 基線與 PR #2 的 Supabase Auth／schema 基礎。PWA 使用 `release-notes.json` 產生不快取的 `version.json` 與版本化 `sw.js`；新 service worker 等使用者選擇才 activate，只刪除舊 `daypop-app-shell-` cache。DP-065 後版本為 v0.3.0「完整日曆與雲端保存」，release note 已涵蓋整段日曆搬移、帳號保存、附件、legacy 匯入與安裝圖示。**v0.3.0 已於 2026-08-13 首次部署到 staging，因此該版 release note 自此不可回寫修改**：`release-notes.json` 的 0.3.0 條目不可修改；`version.json` 與 `sw.js` 是 generated outputs，只能隨新版本號重新產生，不得在仍為 0.3.0 時回寫成不同內容。後續變更一律開新版本號。`version.json` 曾固定輸出沒有人讀的 `dataSchemaVersion: 1`（實際 user-data schema 為 4），DP-067 已隨 v0.4.0 將它移除。DP-030 已建立無 secret 的 mobile／desktop Chromium e2e 品質閘門；DP-019 後 `public/icons/` 已備齊由 `daypop.svg` 產生並提交的 `any` 192／512、`maskable` 192／512 與 180×180 Apple touch PNG，`npm run icons` 可重新產生、`npm run check:build` 會核對尺寸與不透明度，實機主畫面外觀仍待 DP-032 在 staging 驗收。DP-033 已把 staging 定案為 GitHub Pages 專案站台 `https://yoyocadence.github.io/DayPop/`：`.github/workflows/deploy-staging.yml` 只由人工 `workflow_dispatch` 觸發，先跑與 PR 相同的品質閘門，再以 `--base=/DayPop/` 建置後發布；子路徑部署一定要用絕對 base，因為 `getAuthRedirectUrl()` 是以 `window.location.origin` 解析 `BASE_URL`，`'./'` 會把 `/DayPop/` 前綴丟掉。`npm run build` 的 `postbuild` 產生 `dist/404.html` 作為 SPA fallback，`npm run check:build` 另會擋下 dev-only e2e harness、缺少的 404.html 與私密金鑰材料。`src/lib/supabaseKey.ts` 是判斷 Supabase 金鑰是否可進前端的單一來源（只接受 `sb_publishable_…` 或 `role === "anon"` 的舊式 JWT，其餘含未知格式一律拒絕），由 `vite.config.ts`（建置期，throw 且不產生輸出）與 `src/lib/env.ts`（執行期）共用；`check:build` 再獨立掃描 `dist/`，並會解碼 JWT，因為舊式 `service_role` 金鑰的 role 藏在 base64url 裡、字串搜尋找不到。Pages 不能設 response header，因此 CSP 維持 meta 交付且不涵蓋 `frame-ancestors`。**staging 已於 2026-08-13 上線**（run `31702877290`）：專案擁有者已完成開啟 Pages、兩個 repository variables 與 Supabase Site URL／redirect allowlist；線上驗收結果與已知行為（Pages 供應 `404.html` 時 HTTP 狀態碼就是 404、實測沒有 CSP／XFO response header）記於 `docs/deployment.md` §5.1–5.3。**需要真實 Email／Google 帳號的註冊、驗證信 redirect 與登入後資料保存已於 2026-08-22 由專案擁有者在 staging 驗證通過，DP-023 與 DP-033 均已結案**（見下一條 live Auth closure）；實機瀏覽器 QA 屬 DP-032，仍未完成。**尚不得宣稱已達可開始日常使用的驗收點**。DP-068 已把 `index.html` 手寫的 manifest／icon／apple-touch link 改用 `%BASE_URL%`：Vite 只改寫它自己產生的標籤，原本的 `./` 會相對於當下路徑解析，深層 fallback 網址下三者都 404、manifest 還會拿到 HTML。相對 base 仍展開成 `./`（`dist/` 維持可從任何路徑打開），`check:build` 另會檢查「絕對 base 時三個 link 必須共用同一個 base」。**此修正已隨 2026-08-16 那次部署上線。**DP-069 已把月格改成 roving tabindex（`MonthView` 只保留一格 `tabIndex=0`，方向鍵／Home／End／PageUp／PageDown 移動焦點但不改選取，走到 buffer 邊界會自動延伸並沿用既有捲動補償；`src/domain/date.ts` 的 `addMonths()` 夾到目標月份長度，避免 PageDown 跳過二月），到底部分頁列由 382 次 Tab 降為 12 次。DP-032 的模擬環境第一輪已完成（`docs/mobile-qa-2026-08-13.md`）：溢出、觸控目標、focus ring、dialog 語意、縮放、safe-area 與 reduced-motion 皆通過，另開出 DP-069（371 個日期格佔滿 tab 順序，**已修**）、DP-070（農曆 8px 對比 2.81:1，**一般日已修**：新增 `--lunar-muted` 語意 token，六套主題 × 淺／深色各一個值，共用的 `--faint` 未動、字級維持 8px；`src/theme/lunarContrast.test.ts` 對月格四種背景驗證 ≥ 4.5:1。這是 `themes.ts` 唯一**不是**逐字移植原稿的欄位。**節日不在保證範圍內**：依定案仍用 `--accent`，12 組裡有 7 組低於 4.5:1，最低 2.52:1，屬刻意保留的已知例外，清單釘在同一份測試）、DP-071（缺 h1 與 `main` landmark，**已修**：app body 改 `<main>`、四個分頁各一個 `<h1>`，CSS 以 `margin: 0`／`font-weight: inherit` 抵銷 UA 預設，改動前後量測完全相同）；真機與螢幕閱讀器仍待專案擁有者。DP-064 的跨午夜呈現（含週格的動態時刻軌）已於 2026-08-16 全部完成。**DP-064／068／070／071 已在 2026-08-16 一併部署到 staging**（deploy run 的 head 為 `3f404d03`，即當時的 `main`），並已對線上實測跨午夜呈現：軌 00:00–24:00、23:00 色塊完整落在格線內、隔日顯示「續」、月格一致、console 0 error／warning。版號仍為 0.3.0，未重新產生 `version.json`／`sw.js`。DP-033 已於 2026-08-22 結案（Vite base path、SPA／OAuth redirect、PWA scope 與登入資料保存 smoke test 均已通過），**release runway 剩 DP-032 真機 QA → DP-034 正式上線檢查**；兩者完成後才可主動提醒專案擁有者已達可開始日常使用的驗收點。
- **DP-023／DP-033 live Auth closure（2026-08-22，已結案）：** 專案擁有者已在 staging 以真實 Email 完成註冊、驗證信導回 `/DayPop/#`、帳號 bootstrap、建立行程、已同步、登出回 guest、同帳號重登與 reload 保存；Google Cloud OAuth client 與 Supabase provider 已啟用，只要求 `openid`／Email／profile，使用同 Email Google identity 的 redirect、automatic linking、同步與 session restore 亦通過。Google Client Secret 僅存在 Google／Supabase server-side 設定與專案擁有者密碼管理器，未進 repo、前端 env 或對話。專案擁有者接受熟人階段 account chooser 顯示 Supabase 預設 project-ref hostname，品牌化 custom domain 延後。驗收中發現 Email signup 成功後 form／密碼仍留在畫面；本分支改為立即清空 credentials 並以終態取代表單。該修正 PR（#59）已於 2026-08-22 由專案擁有者合併，DP-023／033 已一併移入 Done；Supabase reset／pgTAP CI 仍未建立，但不再掛名為 DP-033 未完成項（2026-09-29 已另立為 DP-084 並完成）。發布 runway 剩 DP-032 真機 QA → DP-034 正式上線檢查，尚不得宣稱已達日常使用驗收點。
- **Product marketing package:** DP-066 已在 `showcase/` 建立可供 README／portfolio 使用的完整 campaign：六張 `1290×2796` App Store 風格直式介紹圖、獨立 README hero／thumbnail／contact sheet，以及 manifest、產品模型、分鏡、claims、art direction、marketing review／opportunities。所有產品 UI 來自 source revision `773f01b` 的隔離本機 synthetic schema-v4 狀態，未使用 Supabase、正式帳號或正式資料；生成式圖像只用於不含文字或 UI 的抽象漫畫背景。metadata 明確排除 App Store 已上架、完整離線、即時同步、Google OAuth、AI、通知與家庭分享等未完成能力；這套素材不改變發布驗收路徑（DP-019、DP-065 與 DP-033 均已完成，**目前剩 DP-032 真機 QA → DP-034 正式上線檢查**）。
- **DP-080 standalone 狀態列結案（2026-08-26）：** 2026-08-23 曾在 iPhone 15 Pro Max 的 DayPop standalone 觀察到時間／訊號／電量不可見。專案擁有者後續在 iPhone 15 Pro Max、iOS 26.3.1(a) 完成 A–F 六張靜態探針各兩輪、共 12 張 standalone 截圖，六格狀態列均清楚可見；正式 DayPop 主畫面 App 也已恢復可見。A／B、B／D、B／E／F 與 C 的結果分別顯示靜態畫布色、有無 `theme-color`、未宣告／`default`／`black` status-bar-style 與深色靜態頁都不足以單獨重現症狀。**結論只能是「複驗無法重現、成因未確認」**；本次沒有正式 App runtime 修正，不得把恢復歸因於部署、快取、重裝、iOS 或任一 meta。暫時 `public/diag/`、產生器與 npm script 已依契約移除；歷史矩陣與證據範圍保留於 `docs/dp-080-statusbar-probes.md`，原始觀察與結案記於 `docs/mobile-qa-2026-08-22.md` §2.7。
- **Generated DB types（DP-085，2026-09-29）：** `src/lib/database.types.ts` 以 `npm run supabase:types`（本機、從 migration 重建的資料庫產生）的輸出為準，逐字提交、不得手改；CI 會重新產生並比對。遠端／MCP／`supabase:types:linked` 的輸出多一段 `__InternalSupabase` PostgREST 版本資訊，只能拿來比對、不能提交。拿掉這一段後，supabase-js 對 `maxAffected()` 與多筆關聯 spread 採用 PostgREST 12 的型別；兩者目前都沒有用到，日後要用得先決定如何在建立 client 時明確宣告伺服器版本。產生器表達不出的事實寫在呼叫端：DP-082 兩支 occurrence RPC 的「其中一個參數可為 NULL」由 `supabaseRepository.ts` 的 `OccurrenceRpcArgs` 表達，原本 `Record<string, Json>`＋`as never` 讓參數完全不經型別檢查，現在參數名稱與型別都對照產生出來的 `Args`。
- **Staging 最新部署（2026-09-30）：** run `36703318414` 部署 `main` 的 `5891034`，是 2026-08-26（`4f02c26`）之後的第一次成功部署，涵蓋 PR #67–#77：設定的桌寵／一般偏好、全天開關、重複事件在四個檢視顯示（DP-081）、「重複」選單與單次／全部範圍對話框（DP-082），以及 DP-084–088 的 CI 變更。品質閘門、build 與 deploy 全部在 `ubuntu-26.04` 上通過，DB job 的映像全部來自 ghcr.io。**版號仍為 0.3.0**，`release-notes.json`、`version.json`、`sw.js` 與 `pwa/sw-template.js` 在兩次部署之間都沒有變，所以使用者不會看到新版公告；service worker 對頁面導覽採網路優先，已安裝的 PWA 在有網路時應會載入新版資產，但這一點**只從程式碼讀出、未在實機確認**。0.4.0 版本提升（連同 DP-067）已由 DP-089 建立，**並於 2026-09-30 部署到 staging（run `36711705548`），0.4.0 條目自此不可回寫**。**更新公告的長度有一條持續有效的限制**：公告是由使用者手上的舊版程式畫出來的，0.3.0（含）以前的更新對話框不能捲動，所以只要還有使用者可能停在 0.3.0，公告就必須短到在 0.3.0 的 CSS 下、375×667 直向與 932×430 橫向都放得下（0.4.0 以 7 條、165 字量測通過）；0.4.0 起對話框本身可以捲動。
- **Release notes 顯示（DP-090，v0.4.1）：** service worker 對導覽採網路優先，重新開啟 App 就已經在跑新版，所以更新對話框只會出現在「舊版仍在執行」的 session；公告因此改由 App 在每台裝置第一次執行某版時自行顯示一次（`ReleaseNoticeDialog`），「看過哪一版」存在 `daypop.release-notes-seen`（裝置層級介面狀態、走 `AppStorage`、不進 user data，失敗只會多顯示一次；全新安裝也會看到）。判斷為「目前版本比看過的新」；「立即更新」會先記下新版，避免重新載入後重複。手動「檢查更新」一定有結果：有新版就出更新對話框（即使之前按過稍後提醒）、沒有就說已是最新並附目前公告、失敗就說明原因；自動檢查維持安靜。e2e 的 `openApp` 預設寫入「已看過所有版本」哨兵值，只有 `release-notice.spec.ts` 測真正的第一次開啟。**DP-107（2026-10-03）**：0.4.1 從未部署（staging 仍是 0.4.0 的 `1bbe336`），因此在首次部署前把 0.4.1 公告改寫成涵蓋 DP-090 與 DP-092／097／101／106 的使用者可見變更（7 條、168 字），`releasedAt` 改為 2026-10-03。長度改以 staging 最後一版 0.3.0（`5891034`）的**真實 production build** 量測，不再用 CSS 模擬；同一方法量 0.4.0 公告得到與 DP-089 記錄相同的 `15..418/430`。**0.4.1 一經部署，此條目即不可回寫。** **DP-110（2026-10-03）**：這條「已部署的公告不可回寫」規則改由部署流程把關。`deploy-staging.yml` 在上傳產物前執行 `npm run check:release-notes`，比對線上目前的 `version.json`：那一版在 `release-notes.json` 的條目被改或被刪、或同版號但產出的 `version.json` 不同，部署就失敗；版號比線上舊視為 rollback、只警告；線上 404 視為尚未部署；其他讀取失敗一律擋下。它只看得到此刻線上的那一版，更早版本的條目仍靠審查。

---

## 1. Execution Modes

Agents must operate in one of two modes:

### Mode A: Planning / Architecture
- Analyze the request
- Propose structure and changes
- Outline risks and next steps
- **DO NOT modify files yet**

### Mode B: Implementation
- Apply changes strictly based on the agreed plan
- Avoid introducing new design decisions mid-implementation

If the mode is unclear, default to **Mode A first**.

For clear low-risk tasks such as typo fixes, focused tests, or small documentation updates, agents may proceed in **Mode B** directly while still summarizing the change afterward.

---

## 2. Scope Control Rules

Agents must strictly limit changes to the requested scope.

Do NOT:
- Refactor unrelated files "while you are here"
- Rename or restructure directories outside the task scope
- Modify styling, formatting, or naming conventions globally without instruction

If an improvement is detected outside scope:
- Propose it instead of implementing it

---

## 3. Prohibited Behaviors

Do not:
- Silently replace or rewrite major files without instruction
- Mix a feature task with broad unrelated cleanup
- Sneak in schema, auth, or deployment edits under an unrelated feature PR
- Turn the repo into multiple conflicting architectural styles

---

## 4. Change Requirements

Every substantial change must make these clear:
- What changed
- Why this change was made
- What risks remain
- What the next recommended step is

The goal is handoff clarity, not just code delivery.

---

## 5. Canonical Baseline & Editing Rules

All changes must treat the current repository content as the canonical baseline.

- Preserve existing language, structure, and major content unless explicitly instructed otherwise
- Prefer **additive edits** over rewrites
- Do NOT replace entire files unless explicitly requested
- Do NOT reorganize large sections without clear instruction

---

## 6. Handoff Friendliness

Code and documentation should be written so another agent or human can continue without relying on private memory or one-off chat context.

- Write module responsibilities clearly
- Keep comments focused and actionable
- Make placeholders explicit
- Prefer obvious extension points over clever shortcuts

---

## 7. Branch / PR Hygiene

At the start of every task:
- Check current branch and worktree status first
- If starting from product baseline, switch to `main`, fetch, and fast-forward from `origin/main` before creating a new branch
- If already on a feature branch, confirm it is the intended branch for this task

Before opening or updating a PR:
- Fetch and fast-forward local `main` from `origin/main`
- Branch from current `main`, not from an older local checkout
- Before pushing, check the branch against `origin/main` again — if `main` moved, rebase first
- Do not re-submit duplicate generated assets or older runtime code under the same filenames

---

## 8. Task Lifecycle

Tasks must move through the following states:

**Backlog → Next → In Progress → Done**

Use `tasks.md` as the default lightweight task board unless the project explicitly uses GitHub Issues, Linear, Notion, or another tracker.

Rules:
- Do not start a task that is not in Next or In Progress
- Move task to In Progress before implementation
- Move to Done only when completed
- Do not silently skip or reorder tasks
- For tiny fixes or direct user requests, agents may complete the work first, then add or update the task record afterward

---

## 9. Task Granularity Rule

Tasks must be:
- Small enough to complete in one session
- Clear enough that no interpretation is needed
- Independent enough to not require large refactors

Avoid vague tasks like "implement system", "build feature", or "add 3D".

---

## 10. Security Baseline

### Environment variables
- Never print secret values to the terminal — only check existence:
  ```bash
  [ -n "$API_KEY" ] && echo "API_KEY is set" || echo "API_KEY is missing"
  ```
- Never use `echo $SECRET`, `printenv KEY`, or any command that outputs a value
- Never hardcode secrets in source files
- Never commit `.env` files (use `.env.example` as template)

### General
- Never use `service_role`, admin, server-only, or equivalent privileged keys on the client side
- Database, storage, and API access policies must be explicit — do not rely on default-open behavior
