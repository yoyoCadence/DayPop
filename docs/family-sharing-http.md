# 本機 Auth／HTTP 分享整合（DP-208）

這條回歸用兩個獨立、真正登入的 Supabase client，經本機 GoTrue → Kong／PostgREST → migration 的 RPC／RLS，執行正式 `SupabaseFamilyService` 與 `SupabaseDayPopRepository`。它補足記憶體 UI harness 和直接 SQL pgTAP 間的連接；首次就重現第 18 檔新增日曆 RETURNING 被拒，修正見 [DP-209](supabase-mcp-handoff.md#015-dp-209-新增日曆-returning-修正候選2026-10-26)。

前置 [PR #202](https://github.com/yoyoCadence/DayPop/pull/202) 的 head `25e3434` 四 CI／完成審查無發現、無未解決討論後合併 `c64292b`；本段從該最新 main 接續，自己的 HTTP CI 結果需等本段最新 head，不能沿用前置 PR 的 pass。

## 執行與範圍

```powershell
npm run supabase:test:http
```

前置是本機 stack 已啟動 Auth／PostgREST／Kong／Postgres，並已套用第 19 檔；測試器不自行啟動、reset 或推 migration。CI 的既有 database job 在重建、pgTAP、權限負控制與兩競態後執行同一 npm script，仍無外部 secret／linked project。其餘服務保持排除、四品質閘門與 timeout 不變。

若使用專用 CLI workdir，可設 `DAYPOP_HTTP_WORKDIR` 為該目錄；不接受外部 API URL、DB URL 或 env key。驗證器自行從本機 CLI status 取得設定，只允許 `http://127.0.0.1` API root，拒絕其他 host／protocol、userinfo、query、fragment；所有後續請求固定同 origin、拒絕 redirect 並有 15 秒 deadline。`local-supabase-http.test.mjs` 的十項拒絕與通過案例會跟著一般 `npm test` 的 Node posttest 跑，不需要 Docker。

Node 程序以本機 admin key **只建立及清理本次隨機、已驗證的兩個假帳號**；產品操作全部以各自 public key＋獨立密碼登入的 session 執行，不使用 admin 繞過 RLS。不把 key、密碼、JWT 或 CLI status 寫進前端、repo、測試 artifact 或 log。CI 啟動摘要可能含 local key，完整 stdout／stderr 只留 runner TEMP、不上傳；啟動失敗會讓 gate 失敗，不略過 HTTP。

## 八組檢查

| 流程 | 驗證 |
| --- | --- |
| 各自初始化與保存 | 日曆不同、本人行程互不可見；另新建獨立共用日曆 |
| 邀請與接受 | 不符受邀 Email 被拒、preview 不接受、明確接受後兩位成員；加入仍不自動分享 |
| 開啟共同編輯 | 舊事項可見、private 連直接 HTTP 查詢都不可見、收到日曆不成 default 或 personal projection |
| 成員共同維護 | B 改行程及新增待辦，A 讀回；DB owner 為 A、實際作者為 B |
| 衝突 | A 先保存，B 的舊版本寫入被拒，A 新內容不被覆蓋 |
| 改為只能查看 | B 尚持有舊 edit snapshot 仍被伺服器拒絕寫入；重查仍可讀、原列不變 |
| 撤權 | B 未重查前的舊寫入即被拒；重查移除收到內容，A 原資料保留 |
| 登出再登入 | 真正 Auth logout 後，以全新 client 密碼登入，讀回 B 本人事項而不恢復撤權日曆 |

每次 finally 只刪本次成功建立且立即追蹤的 user IDs，再以 Auth admin 按同 IDs 確認不存在；失敗也繼續清理另一個 fixture。清理失敗會令 script exit 非零。不要為了測試通過而刪既有帳號或放寬 policy。失敗 log 只含檢查名稱、錯誤種類及可用的 operation／code，沒有 SDK response。

## 證據與限制

本機專用 `DayPopHTTP208`（API 54331／DB 54332）由零重建 19 檔、10 檔 386 pgTAP、public types 相同後，八組真實 HTTP 通過、兩個隨機假帳號已清理；Node 實際時區 `Etc/GMT-8`。這條 script 會在每次執行印出實際時區；CI 結果以自己的最新 head 為準，不能沿用另一 PR 的數字。

PR #203 head `0e3f3a6` 的 CI `40274767378` 四項全過：1,404 單元＋39 Node、386 pgTAP／兩組權限負控制／兩競態／types、八組真實 HTTP（實際 UTC，兩個 fixture 清理成功）、WebKit 8、Chromium 287 passed／13 skipped（21.9 分鐘）。早一輪 `938e0e0` 的 JS import-attributes lint 解析失敗不算通過；改用既有 ecmaVersion 支援的 JSON 讀取後重跑。後續文件提交仍需自己的四 CI 與相同 head 完成審查才能合併。

最終 head `a3ad68e` 的 CI `40288425887` 已四項全過；相同 head 審查完成無發現、沒有未解決討論後，擁有者於 2026-10-26 16:57（台北）合併 [PR #203](https://github.com/yoyoCadence/DayPop/pull/203) 為 `e5db4c4`。首次 Chromium attempt 的系統套件下載 24.9 MB 花 10 分 9 秒，執行到第 183／300 項時取消；不能算測試通過。重跑下載恢復約 1 秒，完整 Chromium 287 passed／13 skipped（15.9 分鐘），其他三 gate 同樣成功；沒有調整 timeout／worker／retries 或減少測試。

不驗證 Email 寄達、註冊／Google OAuth UI、正式站台、手機或 standalone。fixture 的 Email 由 Node admin 確認，不能冒充真實使用者完成驗證信；畫面與草稿／焦點另由 Playwright 覆蓋，權限／競態另由 pgTAP 和既有雙連線測試覆蓋。DP-206 實帳號驗收仍保留；本項不部署、不修改 migration、v4、版號或已發布公告。

## DP-206 本機真實畫面補驗（2026-10-26）

從合併後 `e5db4c4` 啟動相同隔離 stack，以正式入口 `http://127.0.0.1:4175/` 和兩個獨立 Playwright CLI session 驗證完整 UI。Vite 只注入本機 API 與 public key；不走 `/e2e/auth.html`、fake service、預置 browser session 或已登入的正式帳號。兩個新建、Email 已確認的本機 fixture 透過表單真正輸入 Email／密碼登入。

操作與結果：A 顯示已同步 → UI 新增日曆成功 → 建立家庭／產生受邀 Email 綁定連結 → B 全新瀏覽器從連結登入 → 核對預覽後明確接受 → A 選擇日曆與共同編輯、讀取歷史內容確認後保存 → A 新增共用行程 → B 按重新確認分享，顯示可共同編輯並讀到該行程 → B 從日詳情修改標題並保存 → A 真正 reload 後讀回相同新標題。首次公告會等邀請完成後才顯示，沒有阻擋明確接受。

手機 A 為 390×844、桌面 B 為 1280×900，兩邊實際 `Etc/GMT-8` 已列印；頁名正確、內容非空、無 framework overlay／水平溢出，console 各 0 errors／warnings。兩張日詳情截圖已目視，保存在系統 TEMP，未提交圖片、credential、邀請 token 或臨時腳本。結束後兩個假帳號刪除並逐一確認不存在，專用本機 users／family_groups／calendars／events／todos 均 0；測試憑證／連結已刪除、CLI／驗證伺服器／stack 已停止。

此輪只補驗登入／新增日曆／邀請／明確分享／共用編輯與 reload，沒有宣稱 UI private／view／撤權、實際 Email 寄達／Google OAuth／正式站台／實體手機通過；前者仍有既有 HTTP／pgTAP／harness 回歸，DP-206 擁有者實際帳號驗收仍進行中。本輪沒有產品修改、migration 或部署。
