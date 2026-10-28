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

## 十七組檢查

| 流程 | 驗證 |
| --- | --- |
| 各自初始化與保存 | 日曆不同、本人行程互不可見；另新建獨立共用日曆 |
| 邀請與接受 | 不符受邀 Email 被拒、preview 不接受；重發輪替同一邀請不加名額、舊連結失效，撤銷／拒絕不入群、接受後不能重用；加入仍不自動分享 |
| 開啟共同編輯 | 舊事項可見、private 連直接 HTTP 查詢都不可見、收到日曆不成 default 或 personal projection |
| 成員共同維護 | B 改行程及新增待辦，A 讀回；DB owner 為 A、實際作者為 B |
| 雙向分享與角色邊界 | B 另分享自己的日曆，A 建立內容歸 B、作者為 A；A 身為家庭 owner 仍不能讀 B 私人事項或用正確版本改 B 的分享，雙方 default／個人 projection 各自保留 |
| 雙向重複單次維護 | A／B 各作 calendar owner 及 editor，各測全天與紐約 09:00 指定時間；單次替換與取消獨立保存，系列內容保持且 CAS 版本前進，作者正確、取消不復活、替換不重複 |
| 重複衝突與私人 graph | 雙向舊版本單次修改皆以明確衝突拒絕，整個 graph raw rows 不變；root 切私人時 base／replacement／exception 連直接 HTTP 都隱藏，重開仍保留單次結果 |
| 待辦完成與子項保存 | B 勾選父／子項，A 可取消父項完成；重新建立 B repository 讀回子項標題、優先度、獨立日期與完成，收到內容仍不進個人 projection |
| 子樹版本與整批刪除 | A 改其中一個子項後，B 舊版本整批拒絕且三列逐欄不變；重讀後可刪父項與兩個不同作者的子項，其他待辦保留 |
| 私人待辦後代 | private 子項與 private 父項下的 inherit 子項連直接 HTTP 都不可見；成員不能連帶刪除隱藏子項，擁有者仍可明確刪整棵 |
| 衝突 | A 先保存，B 的舊版本寫入被拒，A 新內容不被覆蓋 |
| 改為只能查看 | B 各自持有舊 edit snapshot 的完成、刪除與修改都被拒；重查仍可讀、原列逐欄不變 |
| 撤權 | B 各自未重查的完成、刪除及行程寫入都被拒；重查移除收到內容，A 原資料保留 |
| 登出再登入 | 真正 Auth logout 後，以全新 client 密碼登入，讀回 B 本人事項而不恢復撤權日曆 |
| 成員退出 | B 明確退出，A 仍是唯一 owner；B 各自持有的舊修改／完成／刪除被拒，直接 HTTP 也讀不到，雙方原資料保留 |
| 擁有者移除成員 | 重新邀請須明確接受才恢復既有分享；A 移除 B 後同樣即時回收舊操作及讀取權限，保留 B 曾建立但歸 A 的事項 |
| 解散家庭 | 再次明確接受後，A 解散使雙方讀回無家庭，分享設定消失；舊操作被拒，日曆／事項及 B 本人資料均保留 |

每次 finally 只刪本次成功建立且立即追蹤的 user IDs，再以 Auth admin 按同 IDs 確認不存在；失敗也繼續清理另一個 fixture。清理失敗會令 script exit 非零。不要為了測試通過而刪既有帳號或放寬 policy。失敗 log 只含檢查名稱、錯誤種類及可用的 operation／code，沒有 SDK response。

DP-214 起有十七組；下方 DP-208 的八組、DP-211 的十一組、DP-212 的十四組及當時 CI 數字保留為歷史。降權／撤權及成員變更的每個舊操作使用獨立 repository snapshot、共用 B 的真實登入 client；一個操作被拒後自動重查，只更新自己的 snapshot。各個完成／刪除都會帶著尚未重查的 edit 權限送到 RPC，由伺服器核對當前權限。結束前另核對所有十七組都有執行。

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

## DP-206 線上專用雙帳號驗收（2026-10-26）

擁有者回覆「你建立兩個測試帳號先測試」後，從 PR #204 已合併的 `75ad125` 接續，在 [正式站台](https://yoyocadence.github.io/DayPop/) 0.4.4 完成兩個真實帳號的操作。第 19 檔已由擁有者套用並逐檔對齊；本輪不重新部署前端、不再套用 migration。

兩個新建的專用 QA 帳號使用隨機密碼及保留測試網域，不是既有使用者。透過擁有者已登入的 Supabase Dashboard 建立並勾選 Email 確認；沒有寄送驗證信、變更全域 Auth 設定、取得 server key 或預置 browser session。其後所有產品操作均從 App 的 Email／密碼表單登入，以各自真實 session 經正式 RPC／RLS 執行。沒有讀取或修改其他使用者的私人資料。

Browser plugin 未提供，沿專案既有 Playwright 與官方 CLI；A 使用獨立 390×844 手機尺寸 session，B 使用另一個 1280×900 桌面 session。

| 操作 | 線上 UI 結果 |
| --- | --- |
| A 新增日曆、建立家庭及 Email 綁定邀請 | 新日曆保存成功；第 19 檔的新增／回傳修正實際可用 |
| B 從邀請連結登入、預覽並明確接受 | 加入家庭；A 再明確選 QA 日曆、共同編輯及確認才分享 |
| A 建立共用及私人行程，B 重新確認分享 | B 看見共用行程，沒有 A 的私人行程 |
| B 修改共用行程、建立共用待辦 | A reload 讀回同一修改及 B 建立的待辦 |
| B 在自己的日曆新增行程 | B 可讀回，A 看不到；兩邊關閉瀏覽器後以新 session 密碼登入仍保存 |
| A 改為只能查看，B 重新確認分享 | 收到日曆標示只能查看；行程欄位／保存及待辦完成、修改、刪除、優先度、日期操作停用 |
| A 關閉分享，B 重新確認分享 | 收到的日曆、共用行程及待辦消失，B 本人行程仍存在；A 保留兩筆行程及待辦 |
| B 真正登出，再從表單密碼登入 | 只讀回本人行程，撤權內容沒有恢復 |
| A 恢復 QA 日曆共同編輯，B 重新確認 | 共用行程及待辦恢復，兩邊各自私人內容仍隔離 |

最後保留一個 QA 家庭、A 的 QA 共用日曆、A 共用／私人行程、B 本人行程及 B 建立的共用待辦，供擁有者直接體驗；只有這份假資料日曆恢復 edit，沒有分享 A／B 的預設個人日曆。兩個線上 QA 帳號不刪除，與上節已清理的本機 fixture 不同。憑證只保存在本機 TEMP 的私人 JSON，由 agent 在交付訊息提供本機檔案連結；Git 追蹤檔與 PR 不含帳號 Email、密碼、JWT、user ID 或邀請 token。已使用的邀請暫存檔已清除，兩邊登出後 2026-10-26 均顯示 0 個行程，再關閉本輪兩個 CLI session。

實際 `Intl.DateTimeFormat().resolvedOptions().timeZone` 兩邊均列印為 `Etc/GMT-8`；尺寸分別 390×844／1280×900，頁名正確、內容非空、無 framework overlay／水平溢出，console 各 0 errors／warnings。TEMP 的 A／B 最終日詳情、view 停用及 off 個人保留截圖均已目視；日詳情的「衝突」徽章是三筆測試行程使用同一時段所致，不是分享版本衝突失敗。

本項完成擁有者委託的線上專用雙帳號核心驗收，DP-206 移至 Done。Email 確認是管理端 setup，不能當成驗證信寄達；本輪也沒有重驗 Google OAuth、實體手機、standalone 或兩人同時提交的版本競態，既有 HTTP／pgTAP 的競態證據不冒充此次線上 UI 結果。DP-032／077 真機及 DP-034 放行界線不變；DP-207 在 main 的取消登入修正尚未部署。沒有產品、schema、版號、已發布公告或部署變更，寵物後續仍暫緩。

## DP-211 共用待辦 HTTP 補驗（2026-10-27）

從 PR #206 合併 `7467667` 接續，補足原八組中待辦只有新增、單筆改名拒絕的缺口。專用 `DayPopHTTP208` 本機 stack 的 19 份 migration 內容與 repo 一致、沒有 project link；先跑原八組通過，再加入上表三組與降權／撤權的完成及刪除檢查。父子項均依既有的一層產品契約建立，不新增多層子項能力。

本機最終十一組通過，實際 Node 時區 `Etc/GMT-8`。完成及取消完成直接核對 owner 的 persisted rows；子項重讀核對標題、優先度、日期、階層與完成。子樹含 A／B 不同作者，舊子項版本拒絕後逐欄比對全樹不變，更新後才成功整批刪除。私人後代同時核對 repository 及 B 直接 HTTP 不可見，拒絕成員連帶刪除後 owner 全列不變，owner 自己可刪完整子樹。

兩項本機負控制分別把 shared `toggleTodo` 與 `deleteTodo` 改為不執行：新完成持久化斷言在第 5 組失敗、子樹舊版本斷言在第 6 組失敗；兩次都清掉兩個假帳號。每次 finally 核對沒有外部編輯後逐 byte 還原產品來源，再跑最終十一組恢復通過。完整 1,404 單元＋39 Node、lint／typecheck／build／check:build、Node 語法與差異檢查通過；沒有新增單元案例或 browser case，CI 沿同一個 HTTP npm script 執行十一組，結果需以本段最新 head 為準。

結束前唯讀確認專用本機 users／families／calendars／events／todos 各 0；本輪 stack 已停止。保留的線上 QA 帳號與內容未操作。本輪只有回歸及交接，沒有產品、migration、CI 門檻、v4、版號、公告或部署變更；沒有把本機 HTTP 當成新一輪正式站台／Email／OAuth／真機驗收。

## DP-212 家庭成員變更 HTTP 補驗（2026-10-27）

前段 [PR #207](https://github.com/yoyoCadence/DayPop/pull/207) head `7b4be05` 的 CI `40421896958` 四項成功、同 head 完成審查無發現及無未解決討論後合併 `a878372`；本段由該最新 main 接續。先跑十一組基線，再補退出、owner 移除、解散三組。沿相同專用本機 stack，19 份 migration 內容與 repo 一致、沒有 project link；產品操作仍只有兩個本輪假帳號的真正密碼登入 client。

每組都先確認 B 實際讀到共用行程及待辦、權限為 edit，再分別保存三個舊編輯 snapshot。成員變更由正式 family service 執行，另重新查詢雙方家庭確認伺服器結果；三種舊操作均被拒，B 對日曆／行程／待辦的直接 HTTP 查詢也各回空。A 全部日曆／行程／待辦 persisted rows 逐欄不變，包含 `created_by` 為 B 的共用待辦；B 個人 projection 也完全相同。退出與移除後的重新邀請，預覽及 pending 均不恢復資格，必須再次明確接受才讀到 A 原先明確分享的日曆。解散後兩邊無家庭、A 分享設定消失，但原日曆與事項仍在。

三項負控制把正式 family service 的 leave／remove／dissolve 各自改成回傳合法成功形狀但不送命令；新第 12／13／14 組分別在獨立家庭重讀斷言失敗，均清理兩個假帳號。finally 核對沒有外部編輯並逐 byte 還原來源（SHA-256 前綴 `04f6e616a319`），最終正常十四組再通過，實際 Node `Etc/GMT-8` 已列印。結束前唯讀確認本機 users／families／calendars／events／todos 各 0，專用 stack 已停止。

完整 1,404 單元＋39 Node、lint／typecheck／build／check:build、Node 語法及差異檢查通過。最初測試／build 在沙箱因 Vite 子程序 `spawn EPERM` 無法啟動，以相同命令提升執行權限後通過，沒有修改測試或門檻；自己的最新 head 四 CI／同 head 完成審查仍須另行通過。

本輪未發現需修正的產品問題；只補同一 HTTP script 及交接，沒有新增 UI 案例或改動 CI 四 gate／門檻、migration、v4、版號、公告或部署。保留線上 QA 帳號與內容未操作，不將本機結果當成新一輪線上／Email／OAuth／真機驗收或 DP-034 放行；寵物仍暫緩。

## DP-214 雙向分享與重複事項收尾（2026-10-28）

> 完成更新：[PR #211](https://github.com/yoyoCadence/DayPop/pull/211) head `44b4626` 的 CI `40605937563` 四項成功，Chromium 289 passed／13 skipped（16.4 分鐘）、WebKit 8、386 pgTAP，真正 HTTP 17/17 且實際 UTC；同 head 審查完成無發現、無未解決討論後，已合併 `fd3aec5`。以下「待自己的 CI」為準備時的紀錄。雙人 v1 開發與永久驗收已齊；0.4.5 候選及部署界線另見 [DP-216](two-person-release-candidate-2026-10-28.md)。

承接擁有者要求完成雙人功能，PR #209 等待期間從當時最新 main `0eaeb72` 獨立準備，原十四組先通過後補成十七組；#209 四 CI／同 head 審查通過後合併 `71a9d25`。全天雙向先過，擴充指定時間後真正抓到取消復活／替換重複，因而暫存原準備 `ab9f2da`，拆成 [DP-215／PR #210](https://github.com/yoyoCadence/DayPop/pull/210) 的產品修正，詳 [同一瞬間識別](timed-occurrence-identity.md)。#210 head `ce3064e` 的 CI `40603682150` 四項成功（Chromium 289／13 skipped、WebKit 8），同 head 完成審查無發現且無未解決討論後合併 `ec53398`。本段已重放到該最新 main；產品改動屬 DP-215，本段只送 HTTP 回歸及交接，沒有 schema 變更。

邀請先驗證重發輪替同一邀請且不增加保留名額、舊 token 失效；撤銷及拒絕後不建立 membership，最後另產新邀請、預覽、明確接受，已接受的 token 也不能重用。雙向流程中 B 分享自己的新日曆，A 雖為家庭 owner，仍不能讀 B 私人行程或改 B 分享；直接 RPC 使用真正的當前 grant 版本，必須回 `sharing_calendar_owner_required`，不是靠錯版本造成拒絕。A 在 B 日曆建立的行程由 B 擁有、作者為 A；兩邊收到的日曆不成 default、不進個人 projection。

兩邊輪流作日曆擁有者及共同編輯者，每個方向各測全天與紐約 09:00 指定時間（當日為 13:00Z），共四個 fixture，均建四次每日系列，另一方替換 10/27、取消 10/28。擁有者重新載入後核對 base、replacement、兩個 exception 的日期／瞬間與真實作者，再用正式 resolver 確認只出現 10/26、10/27、10/29，替換只顯示一次，指定時間及原時區保留。首輪誤把更新版本戳當成不可變欄位，已按既有 CAS 契約拆成「系列業務內容不變」及「版本必須前進」兩個斷言，沒有修改產品。雙向舊 editor 在 owner 先更新後再改單次，必須回明確內容衝突，base／replacement／exception raw rows 逐欄不變。owner 切 root 私人後，另一邊連直接 HTTP 都讀不到整個 graph；恢復 inherit 後仍保留替換／取消，不使 occurrence 復活。

原成員變更三組另核對 B 對外分享在離群後消失，再明確接受也不自動恢復 B 舊 outgoing grant；A 的既有分享則依其仍有效的明確授權呈現。三項負控制分別停用 replace、cancel 與切私人，第 6／6／7 組均被新的持久化／graph 斷言抓到；finally 核對沒有外部編輯並逐 byte 還原 repository（SHA-256 前綴 `9583675609e7`），每次都清理兩個假帳號。修正後全部四份 fixture 的正常 **17/17** 通過，負控制後再跑十七組亦過，暫時診斷輸出已移除。

專用本機 19 份 migration 名稱／內容一致、沒有 project link，實際 Node `Etc/GMT-8` 已列印。重放最新 main 後再跑 **17/17**，唯讀確認 users／families／calendars／events／todos 各 0，專用 stack 已停止。DP-215 完整 1,418 單元＋39 Node、lint／typecheck／build／check:build 及相關 Chromium 21 passed／1 skipped＋WebKit 8 passed 已過；另在明確列印生效的 America/New_York／UTC 各跑 35 項 occurrence／recurrence 回歸通過。本段沿用同一產品 bytes，另 lint／Node 語法／差異檢查通過，不因只有回歸變更重新宣稱畫面已改；自己的最新 head 四 CI／同 head 完成審查仍須獨立通過。

此輪沒有操作保留線上 QA，也沒有部署、遠端 migration、版號、公告、v4 或 CI 門檻變更；不把 HTTP 當 Email／OAuth／真機驗收。已定案雙人 v1 的完成範圍與公開版本界線見 [完成矩陣](two-person-readiness.md)。
