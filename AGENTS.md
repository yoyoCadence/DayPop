# AGENTS.md

This file is the shared collaboration contract for Codex, Claude Code, and human contributors.

---

## 0. Project Context

> At project creation, the agent should fill or update this section from the user's initial project description.
> If key details are missing, ask concise follow-up questions before implementation.

- **Project name:** 日蹦 DayPop
- **Project goal:** 將 Claude Design 匯出的日曆原型落地成可長期維護的 mobile-first PWA，讓使用者建立行程、待辦、貼圖與個人偏好，透過帳號安全保存資料，並保留 App 內建寵物小幫手的陪伴體驗。MVP 優先確保架構正確、核心日曆完整且在主要裝置穩定可用；跨裝置同步、完整離線編輯與 AI 助理延後。
- **Target users:** 以手機為主要輸入裝置、需要管理個人行程／待辦的個人使用者；MVP 假設同一帳號主要在同一裝置使用，桌面瀏覽器可用但跨裝置即時一致性不是首要目標。第一階段以私人資料為主，不預設團隊協作。
- **Tech stack:** 現況為 Claude Design 匯出的單一 `.dc.html`、生成式 `support.js` 執行環境、React 18 UMD 與原生 JavaScript／CSS。已確認的落地基線為 React + TypeScript + Vite、mobile-first PWA、Supabase Auth + Postgres + Storage、`@supabase/supabase-js`，並以 Supabase CLI migrations 管理資料庫。
- **High-risk areas** (auth / DB schema / payments / deployment / etc.): Supabase Auth session／redirect 流程、RLS 與跨使用者資料隔離、既有 `localStorage` 資料遷移、跨裝置同步衝突、重複事件與時區／夏令時間、通知可靠性、附件存取政策、使用者刪除與資料保留、將 AI API key 存在前端的現有安全風險、匯入檔案驗證。
- **Architecture constraints:** 目前匯出原型是 UI 與功能行為的 canonical baseline，重構須採可驗證的漸進式搬移，不可一次重寫後失去既有功能。前端不得持有 `service_role` 或任何伺服器密鑰；所有公開 schema 資料表必須啟用 RLS，且使用者資料以 `auth.uid()` 隔離。正式資料需拆成可獨立保存的列，不可延續單一 JSON blob 作為雲端模型。資料存取必須經 repository/service 邊界：遊客模式只存本機；登入模式以 Supabase 作為帳號資料的 durable store，裝置端保留版本化快取供快速啟動與暫時失敗回復。MVP 不實作 Realtime、多裝置衝突合併或完整離線寫入佇列。舊 `calpet.v2` 資料需有一次性匯入與可回復策略。登入 UX 參考 Orbit：Email＋密碼、Google OAuth、忘記／重設密碼、session restore 與遊客模式。AI 呼叫若日後保留，必須改由受控的 server-side／Edge Function 代理。寵物是 App 內建小幫手；核心互動可保留，但素材與進階 AI 行為不得阻塞日曆 MVP。
- **Verification commands:** 目前尚無 `package.json`、測試或正式建置指令；現有生成 runtime 可先用 `node --check support.js` 做語法檢查。建立前端基線後至少提供並維護 `npm run lint`、`npm run typecheck`、`npm run test`、`npm run test:e2e`、`npm run build`；Supabase schema 需可由 `npx supabase db reset` 重建並通過 RLS／migration 驗證。

---

## 0.1 Current Technical State

> Fill only after the project has stable facts worth preserving.

- **Main entry points:** `日曆桌寵 Calendar Pet.dc.html` 同時包含完整模板、inline styles、狀態與商業邏輯；`support.js` 是標示為 generated、不可手改的 Design Component runtime。現有畫面包含月／週／列表、搜尋、綜覽、事件與重複事件、待辦／子項、貼圖、主題、通知、JSON／ICS 匯出入、模擬 AI 與 CSS 桌寵。
- **Storage / data model:** 所有事件、待辦、日曆、貼圖與偏好目前序列化到 `localStorage` key `calpet.v2`；已觸發提醒另存於 `CALPET_FIRED`。事件／待辦使用短隨機字串 ID，尚無使用者、資料版本、schema migration、伺服器資料庫或真正同步；設定中的 AI key 也被寫入相同本機 blob。
- **Test coverage:** 無自動化測試、型別檢查、lint、package manifest 或 CI。已確認 `support.js` 與 `.dc.html` 內嵌邏輯可通過 Node 語法檢查，但尚未建立可重複的瀏覽器 smoke／regression baseline。
- **Deployment / cache notes:** 此資料夾目前不是 Git working tree，尚未連結到 `https://github.com/yoyoCadence/DayPop`；匿名網路檢查也無法讀取該 repo，需先確認權限與遠端基線。原型依賴 Google Fonts 與 unpkg 上的 React／ReactDOM，沒有 PWA manifest、service worker、正式部署設定或離線快取；畫面中的「雲端同步」目前只是模擬狀態。

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
