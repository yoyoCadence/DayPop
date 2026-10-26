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

不驗證 Email 寄達、註冊／Google OAuth UI、正式站台、手機或 standalone。fixture 的 Email 由 Node admin 確認，不能冒充真實使用者完成驗證信；畫面與草稿／焦點另由 Playwright 覆蓋，權限／競態另由 pgTAP 和既有雙連線測試覆蓋。DP-206 實帳號驗收仍保留；本項不部署、不修改 migration、v4、版號或已發布公告。
