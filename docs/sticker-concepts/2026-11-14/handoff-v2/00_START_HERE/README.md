# DayPop DP-244｜貼圖 Phase 1 Agent 接手包

**更新日期：2026-11-14｜狀態：方案 C 已核准用於 Phase 1；4 張仍待重繪／驗收，未接入 App、未批准發布。**

> **先讀這份。** 此 ZIP 同時是實際 4 張 SVG 樣本 + 已決策方向 + 後續工程規劃 + 可直接給開發 Agent 的指令。不只是圖片檔。

> **本次決策更新：務必先讀 [`OWNER-DECISIONS-2026-11-14.md`](OWNER-DECISIONS-2026-11-14.md)。** 其中依 GitHub `main` 實際檢查，修正 hiking fallback 🏔️ → ⛰️。本包圖檔本身仍是未通過的草稿。

## 30 秒摘要

- **現況 DP-243**：現有 240 個系統 emoji，已經可用，**完全不依賴本包素材**，不得破壞。
- **提案 DP-244**：評估原創漫畫貼圖（方案 C）為品牌差異化；**不要一口氣做 240 張**。
- **Phase 1 現有產物**：4 張原創 SVG 草稿（開心、禮物、蛋糕、登山）＋實際尺寸預覽頁。
- **下一步**：在 10/16/22px 與深淺背景測試、按需要修改樣式、由擁有者做視覺與授權簽核。
- **驗收通過後**：Phase 2 可根據人工優先度（非虛構使用統計）製作另外 20 張，累積 24 張；Phase 3 才接 App。
- **不可視為已完成**：已核對 GitHub 的主要 repo 路徑與 catalog；但無本機與正式 environment 的完整測試、無授權最終核准、無 DB/UI/SW 實作、無手機實機驗收。

## 先開哪些檔案

| 順序 | 檔案 | 用途 |
|---|---|---|
| 1 | `00_START_HERE/README.md` | 目前狀態與使用方式 |
| 2 | `01_DECISIONS_AND_PLAN/DECISION-RECORD.md` | 不做／先做哪些事及理由 |
| 3 | `01_DECISIONS_AND_PLAN/ROADMAP.md` | Phase 1 → 2 → 3 逐步計畫與完成定義 |
| 4 | `04_AGENT_HANDOFF/AGENT-START-PROMPT.md` | 一鍵貼給新 Agent 的交接指令 |
| 5 | `02_ASSETS/preview.html` | 在瀏覽器看真實 CSS 尺寸樣本 |
| 6 | `03_QA_AND_TOOLS/QUALITY-GATES.md` | 驗收、授權與發版阻擋條件 |

## 內容目錄

```text
DayPop_DP244_Phase1_Handoff_v2/
├── 00_START_HERE/
│   └── README.md
├── 01_DECISIONS_AND_PLAN/
│   ├── DECISION-RECORD.md
│   ├── ROADMAP.md
│   └── INTEGRATION-CONTRACT.md
├── 02_ASSETS/
│   ├── happy.svg, gift.svg, cake.svg, hiking.svg
│   ├── manifest.csv              # 4 張，授權標為 review-pending
│   ├── STYLE-GUIDE.md
│   ├── preview.html              # CSS 尺寸與深淺模式互動預覽
│   ├── contact-sheet.png         # 靜態總覽，不能取代實機目視
│   └── asset-provenance.md
├── 03_QA_AND_TOOLS/
│   ├── QUALITY-GATES.md
│   ├── RISKS-AND-OPEN-QUESTIONS.md
│   ├── audit_assets.py           # 純 Python 標準庫檢查，無第三方套件
│   └── audit-results.json
├── 04_AGENT_HANDOFF/
│   ├── AGENT-START-PROMPT.md
│   └── TASK-MD-SNIPPET.md
└── 05_REFERENCES/
    └── DP-244-REQUIREMENTS-SUMMARY.md
```

## 使用方法

1. 解壓到 DayPop repo **外面**先看，或將資料夾複製到 repo 的 `docs/proposals/`（需先配合 repo 既有規範）。
2. 在同資料夾開啟 `02_ASSETS/preview.html`（可使用手機瀏覽器開啟；若裝置禁止本地檔讀取，透過本機可信賴的預覽工具，不需上傳到第三方網站）。
3. 在專案 repo 根目錄開新 Agent 工作階段，貼上 `04_AGENT_HANDOFF/AGENT-START-PROMPT.md`。
4. 新 Agent **先做 read-only repo 審查**、列出現況與相容性，完成 Phase 1 驗收；**不要直接跳到 Phase 3 整合**。

## 禁止將提案誤當發版授權

目前 `manifest.csv` 的 `license` 是 `review-pending`，表示還沒進入發版授權清單。這是刻意的安全閘門：擁有者核對作品來源、AI 工具條款、權利歸屬及相似性風險後，才可依專案政策批准改成 `owner-original`。AI 輔助產物的授權與權利歸屬，**不能靠一份 CSV 宣稱已完成**。

**若 QA 不通過：留在 Phase 1，不要硬上 24 張，更不要部署。**
