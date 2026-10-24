# 預設月光貓三態接入（DP-188，2026-10-23）

> **DP-192 後續接入（2026-10-24）：** idle 採 DP-191 減樣，sleep 加入 registry；使用者介面仍觸發 idle／look／grab。下方 DP-188 八檔／數字保留為原始交付紀錄，現況依本節。

## 混合編碼與 sleep registry（DP-192）

依持續開發／逐段 PR、CI 與審查通過後合併授權，採用 [DP-191 建議包](pet-concepts/2026-10-24/encoding/README.md)：idle／sleep 使用約 5fps Q85，look 仍逐 byte 等於 DP-187 原 10fps，idle／grab PNG 不變，新增 DP-190 sleep PNG。兩款各六檔都由 Vite 打包；sleep 只登錄，App 沒有睡眠觸發或角色選擇。素材入 registry 不代表擁有者已目視確認 sleep。

| 角色 | idle WebP | look WebP | sleep WebP | idle PNG | grab PNG | sleep PNG | 合計 bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 月光貓 | 52,324 | 37,998 | 50,314 | 13,572 | 13,390 | 13,252 | 180,850 |
| 軌道噗 | 43,598 | 34,894 | 42,828 | 10,318 | 10,481 | 10,254 | 152,373 |

每款仍 ≤192 KiB，原 idle ≤128／look ≤48／PNG ≤16 KiB 不改，新增 sleep ≤64 KiB。Node 回歸逐 byte 比較真實 App 資產、三段交付來源與已發布 manifest SHA-256；建置守門要求十二個唯一 content-hashed 輸出與來源完全相同，包含未選飛碟／sleep。DP-191 歷史 checker 只讀原四項預算鍵，避免新增 pose 上限使原實驗失效；候選與量測 manifest 不回寫，重新驗收通過。

`PetArtwork` 的 PNG／reduce／暫藏／背景／解碼／失敗與 look 計時程式無改；registry 讓 sleep 共用既有生命週期。`PetLayer` 仍只挑三態，e2e 要求一般操作不下載飛碟或 sleep。沒有預載、service worker、AppStorage、user-data v4、0.4.3、18 migrations、公告或部署變更。

本機 lint／typecheck、1,384 單元＋27 Node、build／check:build 通過；圖片實檔總量如表，JS 含 worker 745,314 raw／219,525 gzip、CSS 112,388／27,272 bytes。相關 Chromium 14、WebKit 6，共 20 e2e 通過，包含真正 production 首次離線缺 PNG 回 CSS、guest bytes 不變。Browser plugin not available，沿專案 Playwright；390×844／1280×900、實際 `Asia/Taipei` 核對 App identity／非空白／無 Vite overlay／60px 幾何，再用已刪除的隔離暫存檢視頁實際掛載兩款 sleep，確認 native 動畫有變化、PNG 靜止、reduce／hidden／錯圖 CSS 與乾淨 console。App 與素材截圖在 `%TEMP%/daypop-dp192-*.png`，不提交測試產物；不能代替 iOS standalone 或擁有者動作品質驗收。

三項 registry／生命週期回歸先在舊程式失敗；反向恢復 registry 再得到相同三失敗，舊四檔守門使 sleep 兩項失敗，清空預算 problems 得六失敗，破壞實際 App idle 一個 byte 亦由來源回歸拒絕。四輪 finally 精確還原三檔與 SHA-256，12 圖片＋27 Node 恢復通過。初次舊守門全套執行未完成即停止，僅以這次限定案例的完整結果作反向證據。

另直接對十二個真實建置輸出降低 sleep／整款上限、移除 sleep 清單項，以及實際追加一個 sleep 輸出 byte，四種皆拒絕；finally 還原輸出與 SHA-256，原預算下兩款重新通過。100 個本機文件連結與最終 lint／typecheck 亦通過。

PR #186 head `984509d` 四項 CI／審查無發現後合併 `a85b60f`（run `40079654688`；Chromium 271 passed／13 skipped、WebKit 6 passed）；本段已移至該最新 main，不重送候選。最新 head 四項 CI 與審查通過才合併；下一段另做前景閒置 sleep 觸發，尚未實作。

基線為 DP-187 PR #182 合併的 `65bfab5`。本項依已核准方案把月光貓接進 App，軌道噗只登記在 typed registry；名稱仍讀既有 `petName`，預設「摩卡」，沒有新增角色選擇或第二份偏好儲存。App 仍為 0.4.3、user-data v4、18 檔 migration，公告與部署另行決定。

## 播放與責任

- `petAssets.ts` 保存內部 `moon_cat`／`orbit_ufo` 與七種 pose 型別，目前只有 idle／look／grab 有素材。其餘四態缺圖時沿用原 CSS，不表示已完成七態。
- `PetLayer.tsx` 維持既有名稱、待辦徽章、泡泡、焦點與 60×60 操作區。idle 是 4.4 秒原生循環 WebP；關閉泡泡才觸發一次 1.6 秒 look，單次 cue 以重新掛載圖片重播，解碼完成才起計時。
- `usePetPlacement.ts` 沿既有超過 4px 的拖移門檻才回報 dragging；pointer 按下不切 grab，真正拖移及鍵盤移動時才用 grab PNG，放開／取消回 idle。只在開始拖移時打斷 look，不以每次 pointermove 重畫。
- `PetArtwork.tsx` 管媒體偏好、頁面可見性、解碼、靜態替代與 cue 清理。泡泡開啟或 reduced-motion 時換真正 PNG；暫藏、頁面背景與初次幾何量測期間移除圖片，收起則卸載圖片元件。CSS 替代在停止狀態也不眨眼。
- 網路或解碼失敗時保留原 CSS 與外層按鈕，不加錯誤訊息。失敗的 look 立即結束，讓健康 idle 恢復；還沒解碼就暫藏／背景的 look 也會丟棄，恢復可見時不補播。過期的解碼及 timer 不得完成較新的 cue，卸載會清理 timer。

無自動走動、完成待辦獎勵或 XP。位置／收起仍經 DP-170 的 AppStorage UI v1，沒有改 user-data、帳號快取或 JSON／ICS。

## 素材來源與預算

`src/assets/pets/` 的八個檔案逐 byte 等於 [DP-187 previews](pet-concepts/2026-10-23/motion/previews/) 中各角色的 `idle.q85.webp`、`look.q85.webp`、`idle-static.png`、`grab-static.png`；沒有重編碼或變動 Blender／原幀。畫布仍為透明 120×120，畫在 60×60 區域，既有相機／比例／anchor 與每幀 8px（縮圖 4px）透明邊距沿用來源驗收。

| 角色 | idle WebP | look WebP | idle PNG | grab PNG | 合計 bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| 月光貓 | 112,830 | 37,998 | 13,572 | 13,390 | 177,790 |
| 軌道噗 | 95,760 | 34,894 | 10,318 | 10,481 | 151,453 |

採用 Q85 WebP＋PNG。`performance-budget.json` 明定每款總和 ≤192 KiB（196,608 bytes）、idle ≤128 KiB、look ≤48 KiB、單張 PNG ≤16 KiB。look 的靜態替代共用 idle PNG，不重複計算。`check:build` 對來源清單及實際 content-hashed 建置檔檢查：預算缺漏／無效、少檔、多檔、未 hash、重複、輸出 bytes 不一致與任一超限都失敗；包含未被選用的飛碟。

## 載入與離線

由 Vite 的本機 URL import 發出帶 hash 的資產，兩款都會打包；只有可見角色實際用到的圖片才下載。沒有預載其他角色、所有動作或 raw frames，沒有加入 service worker 的安裝 shell。既有 `/assets/` runtime cache 只在實際請求後保存，仍只操作 `daypop-app-shell-` cache。

production 回歸先確認 idle WebP 已快取、PNG 尚未快取，再切為真正離線與 reduced-motion；首次 PNG 下載失敗後顯示不眨眼的 CSS，原有 guest bytes 逐字保留。這是可用性回退，不宣稱離線首次即能取得全部姿勢。

## 驗證與限制

相關命令：

```text
npm run lint
npm run typecheck
npm run test -- --maxWorkers=2 --testTimeout=30000
npm run build
npm run check:build
npm run test:e2e -- e2e/pet-assets.spec.ts e2e/webkit-smoke.spec.ts e2e/production-offline.spec.ts
npm run test:e2e -- e2e/pet-assets.spec.ts e2e/pet-bubble.spec.ts e2e/pet-placement.spec.ts e2e/accessibility.spec.ts
```

Browser plugin not available，使用專案 Playwright；手機 Chromium／WebKit 390×844、桌面 Chromium 1280×900，browser 實際時區列印為 `Asia/Taipei`。檢查 URL／title、實際動畫畫面變化、PNG 靜止、兩次 look、pointer／鍵盤 grab、焦點回復、收起、暫藏及 CSS 失敗回退，正常流程要求 console／pageerror 無錯誤。離線測試只允許精確 PNG／version URL 的預期下載失敗。

本機結果：lint／typecheck、88 檔 1,379 項單元與 24 項 Node 測試、build／check:build 通過。建置總 JS（含 worker）744,979 raw／219,440 gzip bytes、CSS 112,388／27,272，都在既有上限內，Vite 的既有 500 kB chunk 警告保留。相關 Chromium 去重 35 passed／3 個既有 desktop skipped，WebKit 6 passed。第二批初跑為 30 passed／3 skipped／1 timeout，失敗僅是十二主題大案例的本機 180 秒期限；單獨以 `--project=mobile-chrome --grep=六套主題 --timeout=120000`（既有 `test.slow()` 乘三，總額 360 秒）重跑 1 passed，約 3.4 分鐘，沒有放寬 axe 的五段已量測文字要求或修改 CI。

三項圖片生命週期回歸在修正前確實失敗：look 網路失敗、解碼前暫藏、解碼前背景；修正後通過。另以真實瀏覽器破壞 look 回應及延後下一次 look 下載，驗證能回到健康 idle、暫藏回來不補播。將 PetLayer／usePetPlacement／calendar.css 暫換回 `65bfab5` 時，四項三態整合回歸再次全部失敗；將預算 helper 的 problems 強制清空，六項 guard 測試失敗。兩輪在 finally 還原四檔並核對 SHA-256，相關測試恢復通過。

原稿 CSS 角色與固定配色 3D 素材的造型差異是擁有者已核准的變更；泡泡、徽章、FAB、分頁與幾何仍依原稿／DP-170。Playwright CLI 獨立測試瀏覽器（實際 `Etc/GMT-8`）逐一操作六主題 × 淺／深色，量得 60×60 操作區、徽章 1、角色不越過分頁且與 FAB 分開；十二張手機、待辦泡泡及 1280×900 像素深色桌面圖已目視。URL／title 為 `http://127.0.0.1:4173/`／日蹦 DayPop，沒有 framework overlay／空白頁或相關 console error。截圖放在本機 `%TEMP%/daypop-dp188-*.png`，不把測試產物提交 repo。Windows／Linux 模擬器不能代替 iOS standalone 真機解碼、耗電、鍵盤及安全區驗收；DP-171 完整七態、DP-172 選擇角色、DP-041 成長仍未結案。
