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
