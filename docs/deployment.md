# 部署 — GitHub Pages staging（DP-033）

這份文件記錄 DayPop 的部署管線、專案擁有者必須親自完成的設定，以及 rollback 與部署後的驗收清單。

canonical 來源仍是 [`../AGENTS.md`](../AGENTS.md) 與 [`../tasks.md`](../tasks.md)；這裡只寫部署本身。

---

## 1. 選定的平台與理由

**GitHub Pages 專案站台**，網址為 `https://yoyocadence.github.io/DayPop/`。

選它的理由：程式碼已經在 GitHub、不需要另一個帳號或帳單、部署成品就是 `dist/` 靜態檔，而 DayPop 的 production build 依設計沒有任何伺服器端邏輯（Auth、資料庫與 Storage 都在 Supabase）。

**它做不到的事，必須知道：**

- **不能設定 response header。** 因此 CSP 只能繼續以 `<meta>` 交付，而 meta 形式的 CSP **不涵蓋 `frame-ancestors`**——也就是無法阻止別的網站把 DayPop 嵌進 iframe。`X-Frame-Options` 同理無法設定。若日後這件事重要，要換到可以設 header 的平台（Cloudflare Pages、Netlify、Vercel 等），或加一層前置。這是選 GitHub Pages 的已知代價，不是漏做。
- **站台是公開的。** public repository 的 Pages 一定是公開網址，沒有密碼保護。任何知道網址的人都能開啟並註冊帳號。
- **沒有自訂 404 邏輯與 redirect 規則。** 只能靠 `404.html`（見下）。

---

## 2. base path：這件事會壞在哪裡

Pages 專案站台把 App 放在 `/DayPop/` 之下，不是網域根目錄。

`vite.config.ts` 的 `base` 預設是 `'./'`（相對），這讓 `dist/` 可以從任何路徑打開。`import.meta.env.BASE_URL` 會被寫進三個地方 ——

| 用途 | 程式位置 | base 為 `'./'` 時 |
| --- | --- | --- |
| service worker 註冊路徑與 scope | `src/pwa/useAppUpdate.ts` | 相對文件解析，**剛好正確**（`/DayPop/sw.js`） |
| 版本檢查抓 `version.json` 的網址 | `src/pwa/useAppUpdate.ts` | 相對文件解析，**剛好正確** |
| Supabase auth／密碼重設的 redirect 目標 | `src/lib/supabase.ts` 的 `getAuthRedirectUrl()` | **會壞** |

`getAuthRedirectUrl()` 是 `new URL(import.meta.env.BASE_URL, window.location.origin)` —— 第二個參數是 **origin 而不是目前網址**，所以 `'./'` 會解析成 `https://yoyocadence.github.io/`，把 `/DayPop/` 前綴整個丟掉。結果是 Email 驗證信與密碼重設連結會導回網域根目錄（那裡沒有 DayPop），而且該網址不在 Supabase 的 allowlist 內。

前兩項「剛好正確」不是可以依賴的性質 —— 它們正確只是因為文件本身就在 `/DayPop/`。用絕對 base 會把三處都變成明寫的路徑，而不是依賴解析規則：

```bash
npm run build -- --base=/DayPop/
```

`.github/workflows/deploy-staging.yml` 已經這樣做，並在建置後用 `grep` 斷言 base path 真的出現在 `dist/index.html`、`dist/404.html` 與 bundle 裡的 `sw.js` 註冊字串。base path 沒進去就讓建置失敗，而不是部署一個「開得起來但資源全 404」的站。

**改 repository 名稱時**，`BASE_PATH` 要一起改。

### `404.html`

`npm run build` 的 `postbuild`（`scripts/copy-spa-fallback.mjs`）會把 `dist/index.html` 複製一份為 `dist/404.html`。Pages 對找不到的路徑會回 `404.html`，所以任何 `/DayPop/` 底下的未知網址仍然會啟動 App，而不是顯示 GitHub 的 404 頁。用複製而不是 redirect，是因為瀏覽器要保留原本的網址 —— Supabase 的密碼重設與 OAuth 回程就是從那個網址讀 token 的。

---

## 3. 專案擁有者必須親自完成的設定

以下四項 agent 不能代做，也不應該代做。前三項完成前，第四項不會成功。

### 3.1 開啟 GitHub Pages

Repository → **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。

不要選 "Deploy from a branch" —— 那會需要一個 `gh-pages` 分支，和這裡的 workflow 是兩套機制。

### 3.2 設定 repository variables

Repository → **Settings → Secrets and variables → Actions → Variables** 新增兩個 **variables**（不是 secrets）：

| 名稱 | 值 |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase 專案的 URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase 的 publishable（anon）key |

放 variables 而不是 secrets 是刻意的：這兩個值**依設計就是公開的**，一定會被打包進前端 bundle，設成 secret 只會製造「它是機密」的錯覺，並讓 log 裡出現無意義的遮蔽。CI 至今不需要任何 secret，這一點維持不變。

**絕對不要**把 `service_role` 或任何伺服器端金鑰放進 variables 或 secrets 供前端建置使用。誤貼一次，那把金鑰就會被編進公開的 JavaScript，任何訪客都能繞過所有 RLS 讀寫整個資料庫。

沒設定這兩個值時，deploy workflow 會直接失敗並說明原因，而不是發布一個無法登入的站台。

### 金鑰格式是強制檢查的，不只是「有沒有填」

`VITE_SUPABASE_PUBLISHABLE_KEY` 會在**建置開始前**被分類（`src/lib/supabaseKey.ts`），三道關卡都是 fail closed：

| 關卡 | 位置 | 行為 |
| --- | --- | --- |
| 建置期 | `vite.config.ts` | 不是 publishable／anon 就 throw，**不產生任何輸出** |
| 執行期 | `src/lib/env.ts` | 拒絕建立 Supabase client |
| 產物掃描 | `npm run check:build` | 掃描 `dist/`，見下 |

接受：

- `sb_publishable_…`
- 舊式 JWT 且解碼後 `role === "anon"`

拒絕（含未知格式）：

- `sb_secret_…`
- 舊式 JWT 且 `role === "service_role"`
- 任何無法被正面辨識的值

產物掃描是獨立的最後一道防線，因為兩種洩漏的形狀不同：`sb_secret_…` 是明碼可見；而舊式 `service_role` JWT 把 role 藏在 base64url 裡，**在檔案裡搜尋 `service_role` 這個字串是找不到的**，必須把每個 JWT 形狀的 token 解碼才看得出來。

所有錯誤訊息只說明該怎麼修，不會輸出金鑰內容。

> Supabase 官方對兩種金鑰用途的說明：[API keys](https://supabase.com/docs/guides/api/api-keys)。

### 3.3 Supabase redirect allowlist

Supabase Dashboard → **Authentication → URL Configuration**：

- **Site URL**：`https://yoyocadence.github.io/DayPop/`
- **Redirect URLs** 加入：`https://yoyocadence.github.io/DayPop/`（本機開發用的 `http://localhost:5173/` 視需要保留）

沒有這一項，Email 驗證信與密碼重設連結會被 Supabase 拒絕或導回錯誤網址。

> **2026-08-22 更新：Google OAuth client 與 Supabase provider 已啟用**（DP-023 結案），App 的登入畫面因此同時提供 Email 與 Google。已知的 callback hostname 品牌差異見 §5.4。

### 3.4 觸發部署

Repository → **Actions → Deploy staging → Run workflow**，選要部署的 branch 或 tag。

部署只由人工觸發，不掛在 `push` 上 —— 發布是對外公開的動作，時機應由專案擁有者決定。

**DP-110 起，build job 在上傳產物前會比對線上的公告。** 它讀取站台目前的 `version.json`，要求「線上那一版在 `release-notes.json` 的條目原封不動」，且「同版號重新部署時，這次產出的 `version.json` 內容相同」；不符合就讓部署失敗，錯誤訊息會列出是哪個欄位不同。本機可用 `npm run build` 之後的 `npm run check:release-notes -- <線上 version.json 網址>` 先跑一次。規則與驗證見 §5.17。

---

## 4. Rollback

Rollback 就是「在舊的程式碼上重新跑一次同一個 workflow」。Pages 會以這次的成品覆蓋現有站台；因為每次部署都是完整的靜態成品，沒有「部分回滾」這種狀態。

**但 `workflow_dispatch` 能指定的 ref 是有限制的**，這決定了實際步驟：

| 方式 | 可指定的 ref |
| --- | --- |
| 網頁介面（Actions → Run workflow） | **只有 branch**，下拉選單不列 tag |
| `gh` CLI／REST API | **branch 或 tag** |
| 任何方式 | **不接受任意 commit SHA** |

（GitHub 文件：[Manually running a workflow](https://docs.github.com/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)、[Create a workflow dispatch event](https://docs.github.com/rest/actions/workflows#create-a-workflow-dispatch-event)。）

### 4.1 建議做法：每次部署先打 tag

部署前替該 commit 打一個 tag，rollback 才有明確的目標：

```bash
git tag -a deploy-2026-08-13 -m "staging 部署"
git push origin deploy-2026-08-13
```

之後用 CLI 回到該 tag：

```bash
gh workflow run deploy-staging.yml --ref deploy-2026-08-13
```

### 4.2 只能用網頁介面時

介面不列 tag，所以要先把想部署的 commit 變成一個 branch：

```bash
git branch rollback/staging <要回到的 commit 或 tag>
git push origin rollback/staging
```

再到 Actions → Deploy staging → Run workflow 選 `rollback/staging`。

> 注意：workflow 會以**被選中的那個 ref 上的 `deploy-staging.yml`** 執行。回到很舊的 commit 時，跑的是當時那一版的部署流程；若該版本還沒有這個 workflow，就得改用 4.1 的 tag 或先把 workflow 併進該 branch。

**回到舊版時要留意的兩件事：**

- **service worker 快取名稱帶版本**（`daypop-app-shell-<version>`）。回到舊版後，使用者手上的新版 service worker 仍在，直到它抓到舊的 `version.json` 才會回退。使用者端可能需要重新載入一次。
- **已部署版本的 release note 不可回寫修改**（AGENTS.md）。rollback 不等於可以改寫那一版的公告內容。
- **DP-110 的公告檢查不會擋 rollback**：這次要部署的版號比線上舊時，檢查只印出警告就放行 —— 被還原的 tag 不可能認得在它之後才發布的版本。回到「同版號、較舊的 commit」則照常比對，公告不同會失敗。DP-110 之前的 commit 沒有這一步。

---

## 5. 部署後的驗收清單

這份清單是 DP-033 的實際驗收；在 staging 網址上逐項確認：

- [x] `https://yoyocadence.github.io/DayPop/` 開得起來，四個分頁都在。
- [x] DevTools Network 沒有 404；所有資源都在 `/DayPop/` 底下。
- [x] Application → Service workers：scope 是 `https://yoyocadence.github.io/DayPop/`。
- [x] Application → Manifest：可安裝，圖示齊全，`start_url` 與 `scope` 都是 `/DayPop/`。
- [x] 重新整理不會 404；隨便打一個 `/DayPop/xxx` 也會回到 App（`404.html`）。
- [x] 設定分頁顯示「目前版本 v0.3.0」，且展得開 release note（代表 `version.json` 與 bundle 版本一致）。
- [x] 遊客模式可建立行程與待辦，重新載入後還在。
- [x] Email 註冊 → 收到驗證信 → 連結導回 `/DayPop/` 而不是網域根目錄。
- [x] 登入後建立資料 → 登出 → 重新登入，資料仍在（DP-034 的資料保存 smoke test 也需要這一項）。
- [x] Console 沒有 CSP violation。

> 上面兩項需要真實 Email 帳號的檢查，與 **DP-023** 的 end-to-end 驗收是同一件事。
>
> iOS Safari／Android Chrome 的實機外觀、safe area、觸控與無障礙屬 **DP-032**；備份還原、資料刪除、隱私說明與錯誤監控屬 **DP-034**。全部通過後才可以主動提醒專案擁有者「已達可開始日常使用的驗收點」—— 光是靜態頁發布成功不算。

### 5.1 首次部署的驗收結果（2026-08-13）

專案擁有者完成 §3 的四項設定後觸發部署，run `31702877290` 成功。以 Chromium（390×844、`zh-TW`／`Asia/Taipei`）對 `https://yoyocadence.github.io/DayPop/` 實測：

| 項目 | 結果 |
| --- | --- |
| 站台開啟、四個分頁 | 200，`日曆／搜尋／綜覽／設定` |
| service worker scope | `https://yoyocadence.github.io/DayPop/` |
| manifest `start_url`／`scope` | 兩者都是 `/DayPop/` |
| manifest 五個圖示 ＋ Apple touch icon | 全部 200 |
| `version.json` | `0.3.0`「完整日曆與雲端保存」 |
| 設定分頁版本與 release note | 顯示 `v0.3.0`，展開 11 條，與 `version.json` 相符 |
| 遊客建立行程 → 重新載入 | 資料仍在 |
| 未知路徑 `/DayPop/some/unknown/path` | 啟動 App 且保留原網址 |
| CSP violation | 0 |
| 離開 `/DayPop/` 範圍的同源請求 | 0 |

**2026-08-22 補驗完成**：專案擁有者以真實 Email 帳號完成註冊、收信、驗證連結導回 `/DayPop/#`、帳號 bootstrap、建立行程後顯示「已同步」、登出回到原 guest 資料、同帳號重登與 reload 後遠端行程仍存在；另完成 Google OAuth client／最小 `openid`、Email、profile scopes／Supabase provider 設定，以同 Email Google identity 登入、redirect、identity linking、同步與 session restore 全數通過。Google 目前保留 Supabase 預設 callback hostname；專案擁有者知悉 account chooser 會顯示隨機 project ref，並定案熟人使用階段接受，品牌化 custom domain 延後。DP-023 與 DP-033 的驗收條件至此完成；signup 終態修正 PR #59 已於 2026-08-22 由專案擁有者合併，**兩項任務均已移入 Done**。實機瀏覽器 QA（DP-032）與正式上線清單（DP-034）仍未完成，因此目前仍**不能**宣稱已達可開始日常使用的驗收點。

### 5.2 已知行為：SPA fallback 會回 404 狀態碼，且深層網址的相對連結會解析錯

**（a）Pages 的機制。** 供應 `404.html` 時 HTTP 狀態碼**就是 404**，只有內容是 App。實測 `/DayPop/some/unknown/path` 會正確啟動 App、保留網址，但文件請求本身就是一則 404。這不是 DayPop 的缺陷，若日後換到可自訂 rewrite 的平台就會消失。

**（b）DayPop 自己的缺陷 —— `index.html` 用的是文件相對路徑。✅ DP-068 已修正。**

> **修正後**：三個 link 改用 Vite 的 `%BASE_URL%` placeholder，部署建置會展開成 `/DayPop/…`。實測根路徑與深層網址下三者都解析到 `/DayPop/` 並回 200，manifest 也能正常解析成 JSON。`npm run check:build` 另加了一致性檢查：只要建置用的是絕對 base，這三個 link 就必須共用同一個 base。相對 base（預設 `./`）維持原樣，`dist/` 仍可從任何路徑打開。
>
> 下表保留為修正前的紀錄。

這三個 link 是手寫在 `index.html` 裡的，Vite 不會改寫它們（`--base` 只影響它自己產生的 `<script>`／`<link rel=stylesheet>`）：

| link | 在 `/DayPop/` 解析為 | 在 `/DayPop/some/unknown/path` 解析為 |
| --- | --- | --- |
| `rel=manifest` `./manifest.webmanifest` | `/DayPop/manifest.webmanifest`（200） | `/DayPop/some/unknown/manifest.webmanifest`（**404**） |
| `rel=icon` `./icons/daypop.svg` | `/DayPop/icons/daypop.svg`（200） | `/DayPop/some/unknown/icons/daypop.svg`（**404**） |
| `rel=apple-touch-icon` `./icons/apple-touch-icon-180.png` | 同上（200） | 同上（**404**） |

三個深層網址都回 `404` 且 `content-type: text/html`（Pages 把 `404.html` 也餵給它們），所以 manifest 拿到的是 HTML、會解析失敗 —— 在這類網址上 PWA 安裝資訊等於不可用。

**console 的 404 則數會因瀏覽器工作階段而異**：headless Chromium 不一定會去抓 `rel=icon`，只看到文件本身那一則；一般瀏覽器會抓，因此會看到兩則（文件 ＋ favicon）。複驗時看到的則數不同是正常的，根因是同一個。

**影響範圍有限但真實**：DayPop 目前沒有 router，正常入口與 Supabase 的 redirect 目標一律是 `/DayPop/` 本身（200），所以登入流程不受影響。真正會踩到的是使用者手動打錯網址、外部連結指向深層路徑，或日後加入路由時。

**DP-068 已於 2026-08-16 隨部署上線**；深層 fallback 的三個手寫 public link 現在都保留 `/DayPop/` base。

### 5.3 實測到的 response headers

| Header | 值 |
| --- | --- |
| `content-security-policy` | （無 —— CSP 由 `<meta>` 交付） |
| `x-frame-options` | （無） |
| `strict-transport-security` | `max-age=31556952` |
| `cache-control` | `max-age=600` |

證實了 §1 說的限制：Pages 不供應這兩個安全 header，所以 `frame-ancestors` 目前確實沒有涵蓋。

### 5.4 Google OAuth 的已知品牌差異

Google account chooser 目前會顯示 Supabase 預設的 `<project-ref>.supabase.co` callback hostname，而不是 DayPop 網址；這是 Supabase 預設 OAuth domain 的既有行為，不是 redirect drift。Google Cloud project 僅要求 `openid`、`userinfo.email`、`userinfo.profile` 三個基本登入 scope，Client Secret 只保存於 Google／Supabase 的 server-side 設定與專案擁有者的密碼管理器，未進 repo、前端環境變數或對話紀錄。專案擁有者已定案熟人使用階段保留 provider；若日後面向一般使用者，應先評估自有網域與 Supabase paid custom-domain add-on，再把新 callback URI 加到 Google client 後啟用，不能直接改掉既有 callback。

### 5.5 遊客 JSON 備份／還原自動化交接（DP-091，2026-09-30）

DP-034 的備份／還原項目已有 DP-056 的 domain、adapter 與元件測試，但瀏覽器整段流程只有一次手動 smoke 紀錄。DP-091 將其中可獨立完成的遊客 JSON 路徑加入既有 Playwright／CI；父任務仍未結案，這不是 staging 或正式上線驗收。

`e2e/json-backup.spec.ts` 使用 `e2e/fixtures/backupData.ts` 的純 synthetic 資料，預期值不經 production 匯入／匯出 helper 產生。資料包含兩個日曆、重複事件與取消／替換例外、跨午夜與多日全天事件、父子待辦、貼圖及非預設偏好。fixture 只寫入該測試的隔離 browser context 一次，reload 不重新灌資料，避免掩蓋保存失敗。

| 驗證路徑 | 通過條件 |
| --- | --- |
| 設定 → 匯出資料 → 真實 download | 檔名、格式與完整可攜資料正確，原 storage bytes 不變。 |
| UI 刪除／新增行程、修改寵物名字 → 選擇下載檔 | 預覽顯示正確筆數與取代警告，初始焦點在確認鈕；預覽期間不寫入。 |
| 取消 → 同頁重選同一檔 → Escape → reload | 兩種取消都保留原 bytes；同一 file input 可以再次觸發選檔。 |
| 重新選檔 → 取代資料 → reload → 再匯出 | 被刪除的事件回來，備份後新增事件移除，所有資料與偏好精確還原，revision 只增加一次；UI 與再次下載均一致。 |
| 截斷 JSON／較新格式版本／缺必要欄位 | 顯示對應錯誤、不開預覽、原 bytes 與 reload 結果不變；之後仍可選取有效檔案。 |

本機 Windows／Node 24.14.1，以 Chromium 390×844 與 1280×900 跑上述四個情境，共 **8/8** 通過；測試固定在 `2026-09-30T04:00:00Z`，每個案例均印出實際 `Intl.DateTimeFormat().resolvedOptions().timeZone = Asia/Taipei`，沒有宣稱跨時區矩陣。包含初始化在內的 console warning／error 與 pageerror 均要求為 0。

重跑：`npm run test:e2e -- e2e/json-backup.spec.ts`。完整 e2e 為 **25 passed、3 skipped**，跳過的是原有桌面專案不適用的手機橫向／短視窗案例；lint、typecheck、55 檔 647 個單元測試、build、check:build 通過。正式 bundle 仍有既有 >500 kB chunk 提示。為實際讀取下載檔與建立無效檔案，新增 `@types/node` 24 的開發相依並在 e2e TypeScript config 明確載入 Node 型別。

**仍待後續任務**：登入帳號 JSON 還原、ICS 瀏覽器流程、真機檔案選擇器、staging 備份還原，以及 DP-034 的資料刪除／隱私／監控／效能／PWA 更新等驗收。附件本來就不包含在 JSON 備份，這次也未驗證帳號帶附件時的取代阻擋 UI；其既有 domain／adapter 測試不等同實機驗收。DP-032 是否仍為 DP-034 放行前置，仍依任務板等待專案擁有者定案。

> **2026-10-01 更新**：上述登入帳號 JSON 路徑與附件取代阻擋 UI，已由 DP-092 補上本機 harness 回歸，詳見下一節；真實服務與裝置限制仍保留。

### 5.6 帳號 JSON 還原與匯入拒絕交接（DP-092，2026-10-01）

`e2e/account-json-backup.spec.ts` 沿用 dev-only auth harness，以真實 App、SessionDataProvider、authenticated／cached repository 配合 FakeSupabase，在 mobile／desktop 驗證兩個情境（共 **4/4** 通過）：

| 驗證路徑 | 通過條件 |
| --- | --- |
| UI 建立帳號事件、待辦及偏好 → 真實 JSON 下載 | 備份與帳號可攜資料一致，不含遊客行程。 |
| 刪除舊事件、新增事件及修改偏好 → 選檔／取消／重選／確認 | 預覽與取消不改快取；確認後舊事件與偏好還原、新事件移除，顯示成功及已同步。 |
| 登出 → 移除該測試帳號快取 → 重登 → 再匯出 | 新 adapter 重新讀回相同資料與偏好；登出只見原遊客行程，guest 原始 bytes 全程不變。 |
| 建立附件 → 匯出 → 改事件標題 → 選檔／確認 | 備份只有略過附件筆數、不含 metadata；確認取代被拒絕、預覽仍可操作且顯示錯誤，不顯示成功、不改快取與遊客資料。 |
| 拒絕後登出／移除帳號快取／重登 | 事件維持新標題，附件 metadata 與全部帳號資料仍在。 |

**本項找到並修正的問題**：附件保護的 `DataTransferError` 在任何寫入前就拒絕操作，但 DataProvider 原先把它當成 fatal load failure，導致整個 App 與預覽卸載。現在保留 ready snapshot 與既有同步警告，由等待 promise 的預覽呈現拒絕原因；rejection 後的 `saving` 也依實際剩餘 queue 清除或保留。未知錯誤、storage write barrier 與序列化順序維持原契約。沒有修改 schema、RPC 或附件保護規則。

新增三個 provider 單元案例涵蓋一般／快取警告狀態下的拒絕、後續操作及已排隊寫入；既有遠端寫入拒絕案例另驗證 `saving` 清除。修正前這四個斷言案例及附件 e2e 均先重現失敗；修正後 provider／race 兩檔 **16/16** 通過。

重跑：`npm run test:e2e -- e2e/account-json-backup.spec.ts`。本機 Windows／Node 24.14.1、Chromium 390×844 與 1280×900；固定在 `2026-10-01T04:00:00Z`，每個案例印出實際 browser timezone `Asia/Taipei`。初始化開始即監聽 console warning／error 與 pageerror，均要求為 0。

完整本機驗證：lint、typecheck、unit **55 檔 650/650**、build、check:build 通過；完整 e2e **29 passed、3 skipped**（原有桌面不適用的手機橫向／短視窗案例）。單元流程另印出實際 timezone `Etc/GMT-8`，本次未宣稱跨時區矩陣。build 仍有既有 >500 kB chunk 提示。

**限制與下一步**：harness 的 fake DB 只存在該頁記憶體，完整 page reload 會重建，故這裡用登出後清掉 synthetic account cache 再重登來證明 adapter 重新讀取，不能宣稱真實 Supabase durability、Auth session restore、RLS 或 Storage binary 保存已通過。沒有使用 Supabase MCP、真實帳號或正式資料。ICS 瀏覽器流程、真機檔案選擇器、staging 備份還原與 DP-034 其他驗收仍未完成；本子項不改變 DP-032／034 的放行決策。

> **2026-10-01 後續更新**：遊客 ICS 瀏覽器流程已由 DP-093 補上，見下一節；authenticated ICS、真實服務與裝置驗收仍待後續。

### 5.7 遊客 ICS 匯入／匯出自動化交接（DP-093，2026-10-01）

`e2e/ics-transfer.spec.ts` 使用真實 App 遊客入口與下載／選檔，沿用 DP-091 的豐富 synthetic 文件；`e2e/fixtures/icsTransfer.ts` 另提供手寫的匯出預期與外部 ICS bytes。預期值不經 production serializer／parser 產生。fixture 只灌入一次，reload 不會重設資料，初始 revision 為 7。

| 驗證路徑 | 通過條件 |
| --- | --- |
| 匯出 .ics → 真實 download | 核對檔名及四個完整 VEVENT；包含 RRULE、EXDATE、RECURRENCE-ID、跨午夜時間與全天 exclusive end。匯出不改 storage bytes。 |
| 選擇下載檔 → 取消／同頁重選／Escape／reload | 預覽顯示四個事件、兩個例外與三個 UID 碰撞；確認鈕初始有焦點，預覽與取消都不寫入，同一 file input 可重選。 |
| 再選下載檔 → 確認附加六筆 → reload | 只新增四個事件與兩個例外，revision 僅 +1；原日曆、事件、例外、待辦、貼圖與偏好逐欄保留。新 ID 不與既有列重複，取消／替換例外只指向新系列與新替換事件；列表顯示兩套獨立 occurrence 與跨午夜片段。 |
| 選擇手寫外部檔 → 確認 → reload／事件 sheet | 浮動時間依已保存的台北偏好解析，紐約 TZID 與 UTC 的 instant／timezone 維持原值；全天 end date 正確，文字換行、逗號、分號與 folded line 讀回正確。 |
| 無事件檔／第一筆有效但後續 TZID 無效 → 重新選有效檔 | 整份拒絕、不開預覽、不部分匯入，原 bytes 與 reload 結果不變；之後有效檔能確認附加且 reload 保存。 |

四個情境各在 mobile（390×844）與 desktop（1280×900）執行。瀏覽器明確設為 `America/New_York`，每個案例印出並斷言實際 `Intl.DateTimeFormat().resolvedOptions().timeZone`；文件偏好維持 `Asia/Taipei`，預設日曆刻意放在儲存陣列第二筆，避免裝置時區或第一筆日曆恰好與正確來源相同而掩蓋錯誤。日期固定為 `2026-09-30T04:00:00Z`，包含初始化在內的 console warning／error 與 pageerror 均要求為 0。重跑：`npm run test:e2e -- e2e/ics-transfer.spec.ts`。

本機 Windows／Node 24.14.1：新增 **8/8**，完整 e2e **37 passed、3 skipped**（原有桌面不適用案例）；lint、typecheck、unit **55 檔 650/650**、build、check:build 通過。第一次同時跑 unit／e2e 時，4 個既有元件案例超過 5 秒期限、沒有斷言失敗；browser 完成後以 `npm run test -- --maxWorkers=2` 重跑全部通過，未提高 timeout 或修改設定。單元流程實印 timezone `Etc/GMT-8`，build 仍有既有 >500 kB chunk 提示。

**格式界線與下一步**：ICS 是事件交換格式，這次明確確認現有 exporter 不帶待辦、偏好或 VALARM，imported event 使用預設日曆、空提醒與匯入時間戳；完整資料保存請使用 JSON 備份。沒有修改 runtime、schema、版本或部署，也未使用 Supabase MCP、真實帳號或正式資料。authenticated ICS、第三方服務實際互通、真機檔案選擇器、staging 備份還原及 DP-034 的其餘驗收仍未完成；父任務與 DP-032／034 放行決策不因本子項結案。

> **2026-10-01 帳號路徑更新**：authenticated ICS 的本機 harness 回歸已由 DP-094 補上，見下一節；真實服務與裝置限制仍保留。

### 5.8 帳號 ICS 匯入／匯出自動化交接（DP-094，2026-10-01）

`e2e/account-ics-transfer.spec.ts` 沿用 dev-only auth harness，讓真實 App、SessionDataProvider、authenticated／cached repository 配合 FakeSupabase。來源資料全部透過 UI 建立：帶附件的普通事件、每日系列及單次取消／改期、待辦與非預設寵物名字；外部 ICS 沿用 DP-093 的手寫 fixture。匯出預期用 UI 輸入與 literal ICS 欄位建立，不呼叫 production serializer／parser。

| 驗證路徑 | 通過條件 |
| --- | --- |
| UI 建立帳號資料 → 匯出 .ics → 真實 download | 核對檔名及三個完整 VEVENT，包含 RRULE、EXDATE、RECURRENCE-ID；不含附件 path／檔名、待辦、偏好、VALARM 或遊客事件，原帳號快取 bytes 不變。 |
| 選擇下載檔 → 取消／同頁重選／Escape | 預覽顯示三個事件、兩個例外與兩個 UID 碰撞，確認鈕初始有焦點；預覽與兩種取消不寫入，同一 file input 可重選。 |
| 再選下載檔 → 確認附加五筆 | 只新增三個事件與兩個例外；原事件／例外、日曆、待辦、貼圖、偏好與附件 metadata 逐欄保留。新 ID 唯一，新例外只指向新系列／替換；顯示成功及已同步。 |
| 登出 → 清除該測試帳號快取 → 重登 | 新 adapter 重新讀回完整結果，列表顯示兩套 occurrence；兩個同名事件只有原事件帶附件，ICS 副本沒有附件。登出只顯示遊客行程，guest bytes 全程不變。 |
| 第一個 VEVENT 有效、後續 TZID 非法 → 同頁選有效檔／取消 → 清快取重登 | 整份拒絕、不開預覽、不部分寫入，快取與 guest bytes 不變；拒絕後同一選檔入口仍可預覽及取消，新 adapter 讀回原資料。 |
| 再選有效外部檔 → 確認附加四筆 → 清快取重登 | 浮動／TZID／UTC／全天、文字轉義與換行依手寫預期讀回，原資料及附件保留，成功與已同步可見。 |

本機 Windows／Node 24.14.1，以 Chromium mobile 390×844 與 desktop 1280×900 執行兩個情境，共 **4/4** 通過。固定日期為 `2026-09-30T04:00:00Z`，每個案例印出並斷言實際 browser timezone `Asia/Taipei`；沒有宣稱跨時區矩陣。初始化起監聽 console warning／error 與 pageerror，均要求為 0。harness 的 server timestamp 固定為 `2026-08-09T00:00:00Z`，匯入後讀回須採此 server 值而非 browser clock。重跑：`npm run test:e2e -- e2e/account-ics-transfer.spec.ts`。

完整驗證：lint、typecheck、unit **55 檔 650/650**（`npm run test -- --maxWorkers=2`）、build、check:build 通過；完整 e2e **41 passed、3 skipped**，跳過原有桌面專案不適用的手機橫向／短視窗案例。單元流程另印出實際 timezone `Etc/GMT-8`，build 仍有既有 >500 kB chunk 提示。首輪一個桌面案例的最後斷言假設第一筆同名事件是原事件；改為逐筆檢查並要求附件數恰為 `[0, 1]`，避免依賴排序，runtime 與 timeout 未修改。

**限制與下一步**：ICS 只交換事件，附件不隨副本搬移；帳號有附件時仍允許 ICS 附加，JSON 取代的既有附件阻擋則由 DP-092 驗證。fake DB 只存在當頁記憶體，完整 page reload 會重建，因此以登出、只移除該 synthetic account cache、重登強制新 adapter 讀取；本項不證明真實 Supabase durability、Auth session restore、RLS 或 Storage binary 保存。沒有修改 runtime、harness、schema、版本或部署，未使用 Supabase MCP、真實帳號或正式資料。第三方日曆服務實際互通、真機檔案選擇器、staging 備份還原，以及 DP-034 的資料刪除／隱私／監控／效能／PWA 更新等驗收仍未完成；DP-032／034 的放行決策不因本子項改變。

### 5.9 真實 service worker 更新與資料保全回歸（DP-095，2026-10-01）

`e2e/service-worker.spec.ts` 直接在 Chromium 執行目前 `public/sw.js`，不 stub `navigator.serviceWorker`。`e2e/fixtures/workerSite.ts` 為每個測試建立獨立 loopback origin 與最小靜態 shell，scope 採 `/DayPop/`；讀取 worker 時先核對它等於 template 代入 package version 的內容。下一版 `999.0.0` 只是測試伺服器在記憶體裡替換 worker 的 `APP_VERSION`，不是正式 release，沒有回寫任何已部署版號、release note 或 generated asset。測試來源固定送 `Cache-Control: no-store`，避免把 HTTP cache 誤當成 worker 的 Cache Storage。

| 驗證路徑 | 通過條件 |
| --- | --- |
| 寫入 synthetic 使用者資料 → 註冊 current worker → 等待控制頁面 | scope 恰為 `/DayPop/`；guest、account cache、legacy 原始 bytes、`CALPET_FIRED`、IndexedDB sentinel 與非 DayPop Cache Storage 均保留。 |
| 取得 asset → 伺服器換新版 → `registration.update()` | asset 實際進入 current cache；新 worker 停在 installed／waiting，old active worker 仍控制頁面，舊 cache 尚未刪除，使用者儲存不變。 |
| 明確傳送 `SKIP_WAITING` → controllerchange → reload | 新 worker activated 且 waiting 清空，只清理舊 `daypop-app-shell-` cache；其他 cache 與使用者儲存不變，reload 取得新版 shell／asset。 |
| 刻意放入舊 `version.json` → 換伺服器版本 → online fetch | 回傳網路新版，伺服器確實收到 request；不得使用已放入的 stale cache。 |
| 離線 → navigation 到 scope 內另一個路徑 | 由 worker 回退到已快取的 index，asset 也從 Cache Storage 讀回；資料仍保留。這只證明已取得 shell／asset 的快取能力。 |
| 離線 fetch `version.json` → 恢復網路 → 開 scope 外頁面 | 版本 request 必須失敗，不能回舊快取；scope 外新頁面的 controller 必須為 null。 |

console 檢查只允許刻意離線版本 request 的一個 `ERR_INTERNET_DISCONNECTED`，且同時核對 error 類型、完整訊息、request URL 與出現次數；其他 console warning／error 與 pageerror 仍要求為 0。每個案例都印出並斷言實際 browser timezone `Asia/Taipei`。loopback fixture 在 `finally` 恢復網路並關閉 server／connections，不留下長期服務。

本機 Windows／Node 24.14.1，以 Chromium mobile 390×844 與 desktop 1280×900 執行兩個情境，新增 targeted **4/4** 首輪通過；完整 e2e **45 passed、3 skipped**（原有桌面不適用的橫向／短視窗案例）。lint、typecheck、unit **55 檔 650/650**（`npm run test -- --maxWorkers=2`）、build、check:build 全部通過。單元流程另印出實際 timezone `Etc/GMT-8`，build 保留既有 >500 kB chunk 提示。重跑：`npm run test:e2e -- e2e/service-worker.spec.ts`，沿用既有 Playwright／CI，不需要新增相依或 CI job。

**限制與下一步**：本項測的是 generated worker 與 browser storage contract，使用最小靜態 shell，未載入完整 production React App；直接傳送 `SKIP_WAITING` 不等於已驗證 App 的「立即更新」按鈕、controllerchange 自動 reload、更新後登入狀態或 production bundle 的離線完整性。未驗證全新安裝未曾取得的 asset、離線寫入佇列、真機 PWA 或 staging 更新。沒有修改 runtime、worker template、release、schema 或部署，也未使用 Supabase MCP／真實帳號。DP-034 的完整 App 更新 smoke test、資料刪除／隱私／監控／效能與放行決策仍待後續。

### 5.10 Production 遊客 PWA 更新與自動 reload（DP-096，2026-10-01）

> **2026-10-01 工具交接（DP-098）**：`output/playwright/` 保存測試產物，不是來源。它已在 `.gitignore`，但 ESLint 不會自動沿用 Git 排除規則；實測 production generated JS 的 `isPathIgnored()` 原為 false，因此 `eslint.config.js` 的 global ignores 新增此目錄。只排除這個目錄，不擴至 `e2e` 或整個 `output`，不刪除除錯產物。
>
> 本機 API 驗證 64 個 generated JS 均 ignored，137 個 `src` 與 17 個 `e2e` TS／TSX 均未被忽略，且其他 `output` TS 路徑仍受檢查；App／e2e spec／fixture 的三個 `lintText()` 未使用變數負向檢查全部報錯。`npm run lint`、`npm run typecheck` 通過；只改設定，本機未重跑 runtime／browser／DB，完整驗證由既有 PR CI 執行。日後新增來源請留在 `src`／`e2e`，Playwright 產物沿用 `output/playwright`。

承接 DP-095 的完整 App 交接，`e2e/production-update.spec.ts` 使用真正的 `src/main.tsx` production build、AppUpdateProvider 與瀏覽器 service worker，沒有 Auth harness 或 worker stub。`e2e/fixtures/productionUpdateSite.ts` 透過既有 Vite config 建置目前版本與 synthetic `999.0.0`，保留建置期金鑰檢查、將測試 build 的公開 Auth 設定設為空，並斷言沒有對外 request。產物只寫入 ignored `output/playwright/production-updates/` 的獨立目錄，`emptyOutDir: false` 不清除其他輸出（**2026-10-03 更新（DP-109）**：改為建在系統暫存目錄，讀進記憶體後立即刪除，不再寫進專案）；目前 worker 必須逐字符合 generated template／package version，合成新版的 worker 與公告只存在測試產物／記憶體，不回寫 release assets。

每個案例有自己的 loopback origin、`/DayPop/` base 與 scope，HTTP 回應使用 `Cache-Control: no-store`。完整 schema-v4 fixture 與目前版的公告已讀紀錄只在 blank setup page 寫入一次，沒有 reload 會重灌的 init script。更新後逐字比對 guest envelope（含 revision／timestamp、重複取消／替換、跨午夜及全天行程、子待辦、貼圖、非預設偏好），並從畫面確認暖陽主題、寵物名字及 occurrence 列表。

| 驗證路徑 | 通過條件 |
| --- | --- |
| current App → 提供新版 → 檢查更新 → worker waiting → 稍後提醒 | App 留在舊 build，沒有新 navigation，資料與目前版已讀紀錄不變。 |
| 手動再檢查 → 立即更新 | 由 App 自動 reload 一次取得新版 production bundle（測試不呼叫 `page.reload()`），新版 UI 與 `version.json` 一致，僅留下新版 app-shell cache；資料保留、公告記為已讀且不重複顯示，手動再檢查顯示「目前已是最新版本」。 |
| 新版 `index.html` 安裝快取 request 被 gate 暫停 → installing 時按立即更新 | 保持原頁「準備更新…」且兩個按鈕停用，不提早 navigation；釋放 gate 後完成安裝、啟用、自動 reload 與相同資料驗證。gate 不擋 root navigation，因此能抓到錯誤的提早 reload。 |

**回歸重現與必要修正**：第一條流程通過後，安裝中案例在原實作失敗：`registration.update()` 可以在 worker 尚未完成 install／`cache.addAll` 時 resolve，當時沒有 waiting worker，`updateNow()` 便落入 reload fallback。新 build 雖載入，舊頁的 `applyWhenReady` 意圖已丟失，仍由舊 worker 控制。`useAppUpdate.ts` 只補上「有 installing worker 就返回等待」；既有 statechange listener 在安裝完成後送 `SKIP_WAITING`，controllerchange 才 reload。新增兩個單元案例確認這個時序與沒有 waiting／installing worker 時仍保留 reload fallback。

本機 Windows／Node 24.14.1，在 mobile 390×844 與 desktop 1280×900 的 targeted **4/4** 通過；完整 e2e **49 passed、3 skipped**（原有桌面不適用的橫向／短視窗案例），console warning／error、pageerror 與對外 request 為 0。lint、typecheck、unit **55 檔 652/652**（`--maxWorkers=2`）、build、check:build 全部通過；各 production 案例印出實際 timezone `Asia/Taipei`，本機 Node 為 `Etc/GMT-8`，build 保留既有 >500 kB chunk 提示。重跑：`npm run test:e2e -- e2e/production-update.spec.ts`，沿用既有 CI、不需新增相依或 job。

**限制與下一步**：這是本機 Chromium 的 production 遊客流程，未驗證更新後真實 Auth session、account cache／遠端 adapter 重新初始化、真機 PWA、staging 更新、production bundle 完整離線、安裝失敗／重試，或部署時舊 hashed assets 已移除的情境（測試站保留舊 assets）。worker／release note／schema／版號／部署均未修改，未使用 Supabase MCP／正式帳號／正式資料；這項修正仍需隨後續 release 發布。DP-034 的資料刪除、隱私、監控、效能及上線放行仍未完成，不改變 DP-032／034 的待決關係。
#### 5.10.1 已快取 production 遊客 App 的離線另開頁回歸（DP-099，2026-10-02）

`e2e/production-offline.spec.ts` 沿用 DP-096 的 production build／隔離 loopback fixture 與 generated worker。先在線上註冊並取得 controller，再做一次受控制的線上 reload、實際使用設定及列表，逐一確認 HTML 宣告的 JS／CSS 已進入該版 Cache Storage；不直接灌入快取。測試伺服器所有回應都是 `no-store`。完整 schema-v4 synthetic envelope 與 release 已讀 bytes 只在 setup page 灌一次，原頁關閉後另開空白頁，切成離線後才首次導向 `/DayPop/offline-return`，沒有 reseed 或 runtime stub。

| 驗證路徑 | 通過條件 |
| --- | --- |
| 離線另開 scope 內頁面 | URL／title 正確，HTML、JS、CSS 的 response 均標示 `fromServiceWorker()`；完整 envelope bytes 保留，暖陽主題、寵物名字、取消／改期 occurrence 與跨午夜片段可讀。 |
| 離線修改全天行程標題及寵物名字 | revision 由 7 到 9，兩筆時間戳採固定 instant；完整資料與獨立預期比較，其他日曆、事件、例外、待辦／子項、貼圖及偏好保持原值。 |
| 人工檢查更新 → 關閉失敗回饋 → 離線 reload | 顯示「暫時無法檢查更新」及資料不受影響的說明；新 App 實例讀回編輯後 bytes，伺服器 navigation／version counters 在整段離線期間不增加。 |
| 恢復網路 → 再次人工檢查 | 顯示「目前已是最新版本」，伺服器確實收到新 request，編輯後 bytes 與已讀公告不變。 |

console 只允許三筆已核對完整 version URL（含固定 `ts`）、error 等級與 `ERR_INTERNET_DISCONNECTED` 文字的錯誤，並要求對應的三個 page request 實際 failed；其餘 warning／error、pageerror、意外 request failure 及對外 request 均為 0。三筆分別是新頁自動檢查、人工檢查、reload 自動檢查，不能用全面忽略離線 console 代替。

**測試工具限制**：本機 Playwright 1.62.1 在新 document 離線時實測原生 `navigator.onLine` 仍為 true；與 [上游 #42174](https://github.com/microsoft/playwright/issues/42174) 的回歸相符。測試印出這個原值、不偽造 navigator，也不把它當離線證據；使用 `context.setOffline(true)`、實際失敗 request、未增加的 server counters 及 worker 回應核對真正的網路／快取路徑。恢復連線後以成功的 UI 與 server request 證明，不宣稱已驗證原生 online／offline event。

本機 Windows／Node 24.14.1：手機 390×844、桌面 1280×900 新增 targeted **2/2** 通過；每個案例印出並斷言實際 browser timezone `Asia/Taipei`，單元程序另印出 `Etc/GMT-8`。lint、typecheck、unit **55 檔 652/652**（`--maxWorkers=2`）、build、check:build 通過；完整 e2e **51 passed、3 skipped**（原有桌面不適用案例）。build 保留既有 >500 kB chunk 提示。重跑：`npm run test:e2e -- e2e/production-offline.spec.ts`。

**限制與下一步**：只驗證同一 browser context 中，已快取且曾由 worker 控制的 production 遊客 App 另開頁／reload；沒有停止並重啟 browser process。首次安裝未控制的載入、未快取 asset／其他主題字體、移除快取／quota、帳號 session／遠端 adapter／離線寫入 queue、真機 PWA 與 staging 均未涵蓋，不能宣稱完整離線已完成。只新增測試與交接，未改 runtime、worker template、schema、release、版號或部署，未使用 Supabase MCP／正式帳號／正式資料。DP-034 父任務與 DP-032／034 的放行決策仍未完成。

### 5.11 PWA 下載／安裝失敗復原與重試（DP-097，2026-10-01）

承接 DP-096 的失敗路徑交接，沿用兩份真正 production build 與隔離 loopback origin，不新增 harness、依賴或 CI job。`e2e/fixtures/productionUpdateSite.ts` 可讓新版 `sw.js` 回 HTTP 503，或在原有 install gate 釋放時讓 `/DayPop/index.html` 回 503，使真正的 `cache.addAll` 拒絕、worker 進入 redundant；root navigation 仍可正常取得 App，不把 navigation 失敗混成安裝失敗。

新回歸在修改前重現兩個問題：script 下載失敗留下未處理 Promise rejection（pageerror）；install 失敗後準備中狀態不會解除，兩個按鈕一直停用。`useAppUpdate` 現在捕捉更新 request／啟用訊息的失敗，並觀察 installing → redundant；失敗時清除待啟用、controllerchange reload 與暫存 waiting worker 的意圖，解除 preparing，保留 available release／使用者資料。若失敗事件早於 `update()` resolve，該次 request 也不得繼續落入 reload fallback。舊 activated worker 正常退役變成 redundant 不算安裝失敗，有獨立單元回歸。

更新嘗試有獨立的 `updateError`，`App` 將它傳給原 `UpdateDialog`，以既有 `.update-error` 樣式與 `role="alert"` 顯示可採取的處理方式；不改 CSS、canonical token、正常成功畫面或更新按鈕文案。重試及稍後提醒會清除這筆錯誤。這個欄位不混入手動版本檢查的 `checkResult`；已讀公告仍代表使用者已閱讀，不代表安裝成功，沿用 DP-090 的既有規則。

| 新增驗證路徑 | 通過條件 |
| --- | --- |
| 新版 script 回 503 → 立即更新 | 顯示「無法取得新版程式」，沒有 pageerror、navigation 或資料改寫；兩個按鈕重新可用，舊 worker／cache 保留。恢復 script 回應後，可在同一個 dialog 重試成功並自動載入新版。 |
| gate 暫停 install → 立即更新 → index 回 503 | 真正的安裝失敗後顯示「新版安裝未完成」、解除準備中，原 App／activated controller／guest bytes 保留。可稍後提醒回到日曆；恢復回應後手動重新檢查，再更新成功。 |

兩條情境各跑 mobile／desktop；成功重試後沿用 DP-096 的完整 envelope 逐字比對、主題／寵物名字／occurrence 列表、新版 bundle／cache 與公告已讀驗證。資料只在初始 setup page 寫入一次；所有原頁 console warning／error、pageerror 與對外 request 仍要求 0，沒有放寬監控來容忍原本的 unhandled rejection。

本機 Windows／Node 24.14.1，production targeted **8/8**（本項新增 **4/4**）；完整 e2e **53 passed、3 skipped**（原有桌面不適用的橫向／短視窗案例）。lint、typecheck、unit **55 檔 656/656**（`--maxWorkers=2`）、build、check:build 全部通過，build 保留既有 >500 kB chunk 提示。production 案例印出實際 timezone `Asia/Taipei`，單元流程印出 `Etc/GMT-8`。重跑：`npm run test:e2e -- e2e/production-update.spec.ts`；只跑失敗路徑可加 `--grep '失敗'`。

**限制與下一步**：503 是決定性的服務失敗，不等於已驗證裝置實際斷線、storage quota、長時間無回應、worker activation／clients.claim 失敗或多分頁競態。更新後真實 Auth／account adapter 初始化、production bundle 完整離線、真機、staging 與舊 hashed assets 已移除的部署仍未涵蓋。未使用 Supabase MCP、真實帳號或正式資料，worker template、schema、版本、release assets 與部署不變；修正仍待後續 release 發布。DP-034 與上線放行保持未完成。另確認 ESLint 未忽略已被 Git 排除的 `output/playwright/production-updates/` generated JS，獨立登記 DP-098，不在本次改 lint config 或刪產物。

#### 5.11.1 待審 PR 與最新基線整合（DP-100，2026-10-02）

PR #89 已合併後，GitHub 回報仍為 Open 的 PR #87 `mergeable: false`。本項從最新 `origin/main`（`7a513ad`）建立本機 `chore/dp-100-refresh-update-pr`，整合原 PR commit `c14df6b`；只有 `tasks.md` 與本文件發生內容衝突。保留 DP-097 的修正／原驗證紀錄及已合併 DP-098／099 的成果，DP-098 只保留 Done、不重新列 Backlog。歷史紀錄仍保留當時狀態；目前進度以此補充及任務板為準。

範圍核對：相對原 PR commit `c14df6b` 的 `src`、`e2e/production-update.spec.ts`、`e2e/fixtures/productionUpdateSite.ts` 與 `docs/prototype-behavior-baseline.md` 差異為空；相對 `origin/main` 的 `eslint.config.js` 與 `e2e/production-offline.spec.ts` 差異亦為空。沒有新增 runtime／browser 行為、改 release／schema／部署，原變更仍由 DP-097 的回歸保護。

本機 Windows／Node 24.14.1：lint、typecheck、unit **55 檔 656/656**（`--maxWorkers=2`）、build、check:build 全部通過；完整 e2e **55 passed、3 skipped**，含 DP-097 更新失敗／重試與 DP-099 已快取遊客 App 離線情境，跳過項都是原有桌面不適用案例。Node 實際 timezone 印出 `Etc/GMT-8`，browser 印出 `Asia/Taipei`／`America/New_York`；build 保留既有 >500 kB chunk 提示。ESLint API 確認 generated 產物 ignored、`e2e/production-offline.spec.ts` 未被忽略。

合併 commit 會保留兩邊歷史，以 fast-forward 更新既有遠端 `fix/dp-097-pwa-update-retry` 及 PR #87，不 force push、不新增重複 PR，也不推 main 或操作 GitHub 合併。CI 與可合併狀態在 push 後另行核對；這只恢復可審查狀態，DP-034 上線放行、真實 Auth／account adapter、quota／多分頁、真機及 staging 限制仍保留，未使用 Supabase MCP／正式帳號／正式資料。

### 5.12 不可讀資料的備份與重設（DP-101，2026-10-02）

PR #87 合併後，從最新 `origin/main`（`5255438`）獨立開分支，依 ADR §1 的原始內容保存規則補上復原回歸。原本 UI 以最後一個 backup key 開放重設，`resetUserData()` 也只檢查是否有任何備份；使用者留下先前文件的備份時，新的 corrupt／future 原始內容仍未備份卻可被覆寫。修正前 3 個 storage 單元案例重現未拒絕，兩條 production 手機案例在 `toBeDisabled()` 重現錯誤開放。

`findMatchingUserDataBackup()` 對原始字串逐字比較，不 parse／重新序列化不可讀內容；UI 初始化只認領相符備份，較新的無關 backup 不會遮蔽較舊的相符 backup。`resetUserData()` 在執行前重新讀取目前 key，再走同一檢查；備份後原始內容變動時拒絕重設，保留 key 與舊備份。此修正不改 UI 版面、延遲初始化或既有下載／明確按重設的流程。

`e2e/production-storage-recovery.spec.ts` 沿用隔離 loopback production fixture／generated worker，關閉真實 Auth，手機 390×844 與桌面 1280×900 各跑截斷 JSON、較新 schema 兩條情境。原始內容與 sentinel 只在 setup page 寫一次，沒有 init script 在 reload 重灌。

| 驗證路徑 | 通過條件 |
| --- | --- |
| 舊 backup＋新的不可讀資料 → 開啟及 reload | 原始 bytes 不變、復原原因正確、重設停用、正常編輯／分頁入口隱藏；future 顯示先更新 App 建議。 |
| 備份並下載 → 較新無關 backup → reload | 真實 download 逐字保留原始字串（含空白、中文與換行），本機相符備份存在、原始 key 不變，畫面認領相符 key 並開放重設。 |
| 明確按重設 → 設定／reload | schema v4、revision 1、空事項與單一預設日曆，漫畫／摩卡偏好可見；reload 後 envelope bytes 相同。相符／不相符舊備份、calpet.v2、CALPET_FIRED、synthetic account cache 及其他 key 不變。 |

新增 4 個單元案例涵蓋無關舊備份、備份後原始內容變動、相同 JSON 值但 bytes 不同、較舊相符備份可使用；局部 **20/20**。本機 Windows／Node 24.14.1：lint、typecheck、完整 unit **55 檔 660/660**（`--maxWorkers=2`）、build、check:build 全部通過，targeted **4/4**，完整 e2e **59 passed、3 skipped**（原有桌面不適用案例）。新增案例要求 console warning／error、pageerror、意外失敗 request 與對外 request 為 0。browser 實際 timezone 印出並斷言 `Asia/Taipei`，Node 印出 `Etc/GMT-8`；保留既有 >500 kB chunk 提示。重跑：`npm run test:e2e -- e2e/production-storage-recovery.spec.ts`。

**限制與下一步**：只驗證 persistent guest 的不可讀資料復原。重設 guard 能拒絕「進入重設前已變動」的資料，不提供跨分頁原子鎖，沒有驗證真正同時 interleaving。記憶體模式、quota、下載取消／OS 封鎖、valid data 全刪除、帳號刪除、真機與 staging 仍未驗證。未使用 Supabase MCP／正式帳號／正式資料，不改 schema／Auth／worker template／release assets／版本或部署；修正待後續 release，DP-034 父任務與上線放行保持未完成。

### 5.13 遊客編輯中途儲存額度不足（DP-102，2026-10-02）

PR #90 合併後，從最新 `origin/main`（`f74e8e3`）獨立開分支，承接 DP-017／101 的 quota 交接。`e2e/production-storage-quota.spec.ts` 沿用隔離 loopback production fixture、真實 App／generated worker 及完整 schema-v4 synthetic 資料；Auth 公開設定為空，不連真實服務。資料與 sentinel 只在 blank setup page 寫一次，reload 不重灌。

App 正常啟動並讀回偏好／occurrence 後，測試才以 `quota-test.fill.*` 無關 key 填滿該 origin 的原生 localStorage。依序使用 256 Ki、16 Ki、1 Ki 字元塊，每階段最多 128 次；要求各階段真正拋出 `DOMException`／`QuotaExceededError`，並印出實際填入字元數。不替換 Storage 方法、不假造 mode，也不把額度硬編成固定大小。修改全天事件時增加超過最小填充塊的備註，使既有 envelope 寫入也必須超額；填充 key 不屬於 `daypop.*`，不增加 AppStorage 的記憶體複製量。

| 驗證路徑 | 通過條件 |
| --- | --- |
| persistent App → 填滿額度 → 編輯事件 | 修改留在列表；日曆／搜尋／綜覽／設定皆顯示不可關閉的 `role=status` 儲存警告，明示分頁內容重新整理後消失。 |
| 額度仍滿 → 真實 JSON 下載 | 完整可攜資料只改事件標題／備註及其時間戳，其餘日曆、事件、重複例外、待辦、貼圖及偏好保留；原始 guest envelope、backup、legacy、account cache sentinel 與其他 key 逐字不變。 |
| 只移除本次填充 → 原生寫入成功 → 再改寵物名字 | 同一 session 仍顯示警告；第二份真實下載保留兩次修改，localStorage 全部 entries 仍等於原始文件，不自動恢復持久化或補寫。 |
| 釋放空間後 reload | 警告消失，讀回原始偏好與 occurrence，記憶體修改消失；全部 durable entries 保留。 |

本機 Windows／Node 24.14.1，Chromium mobile 390×844 與 desktop 1280×900 的 targeted **2/2** 通過。新增案例要求 console warning／error、pageerror、意外失敗 request 與對外 request 為 0；印出並斷言實際 browser timezone `Asia/Taipei`。首輪只因測試備註尾端空白被既有表單 `trim` 而失敗，調整輸入後通過，runtime 未改。重跑：`npm run test:e2e -- e2e/production-storage-quota.spec.ts`。

完整驗證：lint、typecheck、unit **55 檔 660/660**（`npm run test -- --maxWorkers=2`）、build、check:build 通過；完整 e2e **61 passed、3 skipped**（原有桌面不適用的橫向／短視窗案例）。Node 實際 timezone 印出 `Etc/GMT-8`；build 保留既有 >500 kB chunk 提示，沒有回寫版本或 release assets。

**限制與下一步**：只驗證已正常啟動的 guest 在編輯途中 persistent→memory，以及釋放額度後 reload。開機 probe 就失敗、storage 存取被安全政策禁止、corrupt／future 的記憶體復原、下載取消、多分頁競態、實際帳號快取降級、真機與 staging 仍未驗證。未修改 runtime、schema、Auth、worker template、release／版本或部署，未使用 Supabase MCP／正式帳號／正式資料。後續可獨立補開機／blocked storage 或記憶體復原案例；DP-034 父任務與上線放行仍未完成。

### 5.14 備份遇到 quota 的記憶體復原（DP-103，2026-10-02）

PR #91 合併後，從最新 `origin/main`（`09f7166`）獨立開分支，依 ADR §1 的兩個獨立狀態軸補上交接：不可讀資料仍需備份，storage 無法持久化時則只在記憶體工作並持續警告。`e2e/production-storage-recovery.spec.ts` 新增 corrupt／future 兩個情境 × mobile／desktop，共 4 個 production browser cases；沿用隔離 loopback fixture、真實 App／generated worker，Auth 公開設定為空。資料只在 setup page 寫一次，reload 不重灌。

復原畫面先在可持久化狀態確認重設停用與舊備份不相符，再填滿原生 localStorage。原始內容保留中文／換行並增加 2048 個尾端空白，確保連較短的 corrupt 備份都超過最後 1 Ki 字元填充塊的剩餘額度。從 DP-102 抽出相同填充流程至 `e2e/fixtures/storageQuota.ts` 供兩個 spec 共用，維持三階段、每階段最多 128 次與真正 `DOMException`／`QuotaExceededError` 的斷言，不替換 Storage API。

| 驗證路徑 | 通過條件 |
| --- | --- |
| 復原畫面 → 原生 quota → 備份並下載 | 下載內容逐字等於 raw bytes；App 降級且復原畫面顯示不可保存警告，備份文案指向下載檔案、不宣稱已持久化；新 backup key 不在原生 localStorage，原資料與 sentinel 不變。 |
| 相符記憶體備份 → 明確重設 | 正常分頁恢復，四分頁仍有不可關閉的 `role=status` 警告，漫畫／摩卡預設可見。 |
| 釋放本次填充 → 原生寫入恢復 → 修改偏好／JSON 下載 | 同一 session 仍為記憶體；下載包含單一預設日曆、空事件／例外／待辦／貼圖、修改後偏好，全部 durable entries 仍是原本 blocked 文件與 sentinel。 |
| reload | 再次顯示原本 corrupt／future 原因，編輯入口隱藏、重設停用；記憶體 backup 與成功訊息消失，沒有把空資料或編輯結果補寫到磁碟。 |

本機 Windows／Node 24.14.1，Chromium mobile 390×844 與 desktop 1280×900 的新增 targeted **4/4** 通過；首輪既有 DP-101／102 六條案例也通過。新增案例 console warning／error、pageerror、意外失敗 request 與對外 request 為 0，實際 browser timezone 印出並斷言 `Asia/Taipei`。首輪新案例的精確檔名斷言遇到 Windows Chromium 將 ISO 時間冒號改成底線，改為正規化這項原生差異後通過，仍逐字核對下載內容，runtime 未改。重跑：`npm run test:e2e -- e2e/production-storage-recovery.spec.ts -g '備份遇 quota'`；全部 storage 路徑可同時指定該 spec 與 `e2e/production-storage-quota.spec.ts`。

完整驗證：lint、typecheck、unit **55 檔 660/660**（`npm run test -- --maxWorkers=2`）、build、check:build 通過，完整 e2e **65 passed、3 skipped**（原有桌面不適用的橫向／短視窗案例）。Node 實際 timezone 印出 `Etc/GMT-8`；build 保留既有 >500 kB chunk 提示，generated release assets 沒有帶入變更。

**限制與下一步**：只涵蓋原本可以讀取 storage、備份寫入時遇到 quota 的復原。開機 probe／storage 存取封鎖、下載取消／OS 封鎖、原始文件在多分頁間真正同時改動、實際帳號快取、真機與 staging 仍未驗證；下載成功只代表本次 Chromium 測試檔案可讀，不代表 App 可偵測所有使用者取消或 OS 層失敗。未修改 runtime、schema、Auth、worker template、release／版本或部署，未使用 Supabase MCP／正式帳號／正式資料。後續可獨立補開機／blocked storage 或下載失敗回饋；DP-034 父任務與上線放行仍未完成。

#### 5.14.1 待審 PR 與最新基線整合（DP-105，2026-10-02）

PR #93（DP-104）合併後，GitHub 回報仍為 Open 的 PR #92 `mergeable: CONFLICTING`。本項從最新 `origin/main`（`6c9de6d`）建立本機 `chore/dp-105-refresh-memory-recovery-pr`，整合原 PR commit `d623033`；只有 `tasks.md`、本文件與 `docs/prototype-behavior-baseline.md` 發生內容衝突，共五處，全部是兩個任務在同一位置各自新增紀錄。兩側內容全留、不改寫，本文件依章節順序把 §5.14 排在 §5.15 之前。歷史紀錄仍保留當時狀態：§5.14 的 **65 passed** 與 §5.15 的 **63 passed** 各自量於不含對方的分支，目前進度以此補充及任務板為準。

範圍核對：相對原 PR commit `d623033` 的 `e2e/fixtures/storageQuota.ts`、`e2e/production-storage-quota.spec.ts`、`e2e/production-storage-recovery.spec.ts` 差異為空；相對 `origin/main` 的 `src`、`e2e/production-unavailable-storage.spec.ts`、`e2e/support.ts`、`e2e/fixtures/productionUpdateSite.ts`、`package.json`／lockfile、`release-notes.json`、`pwa`、`public`、`supabase`、`.github` 與 `scripts` 差異亦為空。DP-104 的 spec 沒有改用共用 quota fixture —— 它驗的是 API 為 null，不需要填充。沒有新增 runtime／browser 行為或測試情境。

本機 Windows／Node 24.14.1：lint、typecheck、unit **55 檔 660/660**（`--maxWorkers=2`）、build、check:build 全部通過；完整 e2e **67 passed、3 skipped**、無 flaky／重試，含 DP-103 的 4 個備份遇 quota 案例與 DP-104 的 2 個開機案例，跳過項都是原有桌面不適用案例。Node 實際 timezone 印出 `Etc/GMT-8`，browser 印出 `Asia/Taipei`／`America/New_York`；build 保留既有 >500 kB chunk 提示。build 重新產生的 `public/version.json` 只有換行差異、內容相同，未納入提交。

合併 commit 保留兩邊歷史，以 fast-forward 更新既有遠端 `test/dp-103-memory-storage-recovery` 及 PR #92，不 force push、不新增重複 PR，也不推 main 或操作 GitHub 合併。CI 與可合併狀態在 push 後另行核對。這只恢復可審查狀態，未使用 Supabase MCP／正式帳號／正式資料；DP-034 上線放行、真機及 staging 限制仍保留。

**下一步的候選（只從程式碼讀出、未實測，不是結論）**：§5.15 留下的「初始 quota」值得先做。`getAppStorage()` 在開機 probe 失敗時是以**空的** `MemoryStorage` 起始，而中途降級的 `#degrade()` 會把仍讀得到的 `daypop.*`／legacy key 帶進記憶體。若開機當下只是寫入被拒（例如額度剛好滿）、既有資料其實仍可讀，這條路徑可能讓使用者看到空白預設資料、匯出也拿不到原本的內容 —— 磁碟上的 bytes 不會被動到，但看起來像資料不見。要先以原生 quota 在 production App 重現並確認實際行為；若成立，開機時是否沿用可讀內容屬於行為決策，應另立任務，不要當成測試補強順手改。

> **2026-10-02 更新**：上面的候選已由 DP-106 實測成立，並依專案擁有者要求的建議修正，見 §5.16。

### 5.15 Production 開機 localStorage 不可用（DP-104，2026-10-02）

承接 DP-017／102 的開機交接，從實際最新 `origin/main`（`09f7166`）獨立開分支。開工核對 PR #92（DP-103）仍為 Open，本項不依賴或搬入其 quota helper／案例；§5.14 保留給該待審 PR 的記憶體復原交接。

`e2e/production-unavailable-storage.spec.ts` 沿用隔離 loopback production build fixture，在此 spec 的 worker 設定 Chromium 原生 `--disable-local-storage`。先進入同 origin 的 blank setup page，核對並印出 `window.localStorage === null`，再載入真正 production App；不替換 Storage API／getter、不以 init script 注入模式或預設文件。公開 Auth 設定為空，測試只發送同 origin request，不連真實服務。

| 驗證路徑 | 通過條件 |
| --- | --- |
| 初次啟動 | 正常顯示 App 與漫畫淺色預設；四分頁皆顯示不可關閉的 `role=status` 警告，原因為「這個瀏覽器沒有提供本機儲存空間」，明示 reload／關閉後內容消失。 |
| UI 建立行程／待辦、完成待辦、修改寵物名字 | 跨分頁仍可看到編輯；真實 JSON 下載保留全天日期、預設日曆關聯、completion instant 與偏好，localStorage 仍為 null。 |
| reload 新 document | memory store 重建，修改消失、寵物回「摩卡」、canonical 空資料與新預設日曆可再次真實匯出；四分頁警告繼續存在。 |

「看過公告」同樣只在 memory store，首次與 reload 都等待並以「知道了」關閉真實版本公告，不用 storage sentinel 跳過。mobile 390×844 與 desktop 1280×900 的 targeted **2/2** 已通過；首輪測試返回日曆時未重新選列表造成 locator 失敗，補上正常 UI 操作後通過，未改 runtime。新增案例要求 console warning／error、pageerror、意外失敗 request 與對外 request 為 0；實際 browser timezone 印出並斷言 `Asia/Taipei`。

重跑：`npm run test:e2e -- e2e/production-unavailable-storage.spec.ts`。本機 Windows／Node 24.14.1 的 lint、typecheck、unit **55 檔 660/660**（`--maxWorkers=2`）、build、check:build 通過；完整 e2e **63 passed、3 skipped**（原有桌面不適用案例）。Node 實際 timezone 印出 `Etc/GMT-8`，build 保留既有 >500 kB chunk 提示。

**限制與下一步**：這只證明原生 API 缺少／null 時的開機記憶體模式，不等於驗證 `SecurityError`、初始 quota、瀏覽器 cookie／隱私政策封鎖、已存在但不可讀的 durable bytes、下載取消、真正多分頁競態、實際帳號快取、真機或 staging。未改 runtime、schema、Auth、worker template、release／版號或部署，未使用 Supabase MCP／正式帳號／正式資料。後續可獨立補初始 quota 或下載失敗回饋；DP-034 父任務及上線放行仍未完成。

### 5.16 Production 開機時額度已滿（DP-106，2026-10-02）

PR #92 合併後，從最新 `origin/main`（`a6c8102`）獨立開分支，承接 §5.14.1／§5.15 留下的「初始 quota」。專案擁有者要求 agent 對「開機寫入被拒時要不要沿用仍可讀的資料」給建議；建議是沿用，理由與決策界線記於 [`architecture-decisions.md`](architecture-decisions.md) §1 的 DP-106 條目。**方向是 agent 的建議，PR 審查即是否決點。**

**先重現，後修正。** 在未修改的 production App 上，App 啟動前就把原生 localStorage 填到連 22 個字元的開機 probe 都寫不進去，再載入 App，實測得到：

| 修正前觀察到的 | 值 |
| --- | --- |
| 版本公告 | 重新跳出（磁碟上的「已看過」標記沒有進到 session） |
| 主題／寵物名字 | 漫畫／「摩卡」（磁碟上是暖陽／「備份夥伴」） |
| 列表中的行程 | 0 筆（磁碟上有 4 個事件、2 列例外） |
| 真實 JSON 匯出 | 0 行程、0 待辦，只有一個新建的「我的日曆」 |
| 磁碟上的原始 envelope | 逐字不變 |

也就是資料沒有遺失，但使用者看不到、也匯不出來，而儲存空間滿的時候匯出是唯一的出路。

**修正**在 `src/storage/browserStorage.ts`：`probeStorage()` 失敗但 store 仍可觸及時，結果多帶一個只供讀取的 `readable`；新的 `createAppStorage()` 以它起始記憶體，`getAppStorage()` 改為呼叫它。複製邏輯從 `#degrade()` 抽成兩條路徑共用的 `carryOwnedEntries()`，只帶 `daypop.*` 與 legacy key，並略過 probe 自己的 key。accessor 丟例外或回傳 null 時沒有 `readable`，行為與修正前相同（§5.15 的 `--disable-local-storage` 案例不變）。probe 失敗的 store 之後不再被寫入。警告文案、版面、canonical UI 與 schema 都沒有動。

`e2e/production-startup-quota.spec.ts` 沿用隔離 loopback production fixture、真實 App／generated worker 與完整 schema-v4 synthetic 資料，Auth 公開設定為空。資料只在 setup page 寫一次；`e2e/fixtures/storageQuota.ts` 新增 `exhaustLocalStorageQuota()`，在既有三階段填充後以單一 key 逐字補滿（64 → 1 字元，每階段最多 128 次，要求真正的 `DOMException`／`QuotaExceededError`）。既有的 `fillLocalStorageQuota()` 與使用它的兩個 spec 沒有改。不替換 Storage 方法、不以 init script 注入模式。

| 驗證路徑 | 通過條件 |
| --- | --- |
| 啟動前 | 與 App probe 等長（20 字元 key＋`ok`）的原生寫入丟 `QuotaExceededError`，印出填充字元數。 |
| 額度已滿時開機 | 四分頁皆有不可關閉的 `role=status` 警告，原因為「儲存空間已經滿了」；不跳版本公告；偏好與 occurrence 列表與磁碟一致。 |
| 真實 JSON 匯出 | 完整可攜資料（日曆、事件、重複例外、待辦、貼圖、偏好）；再改寵物名字後第二份匯出只多這一項修改。 |
| 磁碟 | 開機後仍然寫不進去；所有 key 與長度和啟動前相同，受保護的 guest envelope／backup／legacy／synthetic account cache／其他 key 逐字不變，沒有留下 probe key。 |
| 只移除本次填充 → reload | 新 document 重新 probe 成功：警告消失、讀回原始資料、記憶體修改消失，localStorage 全部 entries 等於原始文件。 |

新增 9 個單元案例（`browserStorage.test.ts` 14 → 23）：可用 store 直接使用、`readable` 何時存在、只帶 DayPop／legacy key、恢復可寫後仍不寫回、`readUserData()` 讀到原文件而非空白、不可讀資料維持 `corrupt`、probe key 不帶入、無 store 可讀時從空白起始、讀取也失敗時從空白起始。把修正暫時還原後有 3 個變紅（含「不可讀資料被空白文件取代」），放回後全綠。

本機 Windows／Node 24.14.1：lint、typecheck、unit **55 檔 669/669**（`--maxWorkers=2`）、build、check:build 通過，targeted **2/2**（mobile 390×844、desktop 1280×900）。完整 e2e 跑了兩輪：**第一輪 68 passed、1 failed、3 skipped**，失敗的是整輪第一個案例（`account-ics-transfer` 手機版）在 fixture 開啟 dev harness 頁面時 `page.goto` 逾時（`net::ERR_ABORTED`），尚未執行任何 App 斷言，同案例桌面版與其餘案例通過；**第二輪 69 passed、3 skipped、無 flaky／重試**。成因未查證，只能說它發生在 build 之後第一次冷啟動 dev server、且重跑未重現，不宣稱已排除。**2026-10-03 更新**：成因已由 DP-108 查明並修正 —— dev server 啟動時，檔案監看器在主執行緒走訪 `output/playwright/` 底下的數萬個 Playwright 產物，模組請求因此排不到；與 DP-106 的修改無關。細節見 `tasks.md` 的 DP-108。跳過的仍是原有 3 個桌面不適用案例。新增案例要求 console warning／error、pageerror、意外失敗 request 與對外 request 為 0；browser 實際 timezone 印出並斷言 `Asia/Taipei`，Node 印出 `Etc/GMT-8`；build 保留既有 >500 kB chunk 提示。重跑：`npm run test:e2e -- e2e/production-startup-quota.spec.ts`。

**限制與下一步**：只在 Chromium 以原生 quota 驗證「開機寫入被拒、讀取正常」這一種狀態；iOS Safari、Firefox 與真機在同狀態下的實際行為未驗。`SecurityError`／實際隱私政策封鎖只有單元層的「沒有 `readable`」，沒有瀏覽器層證據。「開機額度已滿＋不可讀資料」只有單元層確認維持 `corrupt`，production 復原畫面在這個組合下的流程未跑（§5.14 驗的是備份當下才遇到 quota）。帳號快取同樣會被帶進記憶體，但未以登入 harness 或真實帳號驗證。記憶體會複製全部 `daypop.*` key（含備份），與中途降級相同，未量測大量資料時的記憶體用量。下載取消／OS 封鎖、多分頁競態、staging 仍未驗證。未使用 Supabase MCP／正式帳號／正式資料，未改 schema／Auth／worker template／release assets／版號或部署；**修正尚未發布，待後續 release**。DP-034 父任務及上線放行仍未完成。

### 5.17 部署前的公告不可回寫檢查（DP-110，2026-10-03）

DP-034 清單裡的「確認已部署 release note 不再被同版號改寫」原本只靠人記得。DP-110 把它變成部署流程的一步：`scripts/check-release-notes.mjs`（`npm run check:release-notes -- <線上 version.json 網址或檔案>`），由 `deploy-staging.yml` 的 build job 在 Configure Pages 之後、上傳產物之前執行，網址取自 `actions/configure-pages` 的 `base_url` 輸出，不寫死站台位置。

| 規則 | 判定 |
| --- | --- |
| 線上那一版在 `release-notes.json` 的條目 | 必須存在且逐欄相同（欄位順序與空白不算內容）；被改或被刪都失敗。這也涵蓋「發布 0.4.2 時回頭改到 0.4.1」。 |
| 這次產物與線上同版號 | `dist/version.json` 必須與線上相同；同版號重新部署程式修正仍然允許。 |
| 這次的版號比線上舊 | 視為 rollback，印出警告後放行（§4）。 |
| 線上回 404 | 視為尚未部署，通過。 |
| 其他讀取失敗（網路錯誤、非 2xx、不是 JSON、沒有 `version` 欄位） | 失敗；無法確認線上版本時不部署。 |

**驗證**（本機 Windows／Node 24.14.1，`npm run build` 之後）：16 個情境全部符合預期 —— 對真實 staging（線上 0.4.0、本次 0.4.1）通過；已部署條目被改、同版號標題不同、已部署版本不在 `release-notes.json`、不是 JSON、沒有 `version`、HTTP 500、HTTP 200 但回傳 HTML、連不上主機、`dist/version.json` 沒有重新 build 都以結束碼 1 失敗並指出原因；同版號內容相同、欄位重排且壓縮的 JSON、rollback、HTTP 404、HTTP 200 的有效內容都通過；沒給參數為結束碼 2。真實 GitHub Pages 的 404 也另外驗過。第一版在 404 路徑印出通過訊息卻以 127 結束（回應尚未讀完就 `process.exit()`，Node 在 Windows 上觸發 libuv assertion），改為不在請求之後強制結束、失敗一律丟例外後才設定結束碼。workflow 檔以 YAML parser 解析確認步驟順序與 `id: pages`，`base_url` 輸出名稱對照 `actions/configure-pages@v6` 的 `action.yml`。lint、typecheck、unit **55 檔 669/669**、build、check:build 通過，完整 e2e **69 passed、3 skipped、無 flaky**。

**限制與下一步**：**這一步還沒在 runner 上實際跑過** —— 部署會真的發布，不能拿來探測；第一次由專案擁有者部署 0.4.1 時才會執行（線上 0.4.0 的條目未變，預期通過）。只看得到「此刻線上的那一版」：更早的版本（例如 0.4.1 上線後的 0.3.0、0.4.0）沒有任何地方還在提供，改到它們的條目這個檢查抓不到，仍靠審查。檢查只在部署時跑，不在 PR 的 CI：PR CI 不依賴外部站台，代價是違規要到部署才被擋下。比對的是 `version.json` 與 `release-notes.json` 條目逐欄相同，若日後讓 generator 在 `version.json` 多寫欄位，要同步調整這個檢查。未使用 Supabase MCP／正式帳號／正式資料，不改 runtime／schema／Auth／worker template／release／版號。DP-034 父任務及上線放行仍未完成。

**2026-10-04 補正（DP-124）**：上段「還沒在 runner 上實際跑過」描述加入當下。2026-10-03 專案擁有者部署 0.4.1 的 [run 37132293407](https://github.com/yoyoCadence/DayPop/actions/runs/37132293407) 已實際執行，head 為 `d713b52b48765bb1ba6db89fb065388e134ed5e5`。Build for Pages 的 [job 111230422331](https://github.com/yoyoCadence/DayPop/actions/runs/37132293407/job/111230422331) 第 10 步「Refuse to rewrite deployed release notes」成功；log 在 `2026-10-03T15:15:14.9411837Z` 顯示 `Release notes check passed: 0.4.1 replaces 0.4.0, whose notes are unchanged.`，後續 artifact 上傳與 Publish to Pages 也成功。本次只唯讀核對既有 run／job／log，沒有觸發新部署；只比對當時線上版本等原有限制仍有效。

### 5.18 v0.4.2 日常功能發布候選（DP-117，2026-10-04）

依持續開發／日常使用優先委託整理近期已合併功能。開工直接讀取 `https://yoyocadence.github.io/DayPop/version.json`（加唯一 query、HTTP 200），得到 **0.4.1「更新提示與資料保護」／2026-10-03**，與 repo 0.4.1 條目逐欄相同。因此前述「線上仍為 0.4.0／0.4.1 未發布」的歷史狀態已過時；0.4.1 公告也不可回寫。此次只新增 **0.4.2「日常安排更完整」**，保留所有舊公告，package／lock 版號一致，version.json／sw.js 由既有 generator 產生。user-data schema v4、worker template、migrations、Auth 與部署 workflow 不變。

公告涵蓋 DP-083 重複週格拖曳範圍、DP-072 整筆跨午夜移動／最後片段 resize、DP-075 中文時刻、DP-111 事件時區、DP-112 多日時間保存、DP-113 帳號／更新主題、DP-114 全天週列，以及 DP-115／116 完整待辦子樹刪除與子項操作。沒有把 AI、可靠背景通知、家庭分享或 DP-077 真機即時回饋寫成已完成。

本機 production preview 實際顯示本版 8 條公告，375×667 小手機、932×430 橫放與 1280×900 桌面全部在 viewport 內；以畫面座標按「知道了」可關閉，reload 不重複顯示、guest envelope 逐字不變。console warning／error、pageerror 與水平溢出皆為 0，瀏覽器實際 Intl 印出 Asia/Taipei。截圖與 QA 腳本在系統暫存 `daypop-dp117-proof/`／`daypop-dp117-visual.mjs`，未放進 repo；第一輪 QA 腳本誤用「主要分頁」定位，改為既有「主導覽」後通過，未改 App 或放寬斷言。worker 的內容只換版號（CRLF 正規化後核對），所有歷史公告逐欄相同；`npm run check:release-notes -- https://yoyocadence.github.io/DayPop/version.json` 明確回報 **0.4.2 replaces 0.4.1, whose notes are unchanged**。

**發布交接**：這份 PR 合併只代表 main 上的候選完成，**agent 未觸發部署**；沿 §3.4 由專案擁有者選擇時機，執行 **Actions → Deploy staging → Run workflow → main**。上傳前依現有流程重跑三項 CI 與線上公告比對；發布後核對站台 `version.json`／設定為 0.4.2、PWA 更新後資料保全，以及新全天週列與子項。DP-077 的實體 iPhone 觸控回饋、DP-034 的資料刪除／隱私說明／錯誤監控／效能 budget 等仍未全部驗收，不宣稱已達完整日常使用放行點。

**最新基線驗證**：接入 DP-116 的 merge `fbbec4f` 後，完整 lint／typecheck／unit **830／830、59 檔**／build／check:build／線上 check:release-notes 通過；targeted `release-notice`、`production-update`、`todo-subtasks` **18／18**（mobile＋desktop）。production 更新驗證真正 generated worker 的稍後／立即、等待 install、下載或安裝失敗後重試，以及 App 自動 reload 後的 guest 資料保全；子項驗證的實際裝置 Intl 為 America/New_York，display Asia/Taipei，其餘印出 Asia/Taipei。沒有新增測試檔或放寬舊斷言。build 保留既有 >500kB chunk 提示；帳號案例仍為 dev-only FakeSupabase，production 更新只用隔離 loopback 遊客 App。未使用 Supabase MCP／正式帳號／正式資料、未觸發 staging。

### 5.19 0.4.2 公告補正與舊版對話框（DP-122，2026-10-05）

0.4.2 部署前補上 DP-118「資料與隱私說明」、DP-120 待辦改名，以及後續 DP-125 的標題上限與草稿保留。沿前述已合併功能，將 8 條合併成 **6 條、162 個 Unicode code point**，保留子項新增／展開／勾選／完成比例與父項刪除、週全天列、重複／跨午夜拖曳與結束調整、中文時刻、時區／多日時間，以及帳號／登入／更新主題。release 仍為 0.4.2、releasedAt 仍為 2026-10-04；generator 只改 `public/version.json`，worker 與所有歷史公告逐欄不變。

直接 GET staging（唯一 query、HTTP 200）仍為 0.4.1「更新提示與資料保護」／2026-10-03，故 0.4.2 尚可修訂；`check:release-notes` 對線上 0.4.1 通過。歷史 §5.18 的 8 條／本版可捲動 dialog 量測保留，但發布時以本節的最終 6 條與舊版驗證為準。

**真實舊版量測**：隔離 worktree 取 staging 最後一版 0.3.0 的 `5891034`；以該 commit 的 lockfile 離線 `npm ci --ignore-scripts`，Node 24.14.1、`npm run build -- --base=/DayPop/` 建立 production App。保留其原始 CSS／不可捲動 `.update-dialog`，Playwright `page.route` 只替換新版本 `version.json`；逐尺寸開獨立 mobile Chromium context，等待 fonts ready 並印出實際 Intl **Asia/Taipei**。先用未變的 0.4.0 公告校準：932×430 的對話框 `15..418.5`、兩顆按鈕 `348.5..394.5`，與 DP-089 的 `15..418/430` 一致。

| 尺寸 | 0.4.2 對話框 top..bottom | 兩顆按鈕 top..bottom | 完整放得下 |
| --- | --- | --- | --- |
| 430×932 | 233.0..699.0 | 629.0..675.0 | 是 |
| 390×844 | 178.6..665.4 | 595.4..641.4 | 是 |
| 375×667 | 90.1..576.9 | 506.9..552.9 | 是 |
| 360×640 | 76.6..563.4 | 493.4..539.4 | 是 |
| 932×430 | 15.0..418.5 | 348.5..394.5 | 是 |

五種尺寸均斷言完整 dialog 與兩顆按鈕的四邊在 viewport 內、無水平溢出；「稍後提醒」可點擊並關閉，guest 原始 envelope 逐字不變。console error／warning 與 pageerror 皆 0。375×667 與 932×430 最終截圖已目視確認；QA 腳本、量測 JSON 與截圖位於系統暫存 `daypop-dp122-qa.mjs`／`daypop-dp122-proof/`，未放入 repo，舊 source／node_modules／dist 於驗證後清理。

lint、typecheck（隨 build）、build、check:build、線上 check:release-notes 通過；既有 `release-notice`／`production-update` browser **14／14**（mobile＋desktop，production 實際 Intl Asia/Taipei）亦通過，涵蓋首次公告／看過後 reload、手動檢查、等待 install、失敗後重試及更新後 guest 資料保存。未新增測試檔或放寬斷言。

本項只完成發布前公告閘門，未觸發部署。0.4.2 的實際發布仍由擁有者執行 §3.4；DP-077 真機觸控、DP-034 其餘驗收與日常使用放行仍待完成。

### 5.20 0.4.2 日常能力公告補齊（DP-131，2026-10-06）

DP-130 的 PR #120 三項 CI 成功合併後，從最新 main（`d67d92a`）獨立補齊候選公告。再次直接 GET staging（唯一 query、HTTP 200）確認仍為 0.4.1「更新提示與資料保護」，只修改未部署的 0.4.2 兩條 changes：全天結束日期／各檢視續日，以及待辦換日／優先度。仍為 **六條、177 個 Unicode code point**，保留子項新增／展開／勾選／完成比例與父項刪除、中文快速新增、事件時區／多日時間、拖曳範圍、隱私說明與標題上限。版號、releasedAt、title 與全部歷史公告逐欄不變；既有 generator 只同步 public/version.json，sw.js／worker template 不變。`check:release-notes` 直接對線上 0.4.1 通過，§5.19 原量測保留但發布時以本節的最終文案與數值為準。

歷史驗證基準取同一個 `5891034` 的 git archive，在系統暫存使用其自身 lockfile 離線 `npm ci --ignore-scripts`，Node 24.14.1、`npm run build -- --base=/DayPop/`。保留真正 0.3.0 production App 與原始不可捲動 `.update-dialog`，只 route 新版 version.json；先用未變的 0.4.0 校準出 932×430 的 `15..418.5` 與按鈕 `348.5..394.5`，並重現 §5.19 的原 0.4.2 五種數值，再驗證補正後文案。每個獨立 mobile Chromium context 等待 fonts ready、印出實際 Intl **Asia/Taipei**。

| 尺寸 | 最終 0.4.2 dialog top..bottom | 兩顆按鈕 top..bottom | 完整放得下 |
| --- | --- | --- | --- |
| 430×932 | 233.0..699.0 | 629.0..675.0 | 是 |
| 390×844 | 168.2..675.8 | 605.8..651.8 | 是 |
| 375×667 | 69.3..597.7 | 527.7..573.7 | 是 |
| 360×640 | 55.8..584.2 | 514.2..560.2 | 是 |
| 932×430 | 15.0..418.5 | 348.5..394.5 | 是 |

六條與結束日期／換日／優先度／完成比例／隱私／300 字內容均在實際 dialog 中驗證；完整 dialog 與兩顆按鈕四邊在 viewport 內，無水平溢出，稍後提醒可點擊關閉且 guest 原始 envelope 逐字不變，console error／warning 與 pageerror 均 0。375×667／932×430 最終截圖已目視確認；腳本、量測 JSON 與圖在 `%TEMP%/daypop-dp131-qa.mjs`／`daypop-dp131-proof/`，本次暫存舊 source／node_modules／dist／archive 已於驗證後核對絕對路徑及 package 身分並清理。

lint／typecheck、971 個單元案例（61 檔）＋7 項 posttest、build／check:build 與直接對線上 0.4.1 的 check:release-notes 全部通過。既有 release-notice／production-update mobile＋desktop 共 **14／14** 通過，涵蓋首次公告、已是最新、檢查失敗、等待 install、更新失敗重試及 guest 資料保存；production 實際 Intl 為 Asia/Taipei。不新增只比對文案的測試或放寬既有斷言。

本項只補齊候選公告，不提升 release／schema 或改 Auth／worker，不觸發部署。實際發布仍由擁有者執行 §3.4，DP-077 真機與 DP-034 放行限制維持。

### 5.21 畫面錯誤的本機處理（DP-139，2026-10-07）

DP-034 清單的「錯誤監控」拆成兩半，本項只做不需要外部服務的那一半。

| 狀況 | 使用者看到 | 可以做什麼 |
| --- | --- | --- |
| 某個分頁畫面（含它開啟的 sheet／dialog）繪製時丟錯 | 該分頁換成「這個畫面暫時無法顯示」，分頁列、橫幅與其他分頁照常 | 再試一次、下載備份（DP-143 起就在這個畫面上）、重新載入 App、展開錯誤訊息轉述 |
| provider、shell 或上層 dialog 丟錯，App 無法啟動 | 不依賴主題的「日蹦暫時無法啟動」 | 重新載入、展開錯誤訊息轉述 |
| 資料讀不了（corrupt／future） | 不變，仍是 §5.12 的 `DataRecoveryScreen` | 備份後重設 |

本機 mobile／desktop Chromium 以攔截 dev server 模組的方式實測（`e2e/screen-error-boundary.spec.ts`）：某畫面出錯後，「設定 → 匯出資料」下載的 JSON 內含先前建立的行程、回到日曆資料仍在、`daypop.user-data` 逐字不變；App 無法啟動時資料同樣不變，重新載入後恢復。修正前兩個案例都是全白頁。

**仍未完成，父任務不結案：**

- **遠端錯誤回報／監控。** 目前沒有任何錯誤離開裝置，營運端不會知道使用者遇到錯誤。要做需先決定服務、放寬建置時注入的 CSP `connect-src`，並更新設定的隱私說明卡與 `docs/data-and-privacy.md`。
- **render 以外的錯誤。** 事件 handler、Promise 與計時器的錯誤不經過 boundary，維持既有的橫幅與表單提示。
- **production build 與真機。** 模組攔截只在 dev server 可行；打包後的 App 與 iOS／Android 實機沒有對應的錯誤注入驗證，只有相同原始碼的單元與 dev 測試。
- ~~設定畫面本身壞掉時，fallback 沒有獨立的備份下載入口，只能重新載入。~~ **2026-10-07 補正（DP-143）：** 分頁錯誤畫面已直接提供「下載備份」，與設定的「匯出資料」是同一個函式、同一份檔案；本機 mobile／desktop Chromium 以壞掉的設定模組實測，下載的 JSON 內含先前建立的行程。App 無法啟動時的最外層畫面在 provider 之上，仍然沒有備份入口。

### 5.22 刪除日曆的 RPC：部署前必須先推 migration（DP-138，2026-10-07）

**這一項改變了部署的前置條件。** 從這個 commit 起，前端在帳號模式刪除日曆時呼叫 `delete_calendar_with_reassignment`，它由第 16 檔 migration `20261007000000_delete_calendar_rpc.sql` 建立，而這檔 **尚未套用到遠端 Supabase 專案**。

| 順序 | 誰 | 做什麼 |
| --- | --- | --- |
| 1 | 專案擁有者 | `npx supabase migration list --linked`，核對遠端目前套用到第幾檔 |
| 2 | 專案擁有者 | `npx supabase db push --linked --dry-run`，確認清單只有預期的檔案 |
| 3 | 專案擁有者 | `npx supabase db push --linked` |
| 4 | 專案擁有者 | 之後才執行 §3.4 的 staging 部署 |

- **第 1 步不是形式。** `docs/supabase-mcp-handoff.md` 只記錄到第 14 檔由擁有者 push；第 15 檔 `20260830000000_event_occurrence_rpcs.sql`（DP-082 的「只改這一次／只刪這一次」）有沒有推到遠端，文件裡沒有記錄，這次也沒有查遠端。如果 dry-run 列出兩檔，代表第 15 檔也還沒上去，一起推即可；兩檔都只新增函式，不改資料表。
- **順序顛倒會怎樣：** 前端先部署、migration 還沒推時，帳號模式按「刪除此日曆」會因為函式不存在而失敗。失敗時不會搬移或刪除任何資料，對話框留在畫面上顯示錯誤（DP-141）。遊客模式不受影響。也就是功能暫時不可用，但不會弄亂資料。
- **目前線上的行為（修正前）：** 帳號模式刪除**預設**日曆每次都會失敗，並把它的行程、待辦、貼圖搬到另一個日曆；刪除非預設日曆正常。資料不會遺失。這是在本機由 migration 重建的 PostgreSQL 上重現的，沒有在 staging 上操作驗證。
- 本機驗證：`db reset` 套用 16 檔、pgTAP 6 檔 174／174、重新產生的型別只多這支函式；CI 的 `database` job 會重跑同一組。沒有在真實雲端專案執行過這支函式，推上去之後建議以測試帳號實際刪一次預設日曆。
- 這一步沒有自動檢查：`deploy-staging.yml` 不會、也不能確認遠端的 migration 版本（CI 不使用任何 secret，也不 link 專案）。它只能靠這份清單。
