# 驗收矩陣｜每階段都要過的 Gate

| Gate | 檢查方式 | 本包目前狀態 | 若不合格 |
|---|---|---|---|
| 4 張圖可解析、無明顯外部引用 | `audit_assets.py` | 基本靜態檢查 | 修 SVG，不整合 |
| 單張 ≤ 4,096 bytes | `audit_assets.py` | 4 張符合 | 優化 SVG 或換簡化稿 |
| 24 張總計 ≤ 98,304 bytes | Phase 2 檢查 | 未開始 | 不放寬限額 |
| SVG 1:1、透明底 | 靜態檢查 + 目視 | 有 viewBox；透明度需目視 | 修圖 |
| 16px 語義可辨、10px 輪廓可辨 | 手機開 `preview.html`，深淺背景、100% 縮放 | **初稿未通過設計預審：happy 和 hiking 需修改**；尚無手機實機驗收 | Phase 1 迭代 |
| 4 張筆觸色彩比例一致 | 目視 | **待使用者決策** | Phase 1 迭代 |
| 每個 fallback 位於 DP-243 catalog | GitHub main `src/domain/stickerGlyphs.ts` / 程式檢查 | **人工核對：4/4 符合（hiking 改成 ⛰️）**；請重新跑自動測試 | 修 fallback/ID 對應 |
| license 與來源可追溯 | 擁有者授權／權利簽核 | **待核准：review-pending** | 不發布 |
| 不影響原有 240 emoji | Phase 3 回歸測試 | 尚未整合 | 回滾／修正 |
| 舊資料、舊版 App、離線 fallback | Phase 3 測試 | 尚未整合 | 阻擋發布 |
| JS bundle 不含圖片、資產量符合預算 | build / network inspection | 尚未整合 | 阻擋發布 |

## 快速檢查

在解壓後資料夾根目錄：

```bash
python 03_QA_AND_TOOLS/audit_assets.py
```

若可取得正式 `sticker-catalog.md`，可提供其路徑做 **初步文字存在性**檢查（注意：文字出現不代表已確定屬於貼圖清單，Agent 還要做正式資料結構確認）：

```bash
python 03_QA_AND_TOOLS/audit_assets.py --catalog /path/to/sticker-catalog.md
```

此腳本僅做規格靜態檢查，不能代替完整安全審核與授權／視覺／手機驗收。
