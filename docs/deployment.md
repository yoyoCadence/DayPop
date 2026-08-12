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

**絕對不要**把 `service_role` 或任何伺服器端金鑰放進 variables 或 secrets 供前端建置使用。

沒設定這兩個值時，deploy workflow 會直接失敗並說明原因，而不是發布一個無法登入的站台。

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

在想回到的 commit 或 tag 上重新 dispatch 同一個 workflow：

Actions → Deploy staging → Run workflow → 選該 ref → Run。

Pages 會以這次的成品覆蓋現有站台。因為每次部署都是完整的靜態成品，沒有「部分回滾」的狀態。

**回到舊版時要留意的兩件事：**

- **service worker 快取名稱帶版本**（`daypop-app-shell-<version>`）。回到舊版後，使用者手上的新版 service worker 仍在，直到它抓到舊的 `version.json` 才會回退。使用者端可能需要重新載入一次。
- **已部署版本的 release note 不可回寫修改**（AGENTS.md）。rollback 不等於可以改寫那一版的公告內容。

---

## 5. 部署後的驗收清單

這份清單是 DP-033 的實際驗收；在 staging 網址上逐項確認：

- [ ] `https://yoyocadence.github.io/DayPop/` 開得起來，四個分頁都在。
- [ ] DevTools Network 沒有 404；所有資源都在 `/DayPop/` 底下。
- [ ] Application → Service workers：scope 是 `https://yoyocadence.github.io/DayPop/`。
- [ ] Application → Manifest：可安裝，圖示齊全，`start_url` 與 `scope` 都是 `/DayPop/`。
- [ ] 重新整理不會 404；隨便打一個 `/DayPop/xxx` 也會回到 App（`404.html`）。
- [ ] 設定分頁顯示「目前版本 v0.3.0」，且展得開 release note（代表 `version.json` 與 bundle 版本一致）。
- [ ] 遊客模式可建立行程與待辦，重新載入後還在。
- [ ] Email 註冊 → 收到驗證信 → 連結導回 `/DayPop/` 而不是網域根目錄。
- [ ] 登入後建立資料 → 登出 → 重新登入，資料仍在（DP-034 的資料保存 smoke test 也需要這一項）。
- [ ] Console 沒有 CSP violation。

> 上面兩項需要真實 Email 帳號的檢查，與 **DP-023** 的 end-to-end 驗收是同一件事。
>
> iOS Safari／Android Chrome 的實機外觀、safe area、觸控與無障礙屬 **DP-032**；備份還原、資料刪除、隱私說明與錯誤監控屬 **DP-034**。全部通過後才可以主動提醒專案擁有者「已達可開始日常使用的驗收點」—— 光是靜態頁發布成功不算。
