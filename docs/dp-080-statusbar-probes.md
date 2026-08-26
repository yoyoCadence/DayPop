# DP-080 狀態列探針：受控對照紀錄（已結案）

> 建立於 2026-08-25；2026-08-26 完成實機測試並結案。
> 本文件是歷史驗收紀錄。暫時探針與產生器已移除，不再是可執行操作手冊。

## 目的

DP-080 記錄的原始症狀是：從 iPhone 主畫面圖示開啟 DayPop（standalone）時，iOS 狀態列的時間、訊號與電量看不見；Safari 內正常；淺色與深色主題都曾發生；版面沒有位移。

當時只有時序關聯：DP-074 之前的 standalone 截圖看得見，之後看不見，但中間部署同時包含 DP-074、DP-076、DP-078，沒有 before／after 或 revert 證據。因此建立六張無 JavaScript、各自可安裝的靜態頁做受控對照；它們曾由 `scripts/generate-statusbar-probes.mjs` 產生到 `public/diag/statusbar/`。

## 對照矩陣

| 探針 | 當時控制的變因 | 實機結果（兩輪） |
| --- | --- | --- |
| A 舊畫布 | `html #f7f3ff`、viewport `#ffffff`、未宣告 status-bar-style | 狀態列可見 |
| B 新畫布 | `html #ffffff`、viewport `#ffffff`、未宣告 status-bar-style | 狀態列可見 |
| C 深色畫布 | `html`／viewport／theme-color 均為 `#121212` | 狀態列可見 |
| D 無 theme-color | 與 B 相同，但 meta 與 manifest 都不宣告 theme-color | 狀態列可見 |
| E bar=default | 與 B 相同，另宣告 status-bar-style=`default` | 狀態列可見 |
| F bar=black | 與 B 相同，另宣告 status-bar-style=`black` | 狀態列可見 |

## 2026-08-26 實機結果

- 裝置：iPhone 15 Pro Max。
- 系統版本：iOS 26.3.1(a)（依專案擁有者提供的版本字串原樣記錄）。
- 證據：A–F 各測兩輪，共 12 張由專案擁有者提供的截圖；本 repo 不另收錄裝置截圖。
- 執行模式：每張都顯示「此頁是從主畫面開啟的（standalone）」。
- 可見性：每張的時間、行動網路、Wi‑Fi 與電量都清楚可見。A 為淡紫背景搭配深色圖示；B／D／E／F 為白色背景搭配深色圖示；C 為深色背景搭配白色圖示。
- safe area：六格的診斷線都為 0 高度；這只描述本次非 translucent standalone 的實際 viewport，不外推為其他 iOS 模式的通則。
- 正式 App：完成探針後，專案擁有者也確認原本的 DayPop 主畫面 App 已能看到狀態列。

## 可以與不可以下的結論

可以說：

- 六張靜態探針在這次實機複驗都沒有重現症狀。
- A、B 都可見，因此 `#f7f3ff` 與 `#ffffff` 的靜態畫布差異不足以單獨重現。
- B、D 都可見，因此有無 `theme-color` 不足以單獨重現。
- B、E、F 都可見，因此未宣告／`default`／`black` 都沒有重現；這些值之間的差異不是本輪可辨識的原因。
- C 可見，因此深色靜態頁也不足以單獨重現。
- DP-080 的結案狀態是「複驗無法重現、成因未確認」。

不可以說：

- 不得宣稱畫布顏色、`theme-color` 或 `apple-mobile-web-app-status-bar-style` 的任一設定修好了問題。
- 不得把正式 App 恢復可見歸因於部署、快取、重裝、iOS 更新或任何程式修改；本次沒有取得能支持這些因果的證據。
- 不得把「本次沒重現」改寫成「原始症狀不存在」。原始觀察仍保留在 [`mobile-qa-2026-08-22.md`](mobile-qa-2026-08-22.md) §2.7。

## 清理

DP-080 結案後，暫時的 `public/diag/`、`scripts/generate-statusbar-probes.mjs` 與 `package.json` 的 `probes:statusbar` 已移除。正式 App 的狀態列程式與設定沒有因本次結案而變更。
