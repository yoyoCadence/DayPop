# 日蹦 DayPop — Tasks

本檔案是專案的輕量任務板。任務依賴順序為：確認產品與 repo 基線 → 保全原型行為 → 建立可維護前端 → 建立 Supabase schema／RLS → 登入與資料遷移 → 帳號資料保存 → 品質與部署。目前已進入實作階段。

## Planning baseline（已確認）

- 產品型態：mobile-first 響應式 Web App／PWA，可加到手機主畫面並在桌面瀏覽器使用；MVP 不做原生 iOS／Android／桌面 App。
- MVP 使用情境：個人帳號、私人日曆與待辦；同一帳號主要在同一裝置使用。重點是架構正確、可執行且核心功能穩定，跨裝置即時一致性不是目前優先項目。
- 前端：React + TypeScript + Vite，逐畫面從 `.dc.html` 搬移並保留視覺與行為基線，不直接在 generated `support.js` 上擴充產品。
- 後端：Supabase Auth + Postgres + Storage；所有 schema 與 RLS 由可提交的 migration 管理，不以 Dashboard 手動狀態作為唯一來源。
- 登入方式：參考 Orbit，支援 Email＋密碼註冊／登入、Google OAuth、忘記／重設密碼、session restore，以及遊客模式（資料只存本機）。成功登入後由 Auth state change 統一啟動帳號資料流程。
- 保存策略：所有 UI 經 repository/service 存取資料。遊客模式使用版本化本機儲存；登入模式將 Supabase 作為 durable store，保留本機快取以加快同裝置啟動與處理短暫網路失敗。MVP 不做 Realtime、多裝置 merge、完整離線寫入佇列或複雜 conflict UI。
- AI 助理與完整離線編輯已確認延後。分享日曆、真正寄送邀請、可靠背景推播與進階跨裝置同步也不進 MVP。正式部署平台可在建立 production pipeline 前定案。
- 寵物定位：是 App 介面內的寵物小幫手，用於顯示待辦、提醒與陪伴回饋，不是 Windows／macOS 桌面上獨立運行的桌寵程式。MVP 可保留現有 rule-based 基本互動；新素材、成長系統與 AI 對話延後。

## Proposed data architecture

資料列 ID 建議使用可在 client 端產生的 UUID；核心表均含 `created_at`、`updated_at`。MVP 使用明確的 upsert／delete，不為尚未需要的多裝置同步預先加入 tombstone／merge engine。所有 owner-scoped 欄位與常用日期查詢都需建立索引。

| Table | Purpose / key fields |
| --- | --- |
| `profiles` | `id = auth.users.id`、顯示名稱與帳號層級資料；不複製密碼或 token。 |
| `user_preferences` | 每位使用者一列：時區、週起始日、月檢視週數、主題、深色模式、預設提醒、桌寵偏好等；不得存 AI provider secret。桌寵 XP 優先由已完成待辦推導。 |
| `calendars` | `owner_id`、名稱、顏色、可見性、排序；刪除前需處理其事件，禁止留下 orphan records。 |
| `events` | `owner_id`、`calendar_id`、標題、全天日期欄位或 timed `timestamptz` 欄位、IANA timezone、地點、備註、提醒分鐘、RFC 5545 recurrence rule、同步時間戳。DB constraint 必須保證全天與 timed 欄位組合有效。 |
| `event_exceptions` | 重複事件單次取消／修改：原 occurrence、是否取消、replacement event；取代目前 `exdates + standalone event` 的隱含關係。 |
| `event_attendees` | 邀請人名稱／email 的結構化資料；MVP 僅保存 metadata，不宣稱已寄邀請。 |
| `event_attachments` | 檔名、MIME、size、Storage object path 與 event 關聯；實作時採私人 bucket、owner RLS 與 signed URL。 |
| `todos` | `owner_id`、標題、`due_date`、priority、`completed_at`、`parent_id`（子項）、`sort_order`；取代 `when=today/tomorrow` 與獨立 `subs` array。 |
| `stickers` | `owner_id`、日期、glyph／asset key、排序；保留未來由 emoji 遷移到素材 ID 的空間。 |

RLS 基線：所有 user data table 只開放 `authenticated`，`USING` 與 `WITH CHECK` 均核對 `(select auth.uid()) = owner_id`；child table 需同時保證 parent ownership。前端只使用 project URL 與 publishable key。若未來加入共享日曆，再以獨立 `calendar_members` 與角色政策擴充，不先把私人 MVP 複雜化。

## Next

- [ ] **DP-012 — 擴充共用 domain model：** 在目前 Event／Todo／Preferences 最小型別上加入 Calendar、Recurrence、EventException、Sticker 與 runtime validation，明確處理全天／時區／重複事件 invariant；先補測試再接 UI。
- [ ] **DP-020 — 建立可重建的 Supabase workflow：** 固定官方 Supabase CLI 為 project dev dependency，加入 `supabase/config.toml`、migrations、seed 與 type generation script。若要在本機執行完整 stack，需先安裝官方 Docker Desktop 或其他可信容器 runtime。

## In Progress

## Backlog

### Foundation / maintainable frontend

- [ ] **DP-013 — 建立 repository/service 邊界：** UI 不直接呼叫 browser storage 或 Supabase；建立 guest local adapter 與 authenticated Supabase adapter，兩者共用 domain contract、runtime validation 與測試。
- [ ] **DP-014 — 漸進搬移核心 UI：** 依「日曆 → 日詳情／事件編輯 → 待辦 → 搜尋／綜覽 → 設定」逐段搬移，每段通過 smoke matrix 才移除對應舊邏輯。
- [ ] **DP-015 — 自託管／打包必要前端資源：** 移除執行期 unpkg React 與非必要遠端字型依賴，建立 CSP 相容且可重現的 production build。

### Supabase / auth / data

- [ ] **DP-021 — 實作核心 schema migrations：** 依上方資料架構建立 tables、constraints、foreign keys、indexes、updated-at handling 與明確的 delete／cascade policy；以 migration SQL 和 seed 驗證，不只在 Dashboard 點選。
- [ ] **DP-022 — 實作並測試 RLS：** 為每張 exposed table 建立 authenticated owner policies，使用至少兩個測試帳號驗證 read/write 隔離、child ownership、Storage policy 與未登入拒絕。
- [ ] **DP-023 — 依 Orbit 模式接入 Supabase Auth：** 實作 Email＋密碼註冊／登入、Google OAuth、忘記／重設密碼、登出、session restore、OAuth／recovery callback、Auth state change、錯誤與 loading 狀態；保留「遊客模式（只存本機）」並清楚顯示資料保存範圍。
- [ ] **DP-024 — 建立 account bootstrap：** 新帳號建立 profile、preferences 與預設 calendars；流程需 idempotent，重試不得產生重複預設資料。
- [ ] **DP-025 — 建立 legacy localStorage migration：** 偵測 `calpet.v2`、schema validate、顯示預覽與筆數、一次性匯入 Supabase、處理重複 ID／失敗回復；成功前不刪除原資料，並禁止匯入舊 AI key。
- [ ] **DP-026 — 接上核心 CRUD 與帳號資料保存：** events、calendars、todos、subtasks、stickers、preferences 逐項改走 repository；完成 Supabase load／upsert／delete、本機快取、短暫失敗復原與同裝置重新登入測試。此任務不包含 Realtime 或多裝置衝突合併。
- [ ] **DP-027 — 完成 recurrence／timezone 正確性：** 以 RFC 5545 規則與 exception model 處理單次／全部修改、全天事件、IANA timezone、DST 與 ICS round-trip；補齊 edge-case fixtures。
- [ ] **DP-028 — 實作附件 Storage：** 在核心 CRUD 穩定後才加入真實 upload、metadata、大小／MIME 限制、signed URL、刪除清理與 RLS；移除目前的假附件按鈕行為。

### Quality / release

- [ ] **DP-030 — 建立自動化測試金字塔：** unit 覆蓋日期／recurrence／migration／repository，component 覆蓋表單與 auth states，Playwright 覆蓋手機與桌面主要流程。
- [ ] **DP-031 — 建立 CI：** 對 PR 執行 install lockfile、lint、typecheck、unit、build 與必要 e2e／Supabase migration checks；任何 secret 只用 GitHub Secrets。
- [ ] **DP-032 — 行動裝置 QA 與無障礙：** 驗證 iOS Safari、Android Chrome、桌面 Chromium 的 safe area、觸控拖曳、鍵盤、focus、對比與 reduced motion。
- [ ] **DP-033 — 部署 staging：** 建立 preview/staging、Supabase redirect allowlist、環境變數與 rollback 流程；驗證 production 不包含 service role、使用者 AI key 或本機測試資料。
- [ ] **DP-034 — 正式上線檢查：** 執行備份／還原、資料刪除、隱私說明、錯誤監控、效能 budget、PWA 更新，以及同裝置登出／重新登入後的資料保存 smoke test。

### Deferred product features

- [ ] **DP-040 — App 內建寵物素材與狀態機：** 核心 MVP 穩定後，依 `寵物素材規範 Pet Asset Spec.md` 製作／接入各品種與七種狀態；寵物偏好可保存至帳號，動畫位置等純 UI state 留在裝置端。
- [ ] **DP-041 — App 內建寵物進階互動與成長：** 定義 XP 是否可逆、解鎖規則、資料一致性與資產版本，再擴充提醒、建議與互動；寵物始終是 App 內功能，不建立獨立桌面程式。
- [ ] **DP-042 — 可靠背景提醒／推播：** 另行設計 Web Push subscription、排程、撤銷、時區與權限；目前頁面開啟時的 Notification timer 不視為可靠提醒。
- [ ] **DP-043 — 安全 AI 助理：** 若產品決定保留 AI，改由 Supabase Edge Function／受控 server endpoint 管理 provider secret、rate limit、輸入最小化與稽核；禁止在 browser localStorage 保存 secret。
- [ ] **DP-044 — 共享日曆與真實邀請：** 新增 `calendar_members`、角色、邀請生命週期與更細 RLS；在 owner-only 模型完整驗證前不開始。
- [ ] **DP-045 — 外部日曆整合：** Google／Apple／Outlook 雙向同步另列專案，先維持經驗證的 ICS 匯入匯出。
- [ ] **DP-046 — 進階跨裝置同步：** 產品真的出現多裝置需求後，再設計 Realtime、`updated_at` 衝突規則、tombstone、pending queue、可觀測 sync status 與多 client 測試。

## Package / tooling review

- 現有工具：Node `v24.14.1`、npm `11.12.1`、Git 與 GitHub CLI；React、React DOM、Supabase JS、TypeScript、Vite、Vitest、jsdom 與 ESLint 已由 npm 官方 registry 安裝並提交 lockfile，初次 audit 為 0 個已知漏洞。
- `package.json` 已提供 lint、typecheck、unit、build、preview 與 release asset scripts。日期／recurrence runtime validation 與 Playwright e2e 套件等到對應任務選定，避免先加入未使用依賴。
- 本機 Supabase 完整 stack 需要 Docker-compatible runtime；目前此電腦未偵測到 Docker。未確認需求前不安裝。
- MCP／Codex plugin 不是 runtime 必需品。若之後需要 agent 操作 Supabase，可評估官方／OpenAI curated 的 Supabase plugin；它不能取代 repo 內 migration、RLS 測試或 CLI workflow，也不應為了初始化而強制安裝。
- 安裝原則：只從專案官方文件與 npm 官方 registry 取得、提交 lockfile、避免 beta／未維護套件、先檢查 package provenance／license／必要權限，不執行來路不明的一鍵腳本。

## Done

- [x] **DP-000 — 初始化規劃盤點：** 完整閱讀現有專案檔案與生成 runtime，記錄現況、風險、建議資料架構、套件／工具需求，更新 `AGENTS.md` Section 0 與本任務板；未修改產品程式碼、未安裝套件或 MCP。
- [x] **DP-002 — 確認 MVP 產品／架構方向：** 定案 mobile-first PWA、React + TypeScript + Vite、Supabase、Orbit 式 Email＋密碼／Google／遊客登入體驗；完整離線、AI 與進階跨裝置同步延後，寵物定位為 App 內建小幫手。
- [x] **DP-001 — 驗證並連結 GitHub 基線：** 確認 `yoyoCadence/DayPop` 是空的 public repo；在不覆寫原型的前提下建立本地 `main` 基線提交、設定 `origin`，並建立 `feat/pwa-foundation` 分支。尚未 push。
- [x] **DP-003 — 建立原型行為保全清單：** 新增 `docs/prototype-behavior-baseline.md`，記錄核心畫面、資料能力、假功能、搬移驗收與資料安全 smoke checklist。
- [x] **DP-010 — 建立前端骨架：** 建立 React + TypeScript + Vite App、`.env.example`、版本化本機 repository、lint／typecheck／unit／build scripts 與 mobile-first 核心月曆最小流程；保留且未修改 generated runtime。
- [x] **DP-011 — 建立可安裝 PWA 與可控更新基線：** 加入 manifest、icon、mobile viewport、App shell cache、`version.json`、release notes 與更新提示。新版只在使用者選擇後 activate；service worker 不快取 API response、不清除 localStorage／IndexedDB，只管理 DayPop App cache。完整離線編輯仍延後。

## Official references

- [Orbit auth wrapper](https://github.com/yoyoCadence/Orbit/blob/main/pwa/js/auth.js)
- [Orbit auth UI flow](https://github.com/yoyoCadence/Orbit/blob/main/pwa/js/authFlow.js)
- [Orbit app bootstrap and session handling](https://github.com/yoyoCadence/Orbit/blob/main/pwa/js/app.js)
- [Supabase Auth with React](https://supabase.com/docs/guides/auth/quickstarts/react)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase local development and migrations](https://supabase.com/docs/guides/local-development/overview)
- [Supabase CLI setup](https://supabase.com/docs/guides/local-development/cli/getting-started)
