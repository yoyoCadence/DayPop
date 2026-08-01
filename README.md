# 日蹦 DayPop

DayPop 是以手機為主的個人日曆 PWA。目前正在把 Claude Design 匯出的原型，漸進整理成 React + TypeScript + Vite 的可維護產品；Supabase Auth 與資料庫安全基礎已接入，帳號日曆 CRUD／匯入仍是下一階段。

## 目前可用

- 月曆瀏覽、切換月份與回到今天
- 新增時間行程、新增／完成待辦
- App 內建寵物小幫手摘要
- 版本檢查、更新內容公告與使用者選擇更新
- 版本化的本機資料格式；App cache 與使用者資料分開管理
- mobile-first PWA manifest、service worker 與基本 App shell 啟動快取
- Email＋密碼註冊／登入、忘記／重設密碼、session restore 與遊客模式
- Supabase migrations、9 張核心表、owner-only RLS 與產生的 TypeScript database types

舊的 `日曆桌寵 Calendar Pet.dc.html` 與 generated `support.js` 保留為產品行為參考，不在其上繼續堆疊正式功能。完整清單見 [原型行為保全清單](docs/prototype-behavior-baseline.md)。

## 本機開發

需要 Node.js 24+ 與 npm。

```bash
npm install
npm run dev
```

品質檢查：

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Production preview：

```bash
npm run preview
```

## Supabase 開發

複製 `.env.example` 為 `.env.local`，只填入 project URL 與 publishable key。前端不需要、也不得使用 secret／`service_role` key。沒有 Supabase 設定時 App 仍可使用遊客模式，但登入按鈕會停用並顯示原因。

官方 CLI 已固定為 project dev dependency：

```bash
npm run supabase:start
npm run supabase:reset
npm run supabase:test
npm run supabase:types
npm run supabase:stop
```

本機 Supabase stack／reset／database test 需要 Docker-compatible runtime。若要對已連結的 preview／staging 專案驗證，可先執行 `npx supabase link --project-ref <project-ref>`，再使用：

```bash
npm run supabase:test:linked
npm run supabase:types:linked
```

正式 schema 以 `supabase/migrations/` 為準；目前 migrations 已套用到 DayPop 遠端專案，並通過 owner RLS、帳號刪除 cascade 測試與 Supabase security advisor。不要對有正式資料的專案執行 remote reset。

Email Auth 已啟用且需要信箱驗證。Google provider 尚未在 Supabase Dashboard 啟用，因此 UI 會提示先使用 Email；完成 Google OAuth client 與 redirect allowlist 設定後，App 會從公開 Auth settings 偵測並顯示 Google 登入按鈕。

## 版本發布方式

1. 更新 `package.json` 的 `version`。
2. 在 `release-notes.json` 新增同版本的公告內容，最新版本放第一筆；版本正式部署後，該版公告不再修改。
3. 執行 `npm run build`；prebuild 會產生 `public/version.json` 與含版本 cache 名稱的 `public/sw.js`。
4. 部署 `dist/`。使用者開啟 App、回到前景、恢復連線或手動檢查時會取得不快取的 `version.json`，看到更新內容後可選擇立即更新或稍後提醒。

Service worker 只清理由 DayPop 管理、且帶有 `daypop-app-shell-` 前綴的舊 App cache。它不操作 `localStorage` 或 IndexedDB。

## 資料安全邊界

- 新 React App 暫時以 `daypop.user-data` 保存帶 `schemaVersion` 的遊客資料。
- 舊原型的 `calpet.v2` 不會被覆寫或刪除；正式匯入流程會另案實作並在成功前保留原資料。
- 不呼叫 `localStorage.clear()`，也不因 App 版本更新重設行程或偏好。
- Supabase 前端只允許 project URL 與 publishable key；不得放入 `service_role` 或其他伺服器密鑰。
- 登入／登出不會自動上傳、清除或改綁目前的遊客資料；帳號匯入會另做可預覽、可確認、失敗可回復的流程。

目前登入只建立安全 session；介面會明確提示帳號資料 CRUD 尚未接線，避免把「已登入」誤解成「已同步」。

## 專案結構

```text
src/domain/       核心資料型別與日期邏輯
src/auth/         Supabase Auth provider、狀態與登入介面
src/lib/          公開環境設定、Supabase client 與產生的 DB types
src/storage/      版本化本機資料與 repository
src/pwa/          版本檢查、更新提示與 service worker client
pwa/              service worker 來源模板
scripts/          release assets 產生器
public/           manifest、icon 與產生後的 release assets
docs/             原型行為、架構決策與審查交接文件
supabase/         CLI config、migrations 與本機 seed
```

跨模組設計見 [架構決策](docs/architecture-decisions.md)，後續工作與資料架構見 [tasks.md](tasks.md)。
