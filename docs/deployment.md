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

> Google OAuth client 與 provider 啟用仍屬 **DP-023** 的未完成項；在那之前 App 只顯示 Email 登入，這是正常的。

### 3.4 觸發部署

Repository → **Actions → Deploy staging → Run workflow**，選要部署的 branch 或 tag。

部署只由人工觸發，不掛在 `push` 上 —— 發布是對外公開的動作，時機應由專案擁有者決定。

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

**2026-08-22 補驗完成**：專案擁有者以真實 Email 帳號完成註冊、收信、驗證連結導回 `/DayPop/#`、帳號 bootstrap、建立行程後顯示「已同步」、登出回到原 guest 資料、同帳號重登與 reload 後遠端行程仍存在；另完成 Google OAuth client／最小 `openid`、Email、profile scopes／Supabase provider 設定，以同 Email Google identity 登入、redirect、identity linking、同步與 session restore 全數通過。Google 目前保留 Supabase 預設 callback hostname；專案擁有者知悉 account chooser 會顯示隨機 project ref，並定案熟人使用階段接受，品牌化 custom domain 延後。DP-023 與 DP-033 的驗收條件至此完成，待本次 signup 終態修正 PR 合併後結案；實機瀏覽器 QA（DP-032）與正式上線清單（DP-034）仍未完成，因此目前仍**不能**宣稱已達可開始日常使用的驗收點。

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
