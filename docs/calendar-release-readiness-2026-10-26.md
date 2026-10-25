# 多帳號與共用日曆發布準備（DP-205）

2026-10-26。擁有者明確要求優先讓不同帳號開始使用行事曆，包含共同維護分享事項。寵物後續素材／registry／播放政策暫緩；已完成的 DP-204 本機試作保存在遠端 `feat/dp-204-pet-local-step`／`3d344f2`，未自己的 PR／CI，不納入本項。

本項準備 0.4.4「家庭日曆一起用」，只新增本版公告與對應 App／PWA release assets、使用指引及發布驗收紀錄。家庭／日曆分享程式已由 DP-047–049 合併；不新增 migration，不改 user-data v4、Auth／RLS／repository 或既有寵物播放政策，不操作正式使用者內容。

## 當前阻擋點

已直接讀取線上 [version.json](https://yoyocadence.github.io/DayPop/version.json)，仍是 0.4.3。公開首頁載入 `/DayPop/assets/index-CH_sPwz5.js`（681,737 bytes），其中沒有 `calendar_sharing_manifest`／`calendar_group_shares`；GitHub Actions 的 [Deploy staging](https://github.com/yoyoCadence/DayPop/actions/workflows/deploy-staging.yml) 最新成功 run 仍是 2026-10-18 的 `39093740111`。目前線上確實還沒有分享前端。

本機唯讀 `supabase migration list --linked` 的目標為既有 DayPop `aquhcaduovkxyfhzywgc`；18 筆 local／remote 全相同，最後兩筆為 `20261018045829` 家庭與 `20261019104837` 日曆分享。沒有重推、reset、repair 或 DDL，也沒有查詢任何 users／日曆內容。先前完整 [家庭權限矩陣](family-sharing-permissions-verification.md) 與 postflight 保留為既有證據，本次沒有冒充重新執行遠端 pgTAP。

公開 Auth `/health`／`settings` 回 200；Email、Google、註冊開啟，Email auto-confirm 關閉，使用者需完成驗證信。只輸出公開設定是否存在及允許的 flags，沒有輸出 key、登入、註冊或讀取任何帳號資料。Node 實際時區 `Etc/GMT-8`。

## 候選與交付範圍

0.4.4 六條短公告涵蓋家庭邀請、日曆分享、共同維護與私人事項、前景重查／衝突草稿、個人備份邊界及有界月曆。0.4.3 等七份既有 release entries 逐欄不變；package／lock 只改 App 版號，`public/version.json`／`public/sw.js` 由既有 generator 產生，worker template 不改。

實際兩帳號入口與預期結果見 [開始使用共用行事曆](shared-calendar-start.md)。文件依目前 UI 的「產生邀請連結」「設定日曆分享」「重新確認分享」撰寫，區分共用 edit／view、日曆擁有者的私人事項、手動交付邀請連結與收到分享的非持久化界線。

本機驗證、PR／最新 CI／審查與實際發布結果仍待本項後續記錄。合併不等於部署完成；沿既有 staging 工作流執行發布後，必須再核對線上版號、公開 bundle／Auth UI、PWA 更新、兩帳號使用與資料保存。真實帳號／Google OAuth／真機結果尚未宣稱通過，DP-034 正式放行仍保留原有界線。
