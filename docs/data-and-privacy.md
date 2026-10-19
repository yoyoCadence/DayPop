# App 內資料與隱私說明（DP-118）

這份交接記錄設定中「資料如何保存與刪除」卡片的事實依據。它描述目前功能，沒有新增資料處理、同意流程或刪除能力；DP-034 的完整上線驗收仍以任務板為準。卡片位於資料備份之後，預設收合，使用 native details／summary 與既有設定卡片 token；Enter／Space 展開或收合，不保存閱讀狀態。

| 使用者看到的說明 | Repo 依據與界線 |
| --- | --- |
| 遊客存在目前瀏覽器，換裝置不自動轉移；storage 降級時先匯出未保存內容 | `src/storage/localRepository.ts`、`browserStorage.ts` 與持續 `StorageWarningBanner`。不把記憶體模式說成可持久保存。 |
| 帳號資料保存至 Supabase，device 留 cache，guest 不自動上傳 | `src/data/SessionDataProvider.tsx`、`supabaseRepository.ts`、`cachedSupabaseRepository.ts` 與 `src/storage/accountCache.ts`。guest／account identity 與 storage key 分離，cache 不整份上傳。 |
| 帳號驗證用 Supabase Auth，Google 登入連到 Google | `src/auth/AuthProvider.tsx` 的 signInWithPassword／signInWithOAuth(provider: google)。沒有在此變更 provider 或 redirect。 |
| 日曆預設僅供本人；加入家庭不會自動分享，擁有者明確開啟 view／edit | DP-048 `calendar_group_shares`、membership／scope 的 RLS 與版本核對 RPC；包含既有與未來非私人行程／待辦。「不分享」只有日曆擁有者可見，群組 owner 或事項作者都不能越權。附件／聯絡資料／貼圖／Storage 仍 owner-only；不是絕對保密承諾。 |
| 家庭名稱、成員關係與受邀 Email 保存在 Supabase；成員只見必要名稱／角色 | `family_groups`／`family_memberships`／`family_invitations` 的 RLS、欄位 grant 與受控 RPC。受邀 Email 只供 owner 與對應已驗證帳號查看，token 只存 hash，App 不寄家庭邀請信。接受前需登入及確認，群組 owner 不因此取得私人日曆內容。 |
| 待確認的邀請只以 sessionStorage 銜接登入，不進帳號快取或備份 | `src/family/invitationIntent.ts`／`invitationStore.ts`，`daypop.pending-family-invitation` 只放 token 與捕捉時間，讀取超過七天的紀錄即丟棄。接受／拒絕／使用者關閉時清除，storage 不可用時保留記憶體並提醒 OAuth 後重新開連結。Auth hash 不移除；URL 的家庭 token 捕捉後從網址移除。 |
| 附件需登入、存於私人空間，下載 link 到期 | `src/data/repository.ts` 的 attachment capability、`supabaseRepository.ts` 的 signed URL（60 秒），及 private bucket／owner policies。卡片不固定承諾時長，避免將來調整時造成過時文案。 |
| JSON／ICS 只匯出本人資料；JSON 不含附件、匯出檔未加密 | `personalData()` 投影本人文件，再由 `src/domain/dataTransfer.ts` 的 allowlist 與備份 helper 輸出；設定與 App error fallback 同樣排除收到的分享、家庭關係、grant、作者欄。附件需個別下載，副本需自行管理。 |
| 收到的分享只留本次記憶體；離線／未確認登入只顯示本人有效快取 | `calendarSharing.ts` session metadata、`SupabaseDayPopRepository` 分開讀取與 `CachedSupabaseDayPopRepository.#persist()` 的 personal projection。viewer hide 不寫 DB／cache；身份換掉即丟棄 received。前景／online／visibility 及拒絕後重新核對，沒有 Realtime 清除保證。 |
| 共享衝突保留草稿；還原 JSON 前先關自己的分享 | server 完整 timestamp CAS、queue 呼叫時與 editor 開啟時固定版本；不自動重送。UI／repository 拒絕分享中的 JSON replace，DB calendar DELETE trigger 使舊 importer 也整批 rollback；搬入已分享日曆需明確確認目的 grant 版本。 |
| 待辦編輯位置因離線／撤權關閉，輸入副本只留本次記憶體 | `retainedSharingDraft.ts` 只擷取 dirty input，不保留原始資料列在 visible view；App 的「未保存的輸入」可選取複製。成功／明確取消會清除，捨棄或登出／關閉 App 也清除；不進 localStorage、sessionStorage、快取或備份。 |
| 登出不刪雲端資料，device 可能仍留 guest／account cache | `AuthProvider.signOut()` 僅撤銷 session；SessionDataProvider 切 identity，沒有刪除 guest／account-cache 的 handler。不能把登出稱為清空資料。 |
| 瀏覽器也保留上次匯出的時間和筆數（DP-175，2026-10-16 加入這句） | `src/screens/lastBackup.ts`：`daypop.last-backup.guest` 與 `daypop.last-backup.account.<encoded user id>`，只有匯出時間與日曆／行程／待辦／貼圖／未含附件的筆數，沒有標題或內容；不進 user data、不同步、不在備份裡，登出也不刪除。key 帶 user id，與既有帳號快取相同。 |
| 可逐筆刪除事件／待辦／貼圖；父待辦連子孫一併刪除 | 現有 repository 操作與 DP-115 的 `withoutTodo()` 完整子樹邊界；不宣稱附件實體即時完成清理或伺服器備份保留期間。 |
| 刪除日曆會移動內容 | `calendarDeletionPlan()`／`withoutCalendar()`，若刪原 default，倖存 calendar 會被提升為 default。不是刪掉其事件、待辦與貼圖。**DP-138（2026-10-07）起**帳號端由 `delete_calendar_with_reassignment` RPC 在一個交易內完成同一件事（遊客端仍用 `withoutCalendar()`）；卡片的說明文字不需更動。 |
| 尚無一鍵清空全部資料或刪除帳號 | 現有 Settings／Auth／repository 沒有這些入口。復原畫面的 blocked guest reset 是另一條受備份閘門保護的流程，不冒充一般資料全刪除。 |

所有內容放在 `src/screens/DataPrivacyCard.tsx`，沒有事件 handler、外部 link、追蹤、分析請求或 repository 呼叫；讀取說明不改 guest、cache、session 或偏好。卡片借用 `accountAndDialogs.css` 的 canonical 設定卡片邊框／背景／陰影與原有 summary 焦點框，沒有另一套 palette。原稿沒有此功能，所以是沿 canonical 元件擴充自有說明，非逐像素還原；決策見 ADR §3。

DP-048 已同步補上家庭日曆分享，仍待擁有者推第 18 檔 migration 與部署。後續新增清空／帳號刪除、provider 或備份加密時，必須同步更新這張卡片與本表。正式政策、資料保留、刪除服務與監控等仍需要獨立的產品及實作決策；本項不把這些清單標成已完成。

驗證於最新 main `d253696`：lint／typecheck／830 個單元案例（59 檔）／build／check:build 通過，既有 responsive shell／canonical account e2e 9 passed、3 個桌面不適用案例 skipped；保留既有 >500kB chunk 提示。實際渲染原稿設定卡片後，比對 390×844 漫畫淺／深色及 1280×900 像素深色。375×667 的六主題淺／深色 12 組均驗證卡片 surface／fg 與當前 palette 相同、summary 鍵盤焦點 2px、Enter／Space 切換 open、全文可捲動且末段在 tab bar 上方、無水平溢出；所有 guest bytes 不變。另以 dev-only FakeSupabase 登入 smoke 驗證閱讀不改 guest 與 account cache。實際 Intl 印出 Asia/Taipei，console warning／error 與 pageerror 均為 0；證據在系統暫存 daypop-dp118-proof／visual／themes／account 腳本。帳號腳本首次漏掉登入後回設定，修正導航步驟後通過；沒有 App 修正、放寬斷言或真實帳號／Supabase／staging／真機驗收。
