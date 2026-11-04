# 手機縮放與表單寬度修正（DP-236）

2026-11-04。擁有者在 0.4.7 真機驗收時回報：加入主畫面後容易放大縮小；提醒設定及新增行程視窗能左右移動，預期只需上下捲動。此項優先於尚待真機結果的 DP-234，獨立分支／PR；本候選尚未發布，不修改 0.4.7 已公開公告。

## 修正範圍

- `useInstalledGestures` 只在 standalone 或 iOS 主畫面模式啟用 viewport 縮放限制；WebKit 的 gesturestart／gesturechange 用非 passive listener 取消預設縮放。主畫面模式另外把 viewport meta 設為 maximum-scale=1／user-scalable=no，切回 browser 及卸載時精確還原原值，原本沒有 meta 時移除暫建元素。單指平移、點擊、鍵盤與週格／月曆自己的手勢保留，普通瀏覽器不禁止縮放。
- 依擁有者追加的頂部模糊截圖，主畫面模式固定 html／body／root 及 App 外層，禁止外層文件捲動，內容在原有月曆／設定／sheet 區域捲動。safe area 留有實底，固定在標題上方；不讓整份文件位移後把標題推進系統狀態列區。程式內沒有對該標題施加 blur，截圖中的模糊疑似系統 scroll-edge treatment，此判讀尚未在原機確認，不能把桌面 WebKit 結果當成 iPhone 系統效果已消失。
- 行程表單原有七種 13px 欄位改為 16px，降低 focus 自動放大的誘因；installed 的快速新增、搜尋、設定等其他輸入也採 16px，18px 標題不變。原生日期／時刻與其他欄位增加可縮寬度，長日曆 chip 可換行，sheet 內容只垂直捲動。
- 提醒 dialog 使用較明確的 selector，避免原本 380px 上限被後載入共用 300px 規則覆蓋；維持可縮寬度／垂直捲動、長文字換行。沒有改提醒授權、規則、CAS、訂閱或資料保存。

技術依據為 [Pointer Events 的平移／縮放交集與 touch-action](https://www.w3.org/TR/pointerevents3/#determining-supported-direct-manipulation-behavior) 及 [Apple 的 WebKit gesture 事件說明](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html)。實際支援仍以瀏覽器及真機結果為界線。

## 驗證與界線

Browser plugin not available，使用 repo 已安裝的 Playwright，不新增依賴。流程為：設定登入固定假帳號 → 編輯長日曆名稱 → 提醒視窗 → 取消回焦 → 新增行程 → 日期／時間／備註輸入及上下捲動 → 取消；另驗 installed 替身的縮放防護及月曆手勢。沒有正式帳號、OS 權限或真 Push。

修正前新增回歸在 Chromium／WebKit 均抓到七個小字欄位；這些平台在原本短名稱下沒有原樣重現 iPhone 的整頁橫向位移，不能反推使用者回報不成立。修正後測量 dialog、內容 scrollWidth、欄位左右邊界與字體，搭配長無空白名稱，範圍為 390×844、320×568、568×320 及 1280×900。帳號 cache 在取消後精確相同，提醒取消回到原觸發鈕；console 需保持 0，時區實際列印 Asia/Taipei。

四項新單元覆蓋普通 browser、StrictMode／nested dialog、display mode 切換／卸載與 iOS standalone fallback。瀏覽器 installed 狀態是明確替身；縮放只驗 CSS 契約與合成 gesture 取消，Chromium 左右翻月另外使用 CDP touch，週格仍有水平捲動範圍。曾嘗試 `Input.synthesizePinchGesture`，但撤掉 CSS guard 的正控制仍停在 scale 1，證明該路徑在此環境不足以當縮放測試，沒有保留會假綠的 pinch 斷言。這些不能代替真正 iPhone 加到主畫面的雙指、雙擊、鍵盤彈出及欄位選擇器；發布後需依同一路徑複驗，尤其取消鍵盤後整個 App 不能留下放大與左右位移。

完整 1,806 單元＋39 Node 通過，既有產物預算不變。擴大瀏覽器檢查的歷史結果保留如下：

- 第一輪 46 項：38 passed／7 skipped／1 failed，唯一失敗是既有 WebKit 自動列數在預期一月的位置顯示三月；未改斷言、期限或 retry，下一輪完整 WebKit 14 項均通過。
- 第二輪另加入附件與舊保存草稿：23 passed／3 skipped／6 failed；六項保存案例均在動態 import dev entry 後出現 duplicate createRoot、原視窗消失，沒有將此輪算成全部通過。
- 將四個產品 runtime 檔暫時換回精確 main `c952688` 後重跑：相同保存案例仍在相同位置逾時；新表單回歸則抓到七個小字欄位與 **233px** 的內容橫向溢出。finally 將候選四檔逐 byte 還原。舊保存 harness 問題另列 DP-237，不改產品保存語意或放寬測試。

最終相關矩陣 54 項先為 43 passed／9 skipped／2 failed，兩個新 installed 案例的「快速新增」label 同時選到 input 與 button；改為具名 textbox 後，兩個受影響案例在 Chromium／WebKit 均獨立通過（6.1 秒），沒有改斷言、retry 或期限。共 45 個相關案例各已通過；這是完整矩陣加上兩項修正後補跑，不宣稱有一輪 54 項全綠。九個略過是既有桌面重複配色／窄尺寸及主畫面觸控重複案例。

lint／typecheck／明確 `/DayPop/` production build／check:build 均通過；JS＋worker 796,442 raw／235,458 gzip、CSS 121,438／29,665，預算與 CSP 不變。手機及桌面提醒／新增行程共四張截圖已目視，欄位與長名稱在寬度內，標題列／取消／儲存可達；console 0 的斷言保留。候選以外的舊保存案例失敗仍如上記錄，不冒充完整 e2e 已全過。

Chrome browser access host 不可用，既有 PR 技能的瀏覽器建立路徑受阻；先提交並推送候選、保留中文 PR body，沒有改用直接推 main 取代 PR。新 PR 自己最新 head 的四 CI／同 head 完成審查及討論全解後才可合併。此次沒有 migration、release version／歷史公告修改或再次部署。

## 頂部與整頁位移追加驗證

追加修正後完整 **1,808 單元＋39 Node**、lint、TypeScript（production build 的 tsc -b）、Pages build／check:build 通過；JS＋worker 797,080 raw／235,737 gzip、CSS 122,147／29,778，原預算不變。相關 Chromium／WebKit 六項矩陣 **5 passed／1 skipped**（桌面重複觸控），新增 430×932、932×430、390×360 的設定輸入焦點／捲入、外層 scrollTo、轉向後四分頁與外框邊界驗證；scrollX/Y 始終 0，頁面寬度未增加。漫畫深色再跑 installed 兩項均通過，另保留同一桌面略過，實際瀏覽器 Asia/Taipei、單元 Etc/GMT-8。六項 hook 單元另驗 metadata 精確還原與暫建元素移除，普通 browser 與 StrictMode 清理保持可用。

430px 淺色及深色 header 截圖已目視，字體清楚、四分頁與 FAB 在 App 內。這是 viewport 模擬，沒有 iPhone 系統狀態列；頂部系統模糊、真實 safe-area 數值與軟鍵盤開關仍須發布後在原機驗收。原文前段 1,806／四項單元／舊矩陣與失敗紀錄保留作前一 head 歷史，自己的最新四 CI 仍未執行。
