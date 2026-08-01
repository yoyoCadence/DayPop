# AGENTS.md

This file is the shared collaboration contract for Codex, Claude Code, and human contributors.

---

## 0. Project Context

> At project creation, the agent should fill or update this section from the user's initial project description.
> If key details are missing, ask concise follow-up questions before implementation.

- **Project name:** 日蹦 DayPop
- **Project goal:** 將 Claude Design 匯出的日曆原型落地成可長期維護的 mobile-first PWA，讓使用者建立行程、待辦、貼圖與個人偏好，透過帳號安全保存資料，並保留 App 內建寵物小幫手的陪伴體驗。MVP 優先確保架構正確、核心日曆完整且在主要裝置穩定可用；跨裝置同步、完整離線編輯與 AI 助理延後。
- **Target users:** 以手機為主要輸入裝置、需要管理個人行程／待辦的個人使用者；MVP 假設同一帳號主要在同一裝置使用，桌面瀏覽器可用但跨裝置即時一致性不是首要目標。第一階段以私人資料為主，不預設團隊協作。
- **Tech stack:** React + TypeScript + Vite 的 mobile-first PWA；測試與品質工具為 Vitest、Testing Library 相容的 jsdom、ESLint 與 TypeScript project references。後端方向為 Supabase Auth + Postgres + Storage 與 `@supabase/supabase-js`，資料庫將以 Supabase CLI migrations 管理。Claude Design 匯出的 `.dc.html` 與 generated `support.js` 僅保留為原型參考。
- **High-risk areas** (auth / DB schema / payments / deployment / etc.): Supabase Auth session／redirect 流程、RLS 與跨使用者資料隔離、既有 `localStorage` 資料遷移、跨裝置同步衝突、重複事件與時區／夏令時間、通知可靠性、附件存取政策、使用者刪除與資料保留、將 AI API key 存在前端的現有安全風險、匯入檔案驗證。
- **Architecture constraints:** 匯出原型與 `docs/prototype-behavior-baseline.md` 是 UI／功能行為參考，重構採可驗證的漸進式搬移。前端不得持有 `service_role` 或任何伺服器密鑰；所有公開 schema 資料表必須啟用 RLS，且使用者資料以 `auth.uid()` 隔離。正式資料需拆成可獨立保存的列，不可延續單一 JSON blob 作為雲端模型。資料存取必須經 repository/service 邊界：遊客模式使用帶 schema version 的本機資料；登入模式以 Supabase 作為 durable store，裝置端保留版本化快取。App release version 與 user-data schema version 必須獨立；service worker 只可更新／清理 `daypop-app-shell-` cache，不得操作使用者 localStorage／IndexedDB。MVP 不實作 Realtime、多裝置衝突合併或完整離線寫入佇列。舊 `calpet.v2` 資料需有一次性匯入與可回復策略，成功前不得覆寫或刪除。登入 UX 參考 Orbit：Email＋密碼、Google OAuth、忘記／重設密碼、session restore 與遊客模式。AI 若日後保留，必須改由受控的 server-side／Edge Function 代理。寵物是 App 內建小幫手；素材與進階 AI 行為不得阻塞日曆 MVP。
- **Verification commands:** `npm run lint`、`npm run typecheck`、`npm run test`、`npm run build`。瀏覽器 smoke test 目前依 `docs/prototype-behavior-baseline.md` 手動執行；DP-030 會加入可重複的 Playwright e2e script。Supabase workflow 建立後，schema 還需可由 `npx supabase db reset` 重建並通過 RLS／migration 驗證。

---

## 0.1 Current Technical State

> Fill only after the project has stable facts worth preserving.

- **Main entry points:** `index.html` → `src/main.tsx` → `src/App.tsx` 是新的可執行 App；`src/domain`、`src/storage`、`src/pwa` 分別負責核心型別／日期、資料保存、版本更新。`日曆桌寵 Calendar Pet.dc.html` 與 generated `support.js` 只作原型參考，既有功能清單記錄於 `docs/prototype-behavior-baseline.md`。
- **Storage / data model:** 新 App 的遊客資料以 `daypop.user-data` envelope 保存，含獨立的 `schemaVersion`、revision 與 timestamp；UI 經 `LocalDayPopRepository` 存取。讀取錯誤不會覆寫原值，更新程式也不會清除 localStorage／IndexedDB。舊 `calpet.v2` 與 `CALPET_FIRED` 保持原樣，匯入尚未實作；Supabase 帳號 adapter／schema 尚未接線。
- **Test coverage:** Vitest 目前涵蓋版本比較與本機資料 envelope 的 5 個單元案例，包括保留舊 `calpet.v2`／其他 localStorage key，以及 malformed data 不被自動覆寫。lint、strict TypeScript 與 production build 已建立；Playwright 自動化 e2e／CI 尚未建立。
- **Deployment / cache notes:** 本地 Git 已連結空的 `https://github.com/yoyoCadence/DayPop`，`main` 有初始化基線，開發位於 `feat/pwa-foundation`，尚未 push。PWA 使用 `release-notes.json` 產生不快取的 `version.json` 與版本化 `sw.js`；新 service worker 等使用者選擇才 activate，只刪除舊 `daypop-app-shell-` cache。尚未選定或設定正式 hosting。

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
