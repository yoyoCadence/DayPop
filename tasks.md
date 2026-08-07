# 日蹦 DayPop — Tasks

本檔案是專案的輕量任務板。任務依賴順序為：確認產品與 repo 基線 → 保全完整 Claude Design → 建立可維護前端 → 建立 Supabase schema／RLS → 登入與資料遷移 → 帳號資料保存 → 品質與部署。目前已進入實作階段。

## Planning baseline（已確認）

- 產品型態：mobile-first 響應式 Web App／PWA，可加到手機主畫面並在桌面瀏覽器使用；MVP 不做原生 iOS／Android／桌面 App。
- MVP 使用情境：個人帳號、私人日曆與待辦；同一帳號主要在同一裝置使用。重點是架構正確、可執行且核心功能穩定，跨裝置即時一致性不是目前優先項目。
- 前端：React + TypeScript + Vite。`日曆桌寵 Calendar Pet.dc.html`、generated `support.js` 與 `寵物素材規範 Pet Asset Spec.md` 是完整設計來源；必須實際渲染並逐頁搬移，不可只依單張截圖或現有 React scaffold 自行重設計，也不直接在 generated `support.js` 上擴充產品。
- 視覺目標：2026-08-02 已定案新使用者預設為「漫畫」淺色主題，並作為第一個還原與驗收基準；原稿其他五套主題仍完整保留。`.dc.html` 的 `data-props.defaultTheme` 已由像素校正為漫畫，與 seed 一致；既有保存偏好不得被覆寫。手機／安裝 PWA 只顯示 App 內容；桌面可使用原稿手機展示框。詳細規則與 handoff 見 `docs/claude-design-source-of-truth.md`。
- 後端：Supabase Auth + Postgres + Storage；所有 schema 與 RLS 由可提交的 migration 管理，不以 Dashboard 手動狀態作為唯一來源。
- 登入方式：參考 Orbit，支援 Email＋密碼註冊／登入、Google OAuth、忘記／重設密碼、session restore，以及遊客模式（資料只存本機）。成功登入後由 Auth state change 統一啟動帳號資料流程。
- 保存策略：所有 UI 經 repository/service 存取資料。遊客模式使用版本化本機儲存；登入模式將 Supabase 作為 durable store，保留本機快取以加快同裝置啟動與處理短暫網路失敗。MVP 不做 Realtime、多裝置 merge、完整離線寫入佇列或複雜 conflict UI。
- 本機耐久性：malformed／future-version envelope 必須阻擋後續寫入，原始內容完成備份或匯出前不得覆寫；storage 不可用時只能進入有持續警告的非持久化 session mode。DP-016／017 完成前不得提升本機 data schema version。
- AI 助理與完整離線編輯已確認延後。分享日曆、真正寄送邀請、可靠背景推播與進階跨裝置同步也不進 MVP。正式部署平台可在建立 production pipeline 前定案。
- 寵物定位：是 App 介面內的寵物小幫手，用於顯示待辦、提醒與陪伴回饋，不是 Windows／macOS 桌面上獨立運行的桌寵程式。MVP 可保留現有 rule-based 基本互動；新素材、成長系統與 AI 對話延後。
- 家庭群組：先列入私人日曆 MVP 之後的產品階段。預設群組名稱為「家庭」，模型支援多位成員；成員各自選擇是否將日曆分享給群組，共享日曆預設允許成員共同維護，但新增行程／待辦時可將單一事項設為私人。邀請方式暫定為 Email 邀請連結，實作前再確認成員上限、管理員規則與是否需要唯讀權限。

## Proposed data architecture

資料列 ID 建議使用可在 client 端產生的 UUID；核心表均含 `created_at`、`updated_at`。MVP 使用明確的 upsert／delete，不為尚未需要的多裝置同步預先加入 tombstone／merge engine。所有 owner-scoped 欄位與常用日期查詢都需建立索引。

| Table | Purpose / key fields |
| --- | --- |
| `profiles` | `id = auth.users.id`、顯示名稱與帳號層級資料；不複製密碼或 token。 |
| `user_preferences` | 每位使用者一列：時區、週起始日、固定六列／自動列數、`system/light/dark` 主題、預設提醒、App 寵物偏好等；現有 `month_weeks` 會在接 CRUD 前 migration 成語意明確的 `fixed_six_week_grid`，不得存 AI provider secret。寵物 XP 優先由已完成待辦推導。 |
| `calendars` | `owner_id`、名稱、顏色、可見性、排序；刪除前需處理其事件，禁止留下 orphan records。 |
| `events` | `owner_id`、`calendar_id`、標題、全天日期欄位或 timed `timestamptz` 欄位、IANA timezone、地點、備註、提醒分鐘、RFC 5545 recurrence rule、同步時間戳。DB constraint 必須保證全天與 timed 欄位組合有效。 |
| `event_exceptions` | 重複事件單次取消／修改：原 occurrence、是否取消、replacement event；取代目前 `exdates + standalone event` 的隱含關係。 |
| `event_attendees` | 邀請人名稱／email 的結構化資料；MVP 僅保存 metadata，不宣稱已寄邀請。 |
| `event_attachments` | 檔名、MIME、size、Storage object path 與 event 關聯；實作時採私人 bucket、owner RLS 與 signed URL。 |
| `todos` | `owner_id`、標題、`due_date`、priority、`completed_at`、`parent_id`（子項）、`sort_order`；取代 `when=today/tomorrow` 與獨立 `subs` array。 |
| `stickers` | `owner_id`、日期、glyph／asset key、排序；保留未來由 emoji 遷移到素材 ID 的空間。 |
| `family_groups` | 家庭群組、可改名稱；建立者為 owner，預設名稱由應用層填入「家庭」。 |
| `family_memberships` | `group_id`、`user_id`、role 與加入時間；accepted membership 才能參與分享授權。 |
| `family_invitations` | 邀請者、受邀 Email、不可逆 token hash、到期／接受／撤銷狀態；接受流程使用受控 RPC／server-side 邊界，避免前端直接偽造 membership。 |
| `calendar_group_shares` | 日曆擁有者明確開啟的群組分享與 `view`／`edit` 權限；關閉分享不刪除原始日曆資料。 |

RLS 基線：私人 MVP 的 user data table 只開放 `authenticated`，`USING` 與 `WITH CHECK` 均核對 `(select auth.uid()) = owner_id`；child table 需同時保證 parent ownership。前端只使用 project URL 與 publishable key。家庭分享實作後，讀寫政策才額外接受「有效 membership + 日曆分享權限 + 事項非 private」，不能只靠前端隱藏私人事項。

## 建議執行順序（保留 Supabase MCP 額度）

> 這是跨 agent 的交接順序；各任務仍須依 `Next → In Progress → Done` 移動，目前只把最前面的未完成任務放在 `Next`，完成後才將下一項移入。表中標示「不使用」的階段不得呼叫 Supabase MCP、不得查詢／修改遠端專案，也不得以 Dashboard 手改 schema。若需要核對 Supabase API，先使用 repository 既有型別、測試與官方文件；migration 仍只以 `supabase/migrations/` 為單一事實來源。

| 順序 | 任務 | Supabase MCP | 交接規則 |
| --- | --- | --- | --- |
| 1 | DP-031 CI | 不使用 | 只建立 repository CI 與既有驗證。 |
| 2 | DP-013 repository/service boundary | 不使用 | 以既有 generated types、mock 與本機測試完成邊界；遠端整合驗收留到 DP-026。 |
| 3 | DP-055 貼圖完整體驗 | 不使用 | 只接 canonical domain／repository，不新增遠端 schema。 |
| 4 | DP-014 MVP CRUD UI | 不使用 | UI 與 repository contract 對接；不直接呼叫 Supabase client。 |
| 5 | DP-015 素材安全與 CSP | 不使用 | 不變更 Supabase Storage 或遠端政策。 |
| **停止點** | **Supabase MCP 交接** | **開始需要** | agent 必須先提醒專案擁有者：「下一階段將使用 Supabase MCP，請改由可使用 MCP 的 agent 接手。」未收到確認前不得開始下列任務的遠端操作。 |
| 6 | DP-018 主題／月格偏好 migration | 需要 | migration 先在本機落檔並走正式 migration workflow；MCP agent 負責核對專案狀態、型別與 advisor，不得用 MCP 直接下 DDL。 |
| 7 | DP-036 DB invariants | 需要 | 以 migration 落實 constraint／index；MCP 用於 advisor 與隔離驗證，不可手改遠端 schema 或直接下 DDL。 |
| 8 | DP-027 日期／時區邊界 | 需要 | 先定案 DB 邊界與 migration，再讓帳號 CRUD 寫入正式資料。 |
| 9 | DP-024 帳號資料 bootstrap | 需要 | 以真實帳號驗證初始化、RLS 與重試安全性。 |
| 10 | DP-026 核心 CRUD 遠端持久化 | 需要 | 驗證 authenticated adapter、RLS、重載與跨帳號隔離。 |
| 11 | DP-025 legacy 匯入 | 需要 | 在 durable CRUD 穩定後才驗證一次性匯入與可回復流程。 |
| 12 | DP-028 附件 Storage | 需要 | bucket、policy、簽名 URL 與 metadata 必須一起驗證。 |

> DP-023 剩餘的 Google OAuth client、Supabase provider 與 production redirect allowlist 是「專案擁有者人工設定」檢查點，不等同於 MCP schema 工作。負責 DP-023 的 agent 應在需要設定時提醒專案擁有者，且不得要求或輸出任何 secret 值。

> 進入 MCP 階段後仍禁止透過 MCP 直接執行 DDL、禁止 remote reset，也不得查改正式使用者資料。MCP 只用於任務必要的專案狀態檢查、read-only schema／advisor 驗證與安全測試；所有 schema 變更必須先存在於 migration 檔並由可追蹤的 migration workflow 套用。

## Next

- [ ] **DP-014 — 完成其餘 canonical UI 搬移：** 交接順序第 4 項，同樣不使用 Supabase MCP。詳細範圍見 Backlog 的 DP-014。

## In Progress

- [ ] **DP-023 — 依 Orbit 模式接入 Supabase Auth：** 前端程式、Email flow、session restore、provider capability detection 與 recovery UI 已完成；剩餘 Google OAuth client／Supabase provider、部署 redirect allowlist，以及使用真實 Email／Google 帳號做 end-to-end 驗收。遊客資料不會因登入／登出被清除或自動上傳。

## Backlog

### Foundation / maintainable frontend

- [ ] **DP-014 — 完成其餘 canonical UI 搬移：** DP-050／051 後依「週／列表 → 日詳情／事件編輯 → 待辦 → 搜尋／綜覽 → 設定 → 其餘 dialog」逐段搬移；每段同時對照原始 `.dc.html` 的相同狀態並通過視覺／行為 smoke matrix，才可移除對應舊邏輯。週／列表（DP-053）、日詳情 sheet（DP-057）與搜尋／綜覽（DP-058）已完成，接著是設定其餘區塊與其他 dialog。同時收掉 DP-051／053／057 的過渡措施：快速新增改為交給事件 sheet 確認而非直接建立、事件 sheet 補齊原稿欄位、待辦新增入口移回寵物對話泡泡（DP-040）、週檢視補上全天列、列表檢視在天氣資料來源定案後補回該欄位（DP-054），並移除 `shell.css` 末段最後的 scaffold 橋接。
- [ ] **DP-015 — 自託管／打包必要前端資源：** 移除執行期 unpkg React 與非必要遠端字型依賴，建立 CSP 相容且可重現的 production build。主題顯示字體已由 DP-052 先行處理，本任務保留 unpkg React 移除、CSP 政策與整體資源盤點；若日後決定連中文字體也自託管，需先解決 subset 與體積問題。
- [ ] **DP-018 — 接上主題與月曆列數偏好：** 保留 `theme = system/light/dark` 並同步 CSS、system preference、theme-color meta／manifest（目前仍是舊的紫色骨架色）；把保存的偏好與六套 theme id 接進 DP-050 的 `ThemeProvider`，既有保存值一律優先於預設；以 fixed-six vs adaptive 取代數字型 `month_weeks`，更新 domain、DB migration、UI 與 `buildMonthGrid` 測試。

### Supabase / auth / data

- [ ] **DP-024 — 建立 account bootstrap：** 新帳號建立 profile、preferences 與預設 calendars；流程需 idempotent，重試不得產生重複預設資料。
- [ ] **DP-025 — 建立 legacy localStorage migration：** 偵測 `calpet.v2`、schema validate、顯示預覽與筆數、一次性匯入 Supabase、處理重複 ID／失敗回復；成功前不刪除原資料，並禁止匯入舊 AI key。
- [ ] **DP-026 — 接上核心 CRUD 與帳號資料保存：** events、calendars、todos、subtasks、stickers、preferences 逐項改走 repository；完成 Supabase load／upsert／delete、本機快取、短暫失敗復原與同裝置重新登入測試。此任務不包含 Realtime 或多裝置衝突合併。
- [ ] **DP-027 — 完成 recurrence／timezone 正確性：** 以 RFC 5545 規則與 exception model 處理單次／全部修改、IANA timezone、DST 與 ICS round-trip；DayPop 全天 `end_date` 採 inclusive，ICS adapter 明確轉換 exclusive `DTEND`。timezone 由 domain 與可測的受控 DB 邊界驗證，不使用讀取 `pg_timezone_names` 的 immutable CHECK 假設。
- [ ] **DP-028 — 實作附件 Storage：** 在核心 CRUD 穩定後才加入真實 upload、metadata、大小／MIME 限制、signed URL、刪除清理與 RLS；移除目前的假附件按鈕行為。
- [ ] **DP-036 — 強化 CRUD 前資料 invariant：** 以 migration 限制 reminder array 的數量與分鐘範圍，讓 `created_at` 由 DB／repository 控制；修正 23:xx 新增行程跨日，並為提醒、時間順序與 client 偽造建立時間補測試。完成後重新產生 DB types 並跑 advisor。

### Quality / release

- [ ] **DP-030 — 建立自動化測試金字塔：** unit 覆蓋日期／recurrence／migration／repository，component 覆蓋表單與 auth states，Playwright 覆蓋手機與桌面主要流程。
- [ ] **DP-032 — 行動裝置 QA 與無障礙：** 驗證 iOS Safari、Android Chrome、桌面 Chromium 的 safe area、觸控拖曳、鍵盤、focus、對比與 reduced motion。
- [ ] **DP-033 — 部署 staging：** 建立 preview/staging、Supabase redirect allowlist、環境變數與 rollback 流程；驗證 production 不包含 service role、使用者 AI key 或本機測試資料。
- [ ] **DP-034 — 正式上線檢查：** 執行備份／還原、資料刪除、隱私說明、錯誤監控、效能 budget、PWA 更新，以及同裝置登出／重新登入後的資料保存 smoke test；確認已部署 release note 不再被同版號改寫。
- [ ] **DP-019 — 補齊 PWA 安裝圖示：** 由現有識別產出並實機驗證 180×180 Apple touch icon、192×192／512×512 PNG 與適當 maskable icon；manifest／HTML 保留 SVG 作補充但不再把 SVG 當 Apple icon。
- [ ] **DP-035 — 節流自動版本檢查：** 為 visibility／online 自動觸發保留至少 5 分鐘間隔，30 分鐘 timer 可維持；手動「檢查更新」不受節流，並以 fake timers／fetch spy 驗證。

### 原型假功能與待補能力

> 原稿裡有畫面但沒有真正能力的部分。搬移時一律停用並保留版面位置，不得以假的成功狀態充數（規則見 `docs/claude-design-source-of-truth.md` 與 `docs/prototype-behavior-baseline.md`）。這裡是每一項的歸屬，避免停用之後被遺忘。

| 原型假功能 | 現況 | 由誰補上 |
| --- | --- | --- |
| 天氣 | DP-053 起在列表檢視保留版面位置但不顯示 | DP-054 |
| ~~貼圖~~ | 已完成：DP-012 模型＋DP-055 UI | — |
| 資料匯入匯出（JSON／ICS） | 尚未搬移 | DP-056 |
| 附件 | 原稿的按鈕行為是假的 | DP-028 |
| 雲端「已同步」狀態 | 尚未搬移，接通前不得顯示 | DP-026 |
| 瀏覽器通知 timer | 不視為可靠提醒 | DP-042 |
| AI 助理 | 模擬且會把 key 存在前端 | DP-043 |

- [ ] **DP-054 — 補回天氣欄位：** 先定案資料來源、是否需要位置權限、離線與失敗時的顯示，再接回列表檢視每日標題右側與日詳情。在來源定案前維持停用；不得沿用原稿依日期取固定字串的假資料。
- [ ] **DP-056 — 搬移資料匯入匯出：** JSON 與 ICS 的匯出與匯入，含 schema validation、匯入預覽與筆數、重複 ID 處理、失敗回復與 round-trip 測試；匯入成功前不得覆寫既有資料，且禁止匯入舊 AI key。ICS 的 exclusive `DTEND` 轉換依 DP-027。

### Deferred product features

- [ ] **DP-040 — App 內浮動寵物素材與狀態機：** 核心 MVP 穩定後，將目前正常文件流的 `<aside class="pet-helper">` 升級為 App viewport 浮動層，依 `寵物素材規範 Pet Asset Spec.md` 接入各品種與含 `grab` 的七種狀態；拖曳範圍避開 safe-area，位置等純 UI state 留在裝置端，`pet_enabled` 可永久關閉。
- [ ] **DP-041 — App 內建寵物進階互動與成長：** 定義 XP 是否可逆、解鎖規則、資料一致性與資產版本，再擴充提醒、建議與互動；寵物始終是 App 內功能，不建立獨立桌面程式。
- [ ] **DP-042 — 可靠背景提醒／推播：** 另行設計 Web Push subscription、排程、撤銷、時區與權限；目前頁面開啟時的 Notification timer 不視為可靠提醒。
- [ ] **DP-043 — 安全 AI 助理：** 若產品決定保留 AI，改由 Supabase Edge Function／受控 server endpoint 管理 provider secret、rate limit、輸入最小化與稽核；禁止在 browser localStorage 保存 secret。
- [ ] **DP-044 — 定案家庭群組產品規則：** 確認群組人數上限、owner／admin／member 能力、退出與解散規則、Email 邀請與重送／撤銷／過期流程，以及共享日曆是 `edit` 預設或可切唯讀；在 owner-only 模型完整驗證前不開始。
- [ ] **DP-047 — 建立家庭群組與安全邀請：** 以 migrations 建立 `family_groups`、`family_memberships`、`family_invitations`，提供建立／更名／邀請／接受／拒絕／退出的受控 service 或 RPC；預設名稱為「家庭」，token 僅保存 hash 並設有效期限。
- [ ] **DP-048 — 建立日曆分享與單項私人覆寫：** 加入 `calendar_group_shares` 與事項 visibility 規則；每位擁有者明確開啟自己的日曆分享，新增行程／待辦可選「不分享」，關閉分享不得刪除資料。
- [ ] **DP-049 — 驗證家庭 RLS 與共同維護：** 以多帳號測試非成員拒絕、成員 view／edit、私人事項不可見、退出或撤銷後立即失權、owner 權限不可被 member 提升，並驗證前端篩選不是安全邊界。
- [ ] **DP-045 — 外部日曆整合：** Google／Apple／Outlook 雙向同步另列專案，先維持經驗證的 ICS 匯入匯出。
- [ ] **DP-046 — 進階跨裝置同步：** 產品真的出現多裝置需求後，再設計 Realtime、`updated_at` 衝突規則、tombstone、pending queue、可觀測 sync status 與多 client 測試。

## Package / tooling review

- 現有工具：Node `v24.14.1`、npm `11.12.1`、Git 與 GitHub CLI；React、React DOM、Supabase JS、TypeScript、Vite、Vitest、jsdom 與 ESLint 已由 npm 官方 registry 安裝並提交 lockfile，初次 audit 為 0 個已知漏洞。
- 字體：DP-052 加入六個 Fontsource 套件（`@fontsource/bangers`、`newsreader`、`ibm-plex-sans`、`space-grotesk`、`pixelify-sans`、`dotgothic16`），皆為 OFL-1.1、pin 到固定版本、只提供字體檔與 CSS，audit 仍為 0 個漏洞。中文字體因體積不自託管。
- CI：GitHub Actions（`.github/workflows/ci.yml`）在 PR 與 `main` 上跑 `npm ci` 與四項驗證。Node major 由 `.nvmrc` 固定為 24，`package.json` 的 `engines` 宣告相同範圍；改版時兩處必須一起改。CI 目前不需要任何 secret，日後若需要只能經 GitHub Secrets 注入到單一步驟。
- `package.json` 已提供 lint、typecheck、unit、build、preview 與 release asset scripts。日期／recurrence runtime validation 與 Playwright e2e 套件等到對應任務選定，避免先加入未使用依賴。
- 本機 Supabase 完整 stack 需要 Docker-compatible runtime；目前此電腦未偵測到 Docker。未確認需求前不安裝。
- MCP／Codex plugin 不是 runtime 必需品。目前已使用 OpenAI curated 的 Supabase plugin 套用／驗證 migration 與 advisors；它不能取代 repo 內 migration、RLS 測試或 CLI workflow。
- 安裝原則：只從專案官方文件與 npm 官方 registry 取得、提交 lockfile、避免 beta／未維護套件、先檢查 package provenance／license／必要權限，不執行來路不明的一鍵腳本。

## Done

- [x] **DP-055 — 搬移貼圖完整體驗：** 三處貼圖 UI 都依原稿接上。月格：`stickerFontSize()` 逐值移植原檔 `stkSize`（1／2／3／4+ → 19／15／12／10px），貼圖列以 `margin-top:auto` 置底、置中換行。日詳情：貼圖列在標題與「行程」之間，點既有貼圖即刪除（原稿沒有另外的刪除鈕），`＋ 貼圖` 展開 63 個 glyph 的選擇器，選一個後關閉；sheet 以 `key={dateKey}` 重建，換一天時選擇器跟著關閉，對應原檔 `openDay()` 重設 `stickerPick`。綜覽：貼圖分頁改為真實資料，glyph（23px／26px 寬）取代色條、時間欄留空、標題固定「貼圖」、點一列開啟該日。`STICKER_GLYPHS` 逐字移植原檔 `get STK()` 的 63 個 emoji 與順序。資料面沿用 DP-013 的合約：新增 `addSticker`／`deleteSticker` 到 `DayPopRepository`、`domain/mutations.ts` 與兩個 adapter，`sortOrder` 依「當日既有張數」計算而非全域計數，Sticker 仍同時保留 `glyph` 與 `assetKey`，未來換素材集不需要資料遷移。未新增任何遠端 schema／DDL，也未使用 Supabase MCP。單元測試 152 → 168，新增月格字級與過濾、日詳情選擇器互動、綜覽貼圖分組，以及雙 adapter 的貼圖平行合約測試。三處的 CSS 皆自原檔 inline style 逐值移植，但未以 Playwright 做像素比對（Playwright 仍等 DP-030），建議合併後在瀏覽器實看一次。
- [x] **DP-013 — 建立 repository/service 邊界：** `src/data/repository.ts` 的 `DayPopRepository` 是 UI 唯一可依賴的資料合約，七個方法一律回傳完整文件並改為 async，好讓本機與遠端 adapter 可互換。`src/domain/mutations.ts` 收攏兩個 adapter 共用的純領域編輯（預設日曆、trim、時間戳、all-day／timed 轉換、跨午夜順延），`LocalDayPopRepository` 與新的 `SupabaseDayPopRepository` 都用同一組函式，差別只在寫到哪裡。Supabase adapter 以 DP-012 的 `databaseMapping` 與 generated types 讀寫 calendars／events／exceptions／todos／stickers／preferences，寫入後以回傳的 row 重建快照（因此 `created_at`／`updated_at` 一律取 DB 值），並區分 `RemoteDataError` 與 `AccountNotBootstrappedError`；它**尚未接進 App**，切換 adapter、裝置快取與短暫失敗處理仍是 DP-026。UI 端新增 `DataProvider`／`dataContext` 作為唯一 seam：`App` 與四個分頁不再 import 任何 storage 或 Supabase 模組，`LOCAL_DATA_BLOCKED_EVENT` 這個 window 事件與 `LocalDayPopRepository.read()` 因此成為多餘並移除，改由 provider 直接接住 `LocalDataBlockedError` 進入復原畫面。遊客路徑保留同步首屏（`SyncLoadCapable`），第一次 render 就有真資料、不會閃空白。單元測試自 110 增至 152：新增雙 adapter 平行合約測試、Supabase adapter 的 mapping／owner 範圍／錯誤不落地、純 mutation 邊界，以及以 React `act` 驗證 provider 與整棵 App 真的掛得起來（含 DP-016 復原閘門仍優先於分頁）。`DataRecoveryScreen` 仍直接呼叫本機備份／重設，這是刻意保留的本機專屬例外。
- [x] **DP-031 — 建立最小 CI 與 Node toolchain pin：** `.github/workflows/ci.yml` 對 PR 與 `main` 的 push 依序執行 `npm ci`、`npm run lint`、`npm run typecheck`、`npm run test`、`npm run build`，四項與本機 verification commands 完全相同，且拆成獨立步驟以便一眼看出是哪一關失敗。Node 版本以 `.nvmrc`（major 24）為單一事實來源，由 `actions/setup-node` 的 `node-version-file` 讀取，並在 `package.json` 的 `engines` 宣告同一個 major（`>=24.0.0 <25.0.0`、npm `>=11.0.0`）；`package-lock.json` 的 root entry 同步鏡像該 `engines`，未變動任何相依版本。workflow 不設定任何 env secret，也不需要 Supabase 變數即可 build；`permissions` 限制為 `contents: read`，checkout 使用 `persist-credentials: false`，並以 concurrency group 取消同分支尚未完成的舊 run。已在乾淨目錄實測 `npm ci` 通過（242 packages），四項驗證在本機皆通過（110 個單元測試）。Supabase `db reset`／pgTAP 與 Playwright e2e 依交接順序留給 DP-033／030；本任務未使用 Supabase MCP，也未變更遠端專案。
- [x] **DP-012 — 定案共用 domain ↔ DB contract：** `src/domain/types.ts` 已建立 Calendar、全天／timed Event discriminated union、RFC 5545 Recurrence、EventException、完整 Todo、Sticker 與 Preferences canonical contract；timed event 保存 ISO instant＋IANA timezone，全天 `endDate` 明確採 inclusive。`validation.ts` 對日期、instant、timezone、時間順序、default calendar 與跨資料 reference 做 runtime validation，`databaseMapping.ts` 以 generated `Row`／`Insert` types 明確轉換 calendars、events、exceptions、todos、stickers、preferences，client insert 不帶 DB 控制的 timestamp。遊客 envelope 升至 schema v2，保留 v1 JSON fixture 與 migration test；首次啟動／migration 都會持久化一個 UUID default calendar，舊 event／todo 全部接到它，23:xx 跨日 migration 正確。既有 UI 只做欄位相容搬移，日曆管理／貼圖／完整事件欄位仍依 DP-014／055，recurrence expansion／DST／ICS 仍依 DP-027，`month_weeks` DB rename 仍依 DP-018，提醒與 DB invariant hardening 仍依 DP-036。單元測試目前 110 個。
- [x] **DP-017 — 處理 browser storage 不可用：** 所有儲存存取改走 `src/storage/browserStorage.ts` 的 `AppStorage`。開機前先 probe：讀 `window.localStorage` 這個動作本身會丟例外（無痕視窗、封鎖網站資料）、`setItem` 會丟例外，也可能寫得進去卻讀不回來，三種都判為不可用。不可用或 session 中途遭拒（多為 `QuotaExceededError`）就把**本分頁**降級為 `MemoryStorage`，把 `daypop.*` 與 legacy key 帶過去讓畫面維持一致，原始位元組完全不動。降級後不會自動切回持久化，否則同一 session 會半在磁碟半在記憶體。`StorageWarningBanner` 由 `AppShell` 的新 `banner` prop 固定在 App body 之上，四個分頁與復原畫面都看得到，且刻意不可關閉。記憶體模式下復原畫面的備份文案改為指向下載的檔案，因為此時只有它是真備份。`LocalDayPopRepository` 改為每次操作重新解析共用 store，否則降級後仍會寫進舊 delegate。補 14 個單元測試涵蓋 probe 三種失敗、降級與訂閱、不自動復原，以及「重新載入後編輯確實消失」。本機 schema version 的提升前置至此完成。
- [x] **DP-016 — 阻斷本機資料毀損覆寫：** `readUserData()` 改為回傳 `ready`／`corrupt`／`future` 三態，不再把讀不出來的資料當成空資料。`LocalDayPopRepository` 每次寫入前重讀，非 `ready` 一律丟出 `LocalDataBlockedError` 而不覆寫；`App` 在任何畫面掛載前檢查，改渲染 `DataRecoveryScreen` 並隱藏底部分頁。復原流程是「先備份再重設」：備份寫到帶時間戳的 `daypop.user-data.backup.*` 並下載檔案，`resetUserData()` 在沒有備份時直接拒絕。session 中途被其他分頁破壞也會擋下並切到復原畫面。補 10 個回歸測試涵蓋 malformed、future schema、中途損壞與備份／重設閘門。本機 schema version 的提升仍等 DP-017。
- [x] **DP-058 — 搬移搜尋與綜覽（DP-014 第三段）：** 搜尋頁完成標題、搜尋欄、日曆篩選 chip 列、結果卡片、閒置提示與無結果訊息；綜覽頁完成「共 N 筆」、行程／待辦／貼圖切換、期間 stepper、年／月／週與「今天」、年檢視的全部收合／展開，以及可折疊的分組卡片。搜尋比對與綜覽分組抽成 `src/domain/search.ts`、`src/domain/overview.ts` 並補 17 個單元測試。跨分頁開啟以 `App` 的 `calendarFocus` 狀態處理，`CalendarScreen` 掛載時讀成初始 state，不需要 effect。日曆篩選 chips 與貼圖統計需要 DP-012 的模型，保留位置並標示。分頁佔位元件 `PendingScreen` 已刪除，四個分頁都有真正的畫面。
- [x] **DP-057 — 搬移日詳情 sheet（DP-014 第二段）：** 點月格開啟的日詳情依原稿完成：sheet 外框與 grip、`M月D日 週X` 標題與「完成」、行程區段（全天／`start–end`、時間重疊的紅色色條與「衝突」標籤、空狀態「這天沒有行程」）、＋ 新增事件、待辦清單（勾選、刪除、新增）。z-index 65，可與事件 sheet（90）同時開啟。貼圖列、待辦子項與拖曳排序需要 DP-012 的模型，保留版面位置並標示負責任務。Escape 改由 `CalendarScreen` 統一處理，只關最上層 — 兩個元件各自監聽 `window` 會讓一次按鍵關掉兩層。repository 補上 `deleteTodo`（未動 schema）。已與原稿並排比對 sheet 錨點、寬度與 padding，390px 無水平溢出，console 0 error。
- [x] **DP-053 — 搬移週檢視與列表檢視（DP-014 第一段）：** 週檢視的 7 欄時間格（36px 時刻軌、07:00–22:00、44px／小時、676px 格高、60px 欄寬、今日欄位標色、目前時間線）與列表檢視的每日分段卡片皆依原稿完成。時間格計算集中在 `src/domain/timeGrid.ts` 並補 20 個單元測試；拖曳改時間、調整長度與跨欄換日皆吸附 15 分鐘，按下未移動則開啟事件。`AddSheet` 改名為 `EventSheet` 並支援編輯與刪除，repository 補上 `updateEvent`／`deleteEvent`（未動 schema）。天氣是原型假功能，依基準文件維持停用、保留版面位置但不顯示假資料。與原稿並排量測週格為完全相同的 `x:484 y:336.09 420 × 676`，390px 整頁無水平溢出且時間格自身橫向捲動，console 0 error。
- [x] **DP-051 — 搬移漫畫主題核心日曆 shell：** 依原稿完成 header（今日日期列、`--font-head` 期間標題、今天、搜尋）、‹ › 與月／週／列表 segmented control、快速新增列、連續捲動的月格、FAB 與 App 內浮動寵物位置。農曆／節日與快速新增自然語言解析自原檔逐行移植成 `src/domain/lunar.ts`、`src/domain/quickAdd.ts` 並補 20 個單元測試。`AppShell` 新增 viewport portal，讓 sheet／dialog 待在展示框內並蓋過 tab bar。週／列表保留原位並明講尚未搬移；點月格目前只選取該日。DP-010 的日曆工程骨架已刪除。以 Playwright 與原始 `.dc.html` 並排比對：header 量得完全相同的 384 × 180.59、月格捲動區 486.41、FAB 與寵物位置逐像素一致，390px／1280px 無水平溢出，console 0 error。過渡措施與 DP-014 的收尾清單記於 `docs/claude-design-source-of-truth.md`。
- [x] **DP-052 — 自託管六套主題的顯示字體：** Bangers、Newsreader、IBM Plex Sans、Space Grotesk、Pixelify Sans 與 DotGothic16 皆由 npm 官方 registry 的 Fontsource 套件（OFL-1.1）取得並由 Vite 打包成同源資源，字重與原檔 Google Fonts `<link>` 一致，production build 無任何執行期第三方字型請求。匯入帶 `unicode-range` 的字重進入點以維持切片下載；DotGothic16 例外改用單一 japanese subset，避免 106 KB render-blocking CSS。`.dp-preview` 還原 `font-synthesis: weight style`，讓只有 400 字重的 Bangers／DotGothic16 不會比原稿細。Noto Sans TC／Noto Serif TC 因完整 subset 達 65／78 MB 不自託管，中文沿用系統字體並記錄差異。已以 `document.fonts.check()` 驗證八組字體字元覆蓋，並確認網路側只有同源 woff2。
- [x] **DP-050 — 建立 canonical App shell 與主題基礎：** `src/theme/themes.ts` 逐值鏡像原檔 `THEMES`，六套主題的淺／深色 palette 與形狀 token 全數保留，`themeCssVariables()` 依原檔 `phoneStyle()` 輸出相同的 25 個 CSS 變數；漫畫淺色為新使用者預設。`src/shell` 提供 App viewport、safe-area、頂部狀態區、底部四分頁與只在瀏覽器分頁＋寬視窗出現的 404 × 824 展示框，手機與安裝後 PWA 不渲染假外框／假瀏海／假狀態列。搜尋與綜覽保留分頁位置並明確標示未搬移，既有日曆、登入與版本更新能力照舊可用。ThemeProvider 只存在記憶體，未改資料模型也未寫入任何偏好。已用 Playwright 對照原始 `.dc.html` 驗證桌面與 390px 版面、深色與像素主題及 console 0 error。
- [x] **DP-005 — 重新盤點 Claude Design 完整設計來源：** 實際渲染 `.dc.html` 並核對日曆月／週／列表、搜尋、綜覽、設定與事件 sheet；確認 generated `support.js` 的 runtime 角色與 Pet Asset Spec 的補充範圍，建立 `docs/claude-design-source-of-truth.md`，明定現有 React scaffold 不是視覺驗收基準，並依 2026-08-02 決策將原稿全新啟動預設校正為漫畫淺色。
- [x] **DP-004 — 整合 2026-08-01 review handoff：** 重新以探針確認兩條本機資料遺失路徑，建立 `docs/architecture-decisions.md`，重排 storage／CI／domain 優先度，更新 App 內浮動寵物規範，並把 PWA、偏好、日期與 DB invariant 建議拆成可執行任務；LICENSE 保留給專案擁有者決定。
- [x] **DP-029 — 修正 PR #2 Supabase／Auth review：** hardening migration 對不存在的 Dashboard helper 加入防護，新增 calendar child `NO ACTION` migration、帳號刪除 cascade pgTAP 與 linked CLI scripts；本機 URL 支援安全 loopback，Auth dialog 會清空敏感狀態、保留密碼更新完成畫面，並區分 Google provider 未啟用與設定查詢失敗。migration 已套用遠端，5 項 rollback DB 測試與 security advisor 驗證完成。
- [x] **DP-022 — 實作並測試核心 RLS：** 9 張 exposed table 均啟用 RLS 與 owner CRUD policies，`anon` 無 table privileges；已用兩個暫存帳號在 rollback transaction 驗證 owner read/write、跨帳號隔離與 child ownership，Supabase security advisor 為 0 警告。Storage bucket／policy 仍由 DP-028 處理。
- [x] **DP-021 — 實作核心 schema migrations：** 已建立並套用 core schema、owner RLS 與 advisor hardening migrations，涵蓋 9 張表、constraints、複合 foreign keys、query／FK indexes 與 updated-at triggers；遠端 migration history 與 repo 檔名一致。
- [x] **DP-020 — 建立可重建的 Supabase workflow：** 已固定官方 Supabase CLI、建立 `supabase/config.toml`／`seed.sql`，並加入本機 stack、reset 與 TypeScript type generation scripts；完整本機 reset 仍需可信容器 runtime。

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
