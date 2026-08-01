# DayPop 專案審查 Handoff — 2026-08-01

給下一位接手的 agent／人類。這份文件是**提案**，不是已決定的工作；依 AGENTS.md §2，範圍外的改善應該先提出再實作。請與使用者確認優先順序後，再把選定項目寫進 `tasks.md` 並依 §8 的生命週期執行。

## 整合結果

使用者已於 2026-08-01 要求檢查並整合。兩條 P0 storage 路徑已再次用暫時探針重現；正式決策記錄於 [`architecture-decisions.md`](architecture-decisions.md)，任務已拆入 `tasks.md`：

- 採用並提升優先度：storage fail-closed、storage unavailable UI、CI、domain ↔ DB contract、PNG install icons。
- 調整後採用：非持久化 fallback 必須持續警告；timezone 不使用依賴 `pg_timezone_names` 的 CHECK。
- 已直接修正文檔：App 內浮動寵物情境、`grab` 用途、React／TypeScript 接入方向與損毀字元。
- 併入後續任務：theme／month grid 語意、版本檢查節流、全天／ICS 邊界、reminder／`created_at`／23:xx invariant、Node toolchain pin。
- 暫不決定：LICENSE，等待專案擁有者選擇。

以下保留原始審查內容作為判斷依據；「未能驗證」描述的是當時審查 agent 的環境，不代表後續整合狀態。

## 這份文件的來源與可信度

審查範圍：`AGENTS.md`、`README.md`、`tasks.md`、`docs/`、`寵物素材規範 Pet Asset Spec.md`，以及 `src/`、`pwa/`、`public/`、`scripts/`、`supabase/` 全部原始碼。基準 commit：`4634cf4`（PR #2 修正後）。

已實際執行並通過：`npm run lint`、`npm run typecheck`、`npm run test`（12 tests）、`npm run build`，且 build 後產生的 release assets 無 git drift。

**未能驗證**（沒有 Docker，環境限制）：`supabase db reset`、`supabase test db --local`、遠端 migration 實際狀態。所有 SQL 相關結論都是靜態閱讀 + PostgreSQL 語意推導，不是執行結果。

---

## P0 — 已驗證的資料遺失路徑（兩條）

專案最核心的承諾是「不會弄丟使用者資料」（AGENTS.md Architecture constraints、README「資料安全邊界」、`docs/prototype-behavior-baseline.md` smoke checklist 都重複寫）。目前實作有兩個洞會直接違反這個承諾。**兩條都用探針測試實際跑過確認，不是推論。**

### P0-1 讀到毀損資料後，第一次寫入就蓋掉原資料

- `src/storage/versionedStorage.ts:48` — 解析失敗時回傳「空 envelope、`revision: 0`」。
- `src/storage/localRepository.ts:66-71` — `#mutate` 以這個空值為基礎呼叫 `writeUserData`，`setItem` 直接覆寫原本那串壞掉但可能還救得回來的 JSON。

實測：塞入 `not-json` 後呼叫一次 `addTodo`，原字串就消失了。

**注意現有測試給了錯誤的安全感。** `src/storage/versionedStorage.test.ts:33-40`（`returns safe defaults without overwriting malformed data`）只驗證 `readUserData` 不寫入 — 那是對的，但覆寫發生在 mutate 路徑，測試沒有覆蓋到。修的時候請一併補上 mutate 路徑的測試。

建議方向（擇一）：
1. 偵測到無法解析時，先把原字串複製到 `daypop.user-data.corrupt.<timestamp>` 再繼續。
2. 在 envelope 上帶 `recovered: true`，讓 `LocalDayPopRepository` 拒絕寫入並讓 UI 明確提示使用者「偵測到損毀資料，已保留原檔」。

### P0-2「資料來自較新版本」的防護是 dead code

`src/storage/versionedStorage.ts:78-80` 的 `throw new Error('這份 DayPop 資料來自較新的版本，請先更新 App。')` 永遠傳不到呼叫端 — 它被同一個函式 `src/storage/versionedStorage.ts:53` 的 `catch` 吞掉，結果變成回傳空資料，再接上 P0-1 就是完整的資料歸零。

實測：塞入 `schemaVersion: 99` 且含事件的 envelope，`readUserData()` 回傳 `events: []`、`schemaVersion: 1`。

情境很真實：使用者用過 v0.3（schemaVersion 2），之後因為 service worker 快取或版本回退開到舊版 → 行程全消失。

建議修法：把版本檢查移出 `try`，或讓 `catch` 只處理 `JSON.parse` 的例外，不要包住 `migrateEnvelope`。

### 重現用的探針測試

下面這段可以直接放進 `src/storage/` 當回歸測試（審查時是在專案外跑的，沒有進 repo）：

```ts
import { describe, expect, it } from 'vitest';
import { LocalDayPopRepository } from './localRepository';
import { readUserData, USER_DATA_STORAGE_KEY } from './versionedStorage';

describe('malformed / future-version data durability', () => {
  it('first mutation must not overwrite malformed data', () => {
    localStorage.setItem(USER_DATA_STORAGE_KEY, 'not-json-precious-user-data');
    new LocalDayPopRepository().addTodo({ title: 'x', date: '2026-08-01' });
    // 目前會失敗 —— 原字串已被覆寫
    expect(localStorage.getItem(USER_DATA_STORAGE_KEY)).toBe('not-json-precious-user-data');
  });

  it('newer-schema envelope must surface an error, not reset to empty', () => {
    localStorage.setItem(
      USER_DATA_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 99,
        revision: 7,
        updatedAt: '2026-08-01T00:00:00.000Z',
        data: {
          events: [{ id: 'e1', title: 'important' }],
          todos: [],
          preferences: { weekStartsOn: 0, theme: 'system', petName: '摩卡' },
        },
      }),
    );
    // 目前會失敗 —— 不會 throw，而是靜靜回傳空資料
    expect(() => readUserData()).toThrow();
  });
});
```

### 順帶：storage 不可用時會整個崩掉

`src/storage/localRepository.ts:20` 的預設參數直接取 `window.localStorage`。在 Safari 無痕模式或使用者停用網站資料的情況下，光是存取這個屬性就會 throw；`setItem` 也可能因 `QuotaExceededError` 失敗。目前沒有任何一層攔截，結果是整個 App 掛掉而不是降級。對一個主打「資料安全保存在這台裝置」的 PWA，建議在同一個任務裡加一層 guarded storage wrapper（取不到就退回 in-memory 並在 UI 明說「這個瀏覽器無法保存資料」）。

---

## P1 — 有欄位但沒有行為的設定

這類「存得下去但什麼都不會發生」的設定，對使用者是隱性的謊言，也會讓後面接 CRUD 的人誤以為功能已存在。

### P1-1 `theme` 完全不生效

`src/domain/types.ts:23` 與 DB `user_preferences.theme` 都定義了 `'system' | 'light' | 'dark'`，預設 `system`。但 `src/styles.css` 完全沒有 `prefers-color-scheme`，`src/App.tsx` 也從不讀這個值。

PWA 使用者對「跟系統主題一致」的期待很強，深色模式又是全站 CSS 工程。建議二選一，不要留半套：
- 列成明確任務（要注意 `index.html` 的 `theme-color` meta 與 `manifest.webmanifest` 的 `theme_color` 也要跟著切）；或
- 先從 domain model 與 DB 移除，等真的要做再加回來。

### P1-2 `user_preferences.month_weeks` 沒有消費者，而且語意可能是錯的

`src/domain/date.ts:19-24` 的 `buildMonthGrid` 硬寫 42 格（6 週），沒有讀任何設定。DB 約束是 `between 4 and 6` — 但月檢視設成 4 週會截掉多數月份的日期，這不是使用者會想選的東西。

真正的需求應該是「固定六列（版面高度不跳動）」vs「自動列數（依當月需要 4–6 列）」。建議改成 `fixed_six_week_grid boolean`，語意才站得住，並在同一個任務裡把 `buildMonthGrid` 接上。

---

## P1 — 文件不一致

### P1-3 `寵物素材規範 Pet Asset Spec.md` 的名詞與情境框架要更新

**先講清楚不要改錯方向：** 七個動作狀態（含 `grab`）全部保留。`grab` 對應的是真實需求 — 寵物浮在畫面上可能擋到內容，使用者要能把牠拖走。這不是舊桌寵時代的遺留。

要改的是名詞和情境描述。目前標題與內文都用「桌寵 / Calendar Pet」，但 AGENTS.md 與 `tasks.md` 已明確定案「寵物是 App 內建小幫手，不是 Windows／macOS 桌面上獨立運行的桌寵程式」。這份文件是要交給**外部美術／動畫師**的，錯誤的框架會讓對方對「畫布會疊在什麼背景上」「要不要處理視窗邊界」做出錯誤假設。

具體修改：
1. 標題與全文的「桌寵」改為 App 內浮動寵物小幫手（例：`App 內浮動寵物小幫手 In-App Pet Companion`）。
2. 開頭補一句情境：角色浮在 App 畫面上層、可被使用者拖動到不擋內容的位置，活動範圍是 App viewport 而非作業系統桌面。
3. 第 5 節「接入方式（工程）」的範例仍指向舊 generated JS 的 `this.PET_ASSETS`，要換成新 React 架構的說法，否則交付後對不上。
4. 第 8 行有字元損毀：「避免**опис**邊緣被裁切」混進了西里爾字母，要修掉。

### P1-4 目前實作與素材規範描述的是兩個不同狀態

`src/App.tsx:192-198` 的寵物是排在正常文件流裡的 `<aside className="pet-helper">` — 它不浮動，所以現在不可能擋到任何東西，也沒有拖曳行為。素材規範描述的是**未來**那個浮動層版本。

建議在 DP-040 的任務描述裡寫明這個落差，否則之後接手的人看到規範要求 `grab`、回頭看程式碼發現沒有可拖曳的東西，會不確定是誰錯了。

真的要做浮動層時有兩個小陷阱可以先記著：
- 拖曳後的位置要存在裝置端（`tasks.md` 已寫「動畫位置等純 UI state 留在裝置端」，方向正確）。
- 浮動元素要避開 `env(safe-area-inset-bottom)`，否則在 iPhone 上會壓到 home indicator，反而更難拖。

順帶一提，`user_preferences.pet_enabled boolean not null default true` 這個欄位是**對的、要留著**。拖走和關掉正好是「擋到畫面」的兩個逃生口，一個暫時、一個永久。這跟 P1-1／P1-2 的死欄位不同 — 它有明確用途，只是還沒接線。

### P1-5 README 專案結構描述與實際不符

README 寫 `docs/ 原型行為與架構文件`，但 `docs/` 目前只有 `prototype-behavior-baseline.md`，沒有架構文件。要嘛補文件、要嘛改描述。

---

## P2 — 對專案目的最有益的三件事

### P2-1 CI 是目前投報率最高的缺口（建議把 DP-031 提前到 Next）

專案整套價值觀建立在「可驗證」上：AGENTS.md 明列四道驗證指令，`tasks.md` 要求「不以 Dashboard 手動狀態作為唯一來源」。但 repo 沒有 `.github/`，這些規則全靠人和 agent 自律執行。

PR #2 就是活例子：PR 描述宣稱跑過全部檢查，審查時仍必須自己重跑一次才知道真假。對一個大量交給 agent 實作的專案，把約定變成強制比多寫幾條規則有效得多。

最小可用版本就是一個 workflow：`npm ci` → `lint` → `typecheck` → `test` → `build`。之後再依 DP-030／DP-033 加 e2e 與 migration check。

### P2-2 在 DP-013 之前先定案 domain ↔ DB 對應

兩邊模型已經分岔：

| | 本機（guest） | Supabase |
|---|---|---|
| 偏好 | `UserPreferences` 3 個欄位（`src/domain/types.ts:21-25`） | `user_preferences` 7 個欄位 |
| 事件 | `date` + `start`/`end` 字串 | all-day 日期組 **或** timed `timestamptz` 組 + IANA timezone（二選一 CHECK） |
| 日曆 | 不存在 | `calendars`，且 `events.calendar_id` 是 NOT NULL |

DP-013 要建立「兩個 adapter 共用 domain contract」，但 contract 本身還沒對齊，一開工就會被迫臨時決定 — 正好是 AGENTS.md §1 想避免的「implementation 中途才做設計決策」。

建議順序：**DP-012（定案 domain model）→ 修 P0 storage → DP-013**。

而且這件事會逼出本機 envelope 升到 `schemaVersion: 2` — 剛好是驗證 P0-2 那條 migration 路徑的第一個真實案例，兩件事可以互相驗證。

### P2-3 PWA 圖示只有 SVG，iOS 加到主畫面會是壞的

`public/manifest.webmanifest` 只提供一個 SVG，`index.html:10` 的 `apple-touch-icon` 也指向同一個檔案。但 **iOS Safari 不支援 SVG 的 apple-touch-icon** — 加到主畫面時會退回用網頁截圖當圖示。

對一個 mobile-first、主打「加到手機主畫面」的 App，這是使用者看到的第一個東西。補 180×180（apple-touch-icon）與 192／512 PNG 即可，SVG 可以留著給支援的瀏覽器。

---

## P3 — 小項目（可做可不做）

- **`package.json` 沒有 `engines`**，但 README 要求 Node 24+。補 `engines` 欄位與 `.nvmrc`，CI 與新機器才不會漂。
- **public repo 沒有 LICENSE**，預設等同保留所有權利。純個人專案無妨；想接受貢獻就要補。
- **更新檢查沒有節流**：`src/pwa/useAppUpdate.ts:94-96` 每次 `visibilitychange → visible` 都打一次 `version.json`。手機切換 App 極頻繁，建議加最小間隔（例如 5 分鐘），省流量與電。
- **現在就把全天事件的日期約定寫進 migration 註解**：目前 `end_date >= start_date` 是 inclusive，但 ICS 的 `DTEND` 是 exclusive。DP-027 做 ICS round-trip 時，這個約定沒寫死一定會來回改一輪。
- **`reminder_minutes` / `default_reminder_minutes` 是無約束的 `integer[]`**，可以塞負數或上萬筆。加個長度與範圍 CHECK 很便宜。
- **`events.timezone` 只檢查非空字串**，沒驗證是不是合法 IANA zone。AGENTS.md 把時區／DST 列為 high-risk，建議 DP-027 用 trigger 或 domain 補上（`pg_timezone_names` 不是 immutable，不能直接寫進 CHECK）。
- **`src/App.tsx:236-239` 的 `addOneHour` 在 23:xx 會 wrap 到隔天**，產生 end < start。目前只寫本機沒事，但 DB 的 `events_time_shape` CHECK 要求 `ends_at > starts_at`，DP-026 接線前要先修。
- **release note 的不可變性**：`release-notes.json` 中 v0.2.0 的內容在 PR #2 修正時被追加了一條。因為 0.2.0 還沒部署，這次沒問題。但建議定一條規則：**版本一旦部署，該版的 release note 就不再修改** — 否則已更新的使用者回頭看會看到跟當初不同的說明。

---

## 建議新增的任務（提案，待使用者確認後寫入 tasks.md）

| 建議 ID | 內容 | 建議位置 |
|---|---|---|
| DP-016 | 修正本機 storage 的兩條資料遺失路徑（P0-1、P0-2），補 mutate 路徑與 future-version 回歸測試，並加上 storage 不可用時的降級處理 | **Next**（優先於 DP-013） |
| DP-031 | 建立 CI（已在 Backlog） | 提前到 **Next** |
| DP-017 | 決定 `theme` 與 `month_weeks` 的去留；若保留則接上實作，若不保留則從 domain model 與 DB 移除 | Backlog |
| DP-018 | 更新 `寵物素材規範 Pet Asset Spec.md` 的名詞與情境框架、修正字元損毀、更新工程接入段落 | Backlog（DP-040 的前置） |
| DP-019 | 補齊 PWA 圖示（180／192／512 PNG） | Backlog |

## 交接注意事項

- 這份文件目前是 **untracked**，刻意不進 PR #2，以免違反 AGENTS.md §3「不要把不相關的整理混進功能 PR」。要保留的話請另開分支提交。
- 探針測試沒有進 repo；上面 P0 段落附了可直接使用的版本。
- 依 AGENTS.md §2，上述項目都屬「偵測到但範圍外的改善」，應該先提案再實作。請勿一次全部動手 — 建議先跟使用者確認優先順序，一次一個任務。
