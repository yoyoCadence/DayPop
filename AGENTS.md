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
- **Verification commands:** `npm run lint`、`npm run typecheck`、`npm run test`、`npm run build`、`npm run check:build`（需先 build，檢查輸出無遠端依賴且帶 CSP）與 `npm run test:e2e`。這些項目都由 `.github/workflows/ci.yml` 在 PR 與 `main` 的 push 上自動執行，Node major 由 `.nvmrc` 與 `package.json` 的 `engines` 共同固定為 24，CI 不使用任何 secret。Supabase schema 還需可由 `npx supabase db reset` 重建並通過 RLS／migration 驗證；這條 local DB 流程仍依賴 Docker，未納入目前 CI。

---

## 0.1 Current Technical State

> Fill only after the project has stable facts worth preserving.

- **Write ordering:** DP-062 後，DataProvider 對畫面維持 fire-and-forget actions，但以單一 promise queue 讓所有 repository mutation 依 UI 呼叫順序落地；失敗沿用既有狀態且不會毒化 queue。這是 DP-026 接遠端 adapter 前的固定前置，不可退回並行 request 後只丟棄 stale response。
- **Main entry points:** `index.html` → `src/main.tsx` → `src/App.tsx` 是新的可執行 App；`src/domain`、`src/storage`、`src/pwa` 分別負責核心型別／日期、資料保存、版本更新。DP-012 後 `src/domain/types.ts` 是 Calendar／Event／Recurrence／Exception／Todo／Sticker／Preferences 的 canonical contract，`validation.ts` 負責 runtime validation，`databaseMapping.ts` 以 generated DB types 明確轉換 Supabase rows／inserts，`eventTime.ts` 集中 UI wall time 與 ISO instant 的邊界。DP-013 後 `src/data` 是資料邊界：`repository.ts` 的 `DayPopRepository` 是 UI 唯一可依賴的合約，`DataProvider`／`dataContext` 是取得資料與寫入的唯一 seam，`SessionDataProvider.tsx` 等 Auth initial session 完成後依 user id 選擇 guest／authenticated adapter，`cachedSupabaseRepository.ts` 提供同帳號版本化快取與短暫讀取失敗 fallback，`src/domain/mutations.ts` 是兩個 adapter 共用的純領域編輯。DP-025 後 `src/legacy` 負責偵測／驗證 `calpet.v2`、建立 canonical import plan、預覽與呼叫一次性 RPC；設定頁只消費 `LegacyImportContext`，不直接理解 legacy 或 DB shape。DP-018 後 `src/theme` 保存六套 canonical theme tokens，ThemeProvider 透過 `DataProvider` 保存 theme id 與 system／light／dark、即時解析 system preference 並同步 theme-color；DP-052 的自託管字體清單在 `fonts.css`，`src/shell` 提供 App viewport／safe-area／頂部狀態區／底部四分頁與桌面手機展示框，`src/screens` 存放各分頁畫面。DP-051 後 `src/screens/calendar` 是依原稿搬移的日曆 shell（header、segmented control、快速新增、連續捲動月格、FAB、浮動寵物位置），`src/domain/lunar.ts` 與 `src/domain/quickAdd.ts` 是自原檔逐行移植的農曆與快速新增解析器。`src/domain/date.ts` 是本地時間層（date key ↔ `Date`、週起始、月格），`src/domain/eventTime.ts` 是牆上時間 ↔ instant 的唯一轉換點；跨午夜行程在 `timedEventFromWallTime()` 以「隔天重新解析同一個牆上時鐘」順延，不可改回固定 `+24h`（DST 當晚的本地日不是 24 小時）。DP-055 後 `src/domain/stickerGlyphs.ts` 保存原檔的 63 個貼圖 glyph 與月格字級規則，月格／日詳情／綜覽三處貼圖 UI 均已接上真實資料。DP-059 後 `src/domain/calendars.ts` 是日曆調色盤與可見性／顏色查詢的單一來源，設定的「我的日曆」與 `src/screens/CalendarEditDialog.tsx` 提供日曆 CRUD；刪除日曆會把其事件／待辦／貼圖移到倖存的預設日曆而不是留下孤兒資料。設定分頁的帳號／版本區塊仍是尚待校正的工程骨架，不是視覺驗收基準。`日曆桌寵 Calendar Pet.dc.html`、generated `support.js` 與 `寵物素材規範 Pet Asset Spec.md` 的責任、優先序及 2026-08-02 handoff 狀態記錄於 `docs/claude-design-source-of-truth.md`，功能清單記錄於 `docs/prototype-behavior-baseline.md`。 DP-027 後 `src/domain/recurrence.ts` 集中 RFC 5545 RECUR validation、DST-safe occurrence expansion 與 exception resolution，`src/domain/ics.ts` 是 DayPop canonical event 與 iCalendar 間的純轉換邊界；事件 sheet 控制項與畫面 occurrence wiring 仍待 DP-014。
- **Storage / data model:** 新 App 的遊客資料以 `daypop.user-data` envelope 保存，含獨立的 `schemaVersion`、revision 與 timestamp；UI 經 `LocalDayPopRepository` 存取。DP-012 已將 envelope 升到 schema v2：首次啟動與 v1 migration 會持久化一個 UUID default calendar，舊 event／todo 會轉成 canonical contract，timed event 使用 ISO instant＋IANA timezone，全天 end date 為 inclusive；DP-018 再升到 schema v3，保留 v1 fixture 並新增 v2 fixture，v2→v3 只補上 `themeId = manga`，其餘偏好、revision 與 timestamp 不變。DP-016 的 write barrier 讓 `readUserData()` 回傳 `ready`／`corrupt`／`future` 三態，repository 在後兩者拒絕寫入；DP-017 的 `AppStorage` 在 localStorage probe 或 session 寫入失敗時降級為帶持續警告的 `MemoryStorage`。DP-025 已接上舊 `calpet.v2` 的一次性登入匯入：成功、失敗與重試都保留原 key，`CALPET_FIRED` 保持原樣；AI key、邀請人與附件不進 payload。Supabase 已套用 profiles、preferences、calendars、events、exceptions、attendees、attachments、todos、stickers 的 migrations、owner RLS、FK indexes 與 calendar child `NO ACTION` constraint alignment；DP-018 再以第五檔 migration 將 `month_weeks` 改為 `fixed_six_week_grid`、加入 `theme_id`，並由遠端 schema 重新產生 `src/lib/database.types.ts`。DP-036 的第六檔 migration 將兩種提醒陣列限制為最多 10 項、每項 0–10080 分鐘且不可含 `null`；九張公開資料表的 insert trigger 強制 DB timestamps，update trigger 保留 `created_at`，repository mapping 仍不送 client timestamps。遠端 generated types 與 repo 一致。DP-026 已將登入帳號接到 `SupabaseDayPopRepository`：Supabase 是 durable store，`daypop.account-cache.<encoded user id>` 只保存該帳號最後一次遠端確認的 schema v3 文件，與 guest key 分離且永不整份回傳雲端；有效同帳號快取只在短暫 remote load error 時顯示並持續警告，corrupt／future／account mismatch 快取 fail closed。遠端寫入失敗保留最後確認 snapshot、標示未同步且不自動重送；missing bootstrap rows 不以快取掩蓋，也不由前端另建預設資料。 DP-027 的第七檔 migration 在 `user_preferences.timezone` 與 `events.timezone` 寫入時以受控 trigger 驗證 PostgreSQL 支援的 timezone；function 採 security invoker、空 `search_path`，並撤銷 client role 直接 execute。DP-024 的第八檔 migration 在非 exposed 的 `daypop_private` schema 建立單一 account bootstrap helper 與 `auth.users` trigger；新帳號同一交易建立 profile、canonical preferences 與一個預設 calendar，舊帳號只補缺列、不覆寫既有值，重試以 transaction advisory lock＋conflict-safe insert 保持 idempotent。DP-025 的第 9–11 檔 migration 為 profile 增加 legacy fingerprint／timestamp，建立原子 import RPC，並以 `SECURITY INVOKER`＋transaction-local `pg_temp` marker guard 保持 owner RLS、阻擋直接偽造 completion marker；同 fingerprint retry idempotent，不同文件與中途失敗皆 fail closed。遠端／repo 現為 11 檔 migration，generated types 一致。
- **Attachment storage / schema v4:** DP-028 後 `src/domain/attachments.ts` 集中附件 MIME／10 MiB／path contract，`EventSheet` 只在 authenticated adapter capability 存在且事件已建立時顯示 upload／download／delete。Guest 與 account cache envelope 升至 schema v4；v3→v4 只加入空 `eventAttachments`，不改既有資料。Supabase 現有 private `event-attachments` bucket、owner-only Storage policies、`event_attachments` metadata constraints 與 `attachment_cleanup_jobs` durable compensation queue；上傳 finalize、附件刪除與事件刪除皆經 SECURITY INVOKER、空 `search_path` RPC，前端不保存 signed URL 或 binary。遠端／repo 現為 13 檔 migration、10 張 public tables RLS 全開，generated types 一致。
- **Test coverage:** Vitest 目前有 330 個單元案例；DP-062 將既有 DataProvider race characterization 改為序列化回歸，涵蓋下一筆在前一筆 settled 前不啟動，以及 rejection 後 queue 仍會繼續並恢復 ready；DP-013 另加雙 adapter 平行合約測試、Supabase adapter 的 mapping／owner 範圍／失敗不落地，以及以 React `act` 驗證 `DataProvider` 與整棵 App 掛載的元件測試；除原有版本比較、storage fail-closed／降級、Supabase env、theme、農曆、快速新增、週檢視與搜尋／綜覽外，新增 canonical domain 日期／instant／IANA timezone validation、domain ↔ generated DB mapping、v1→v2→v3 migration、stable default calendar 與跨午夜轉換。DP-063 補上先前完全沒有測試的兩個日期／時間邊界模組：`src/domain/date.test.ts` 涵蓋 date key 往返、跨月／跨年／閏年、兩種週起始、`buildMonthGrid` 42 格與 `weeksBetween` 取整，並以「走完一整年、每一步都必須剛好一天」在任何時區涵蓋 DST；`src/domain/eventTime.test.ts` 以明確 IANA 時區涵蓋半小時偏移、春季快轉／秋季回撥、不存在與重複的牆上時間與跨午夜長度。另有搜尋畫面、日詳情地點與 `CalendarScreen` focus 驗證的元件回歸測試。DP-018 後以 MCP 執行 repo 同一份 7 項 rollback pgTAP，驗證新偏好預設、owner RLS、跨帳號隔離、child ownership 與刪除帳號 cascade；transaction 內暫時建立的 pgTAP extension、固定測試帳號與資料均確認已回滾，security advisor 仍為 0 警告。DP-036 再將 repo pgTAP 擴為 15 項，並以額外 12 項 transactional assertions 驗證 reminder bounds、time ordering、server timestamps、RLS 與 cascade；固定假帳號／事件確認 rollback，遠端 6 檔 migration 與 security advisor 0 警告保持一致。`supabase test db --linked` 在此 Windows 環境仍要求 Docker，因此未宣稱 pgTAP CLI 已重跑；登入介面另以 390px Playwright smoke test 驗證 provider 狀態與敏感欄位關閉後清空，正常網路流程 console 0 error／warning。DP-031 後 repo CI 已在 PR 與 `main` 自動跑 `npm ci` 與 lint／typecheck／unit／build，DP-030 再加入 mobile／desktop Chromium e2e；Supabase reset／pgTAP CI 仍待 DP-033。 DP-027 新增 RFC rule、DST spring-forward、monthly skip、過密 window fail-closed、single cancel／replacement idempotency、series cleanup 與 ICS RRULE／EXDATE／RECURRENCE-ID／inclusive-exclusive round-trip 回歸；DP-024 再將遠端 repo pgTAP 擴為 36 項，涵蓋 account bootstrap defaults、重試 idempotency、既有值保留、private function 權限與原有 RLS／cascade。36／36 rollback 通過，暫時 extension 與固定假帳號／資料確認不存在；8 檔 migration、9 張表 RLS、generated types 與 security advisor 0 均一致。 DP-026 新增 session 初始化、登入／登出、帳號切換、同裝置重登、same-account cache、corrupt／future cache、remote load／write failure 與真實同步狀態回歸；MCP rollback transaction 另驗證 calendar／event／todo＋subtask／sticker／preferences CRUD、reload 與跨帳號 RLS，結束後固定假帳號／公開資料為 0，8 檔 migration、9 張 RLS 表與 advisor 0 不變。DP-025 新增 legacy validate／preview、重複 ID remap、AI key 排除、fingerprint、RPC success／failure retry 與原始 bytes 保留回歸；repo 同一份 24 項 rollback pgTAP 驗證 invoker RPC、marker guard、原子 rollback、same-fingerprint retry、different-document 拒絕與跨帳號隔離。完成後固定假帳號／public rows、pgTAP extension 與 temp guard 均不存在；遠端 11 檔 migration、9 張 RLS 表、generated types 與 security advisor 0 一致。
- **DP-028 verification:** Repo 的 `attachment_storage.test.sql` 以 36 項 rollback pgTAP 驗證 private bucket、最小權限、owner／cross-owner RLS、upload staging／finalize、附件與事件刪除 cleanup。第一輪測試抓到 `ON CONFLICT` 與 queue visibility 衝突，已用第 13 檔追加 migration 修正而未回寫歷史；正式 36／36 通過，固定假帳號／metadata／Storage object 殘留為 0，security advisor 0，遠端 generated types 18,354 字元與 repo 一致。 `supabase test db --linked` 仍因本機 Docker 前置而未宣稱通過，正式驗證由 MCP 執行 repo 同一份 rollback SQL。
- **Browser e2e coverage:** DP-030 新增 3 個 Playwright specs，於 mobile Chromium（390×844）與 desktop Chromium（1280×900）形成 6 個 browser cases：真實 guest 入口驗證 event／todo CRUD 與 reload 持久化；dev-only auth harness 以真實 App／SessionDataProvider／authenticated repository 搭配既有 FakeSupabase 驗證登入、帳號同步、event、附件 signed URL／刪除與登出隔離；responsive case 驗證 canonical 手機／桌面 shell、sheet 與設定頁不溢出。全案例要求 console error／warning 與 page error 為 0。harness 不進 production build，不使用 secret、真實帳號、正式資料或 Supabase MCP；真實 provider／OAuth、RLS 與實機瀏覽器仍分別由 DP-023／033、pgTAP 與 DP-032 負責。
- **Deployment / cache notes:** `main` 已含 PR #1 的 PWA 基線與 PR #2 的 Supabase Auth／schema 基礎。PWA 使用 `release-notes.json` 產生不快取的 `version.json` 與版本化 `sw.js`；新 service worker 等使用者選擇才 activate，只刪除舊 `daypop-app-shell-` cache。DP-065 後版本為 v0.3.0「完整日曆與雲端保存」，release note 已涵蓋整段日曆搬移、帳號保存、附件、legacy 匯入與安裝圖示。**v0.3.0 已於 2026-08-13 首次部署到 staging，因此該版 release note 自此不可回寫修改**：`release-notes.json` 的 0.3.0 條目不可修改；`version.json` 與 `sw.js` 是 generated outputs，只能隨新版本號重新產生，不得在仍為 0.3.0 時回寫成不同內容。後續變更一律開新版本號。`version.json` 的 `dataSchemaVersion` 目前仍固定輸出 `1`（實際 user-data schema 為 4），沒有任何程式讀它，已登記為 DP-067。DP-030 已建立無 secret 的 mobile／desktop Chromium e2e 品質閘門；DP-019 後 `public/icons/` 已備齊由 `daypop.svg` 產生並提交的 `any` 192／512、`maskable` 192／512 與 180×180 Apple touch PNG，`npm run icons` 可重新產生、`npm run check:build` 會核對尺寸與不透明度，實機主畫面外觀仍待 DP-032 在 staging 驗收。DP-033 已把 staging 定案為 GitHub Pages 專案站台 `https://yoyocadence.github.io/DayPop/`：`.github/workflows/deploy-staging.yml` 只由人工 `workflow_dispatch` 觸發，先跑與 PR 相同的品質閘門，再以 `--base=/DayPop/` 建置後發布；子路徑部署一定要用絕對 base，因為 `getAuthRedirectUrl()` 是以 `window.location.origin` 解析 `BASE_URL`，`'./'` 會把 `/DayPop/` 前綴丟掉。`npm run build` 的 `postbuild` 產生 `dist/404.html` 作為 SPA fallback，`npm run check:build` 另會擋下 dev-only e2e harness、缺少的 404.html 與私密金鑰材料。`src/lib/supabaseKey.ts` 是判斷 Supabase 金鑰是否可進前端的單一來源（只接受 `sb_publishable_…` 或 `role === "anon"` 的舊式 JWT，其餘含未知格式一律拒絕），由 `vite.config.ts`（建置期，throw 且不產生輸出）與 `src/lib/env.ts`（執行期）共用；`check:build` 再獨立掃描 `dist/`，並會解碼 JWT，因為舊式 `service_role` 金鑰的 role 藏在 base64url 裡、字串搜尋找不到。Pages 不能設 response header，因此 CSP 維持 meta 交付且不涵蓋 `frame-ancestors`。**staging 已於 2026-08-13 上線**（run `31702877290`）：專案擁有者已完成開啟 Pages、兩個 repository variables 與 Supabase Site URL／redirect allowlist；線上驗收結果與已知行為（Pages 供應 `404.html` 時 HTTP 狀態碼就是 404、實測沒有 CSP／XFO response header）記於 `docs/deployment.md` §5.1–5.3。**尚未驗證**：需要真實 Email／Google 帳號的註冊、驗證信 redirect 與登入後資料保存屬 DP-023，也是 DP-033 尚未完成、因此仍留在 In Progress 的部分；實機瀏覽器 QA 屬 DP-032。**尚不得宣稱已達可開始日常使用的驗收點**。另有 DP-068：`index.html` 手寫的 manifest／icon／apple-touch link 是文件相對路徑，Vite 的 `--base` 不會改寫，深層 fallback 網址下三者都會 404。DP-069 已把月格改成 roving tabindex（`MonthView` 只保留一格 `tabIndex=0`，方向鍵／Home／End／PageUp／PageDown 移動焦點但不改選取，走到 buffer 邊界會自動延伸並沿用既有捲動補償；`src/domain/date.ts` 的 `addMonths()` 夾到目標月份長度，避免 PageDown 跳過二月），到底部分頁列由 382 次 Tab 降為 12 次。DP-032 的模擬環境第一輪已完成（`docs/mobile-qa-2026-08-13.md`）：溢出、觸控目標、focus ring、dialog 語意、縮放、safe-area 與 reduced-motion 皆通過，另開出 DP-069（371 個日期格佔滿 tab 順序）、DP-070（農曆 8px 對比 2.81:1，屬原稿逐行移植故為新產品決策）、DP-071（缺 h1 與 `main` landmark）；真機與螢幕閱讀器仍待專案擁有者。仍須依 DP-033（收尾）→ DP-032（真機）→ DP-034 完成 release runway，並通過 Vite base path、SPA／OAuth redirect、PWA scope 與登入資料保存 smoke test，才可主動提醒專案擁有者已達可開始日常使用的驗收點。
- **Product marketing package:** DP-066 已在 `showcase/` 建立可供 README／portfolio 使用的完整 campaign：六張 `1290×2796` App Store 風格直式介紹圖、獨立 README hero／thumbnail／contact sheet，以及 manifest、產品模型、分鏡、claims、art direction、marketing review／opportunities。所有產品 UI 來自 source revision `773f01b` 的隔離本機 synthetic schema-v4 狀態，未使用 Supabase、正式帳號或正式資料；生成式圖像只用於不含文字或 UI 的抽象漫畫背景。metadata 明確排除 App Store 已上架、完整離線、即時同步、Google OAuth、AI、通知與家庭分享等未完成能力；這套素材不改變 DP-019 → DP-065 → DP-033 → DP-032 → DP-034 的發布驗收路徑。

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
