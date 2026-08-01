# 新專案啟動步驟

1. 複製整個 `starter 模板` 資料夾，改成新專案名稱
2. 用 VS Code 開啟該資料夾
3. 呼叫 Claude Code 或 Codex，貼上你的新專案描述
4. 請 agent 先更新：
   - `AGENTS.md` 的 **Section 0: Project Context**
   - `tasks.md` 的初始任務
5. 確認內容合理後，再開始第一個實作任務

---

## 建議啟動提示詞

```text
請先不要實作。根據以下描述，更新 AGENTS.md 的 Section 0，並建立或更新 tasks.md 的初始任務清單。若資訊不足，先問我最多 3 個問題。

專案描述：
...
```

---

## Section 0 整理範例

```
- Project name: MyApp
- Project goal: Help small teams track paid meal orders
- Target users: Office admins and coworkers
- Tech stack: Next.js + Supabase + TypeScript
- High-risk areas: auth flow, DB schema, deployment config
- Architecture constraints: server components only, no client-side fetch
- Verification commands: npm test, npm run lint
```

確認後就可以說「開始第一個任務」。
