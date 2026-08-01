# 日蹦 DayPop

DayPop 是以手機為主的個人日曆 PWA。目前正在把 Claude Design 匯出的原型，漸進整理成 React + TypeScript + Vite 的可維護產品；Supabase 登入與帳號資料保存是下一階段。

## 目前可用

- 月曆瀏覽、切換月份與回到今天
- 新增時間行程、新增／完成待辦
- App 內建寵物小幫手摘要
- 版本檢查、更新內容公告與使用者選擇更新
- 版本化的本機資料格式；App cache 與使用者資料分開管理
- mobile-first PWA manifest、service worker 與基本 App shell 啟動快取

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

## 版本發布方式

1. 更新 `package.json` 的 `version`。
2. 在 `release-notes.json` 新增同版本的公告內容，最新版本放第一筆。
3. 執行 `npm run build`；prebuild 會產生 `public/version.json` 與含版本 cache 名稱的 `public/sw.js`。
4. 部署 `dist/`。使用者開啟 App、回到前景、恢復連線或手動檢查時會取得不快取的 `version.json`，看到更新內容後可選擇立即更新或稍後提醒。

Service worker 只清理由 DayPop 管理、且帶有 `daypop-app-shell-` 前綴的舊 App cache。它不操作 `localStorage` 或 IndexedDB。

## 資料安全邊界

- 新 React App 暫時以 `daypop.user-data` 保存帶 `schemaVersion` 的遊客資料。
- 舊原型的 `calpet.v2` 不會被覆寫或刪除；正式匯入流程會另案實作並在成功前保留原資料。
- 不呼叫 `localStorage.clear()`，也不因 App 版本更新重設行程或偏好。
- Supabase 前端只允許 project URL 與 publishable key；不得放入 `service_role` 或其他伺服器密鑰。

複製 `.env.example` 為 `.env.local` 可準備未來的 Supabase 開發環境。目前 Auth 尚未接線，沒有憑證也能執行本機 App 與測試。

## 專案結構

```text
src/domain/       核心資料型別與日期邏輯
src/storage/      版本化本機資料與 repository
src/pwa/          版本檢查、更新提示與 service worker client
pwa/              service worker 來源模板
scripts/          release assets 產生器
public/           manifest、icon 與產生後的 release assets
docs/             原型行為與架構文件
```

後續工作與資料架構見 [tasks.md](tasks.md)。
