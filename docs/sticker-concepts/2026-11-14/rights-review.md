# DP-244 Phase 1｜素材權利審核表（2026-11-14）

> **結論：沒有發現阻擋 Phase 2 製作的問題，但這不是法律查核，也不是授權核准。** 四張的 `license` 全部維持 `review-pending`。能把它改成專案授權格式（例如 `owner-original`）的只有專案擁有者的簽核（§5），agent 不會自行更改。
>
> 依擁有者決策 6，這四張 SVG 在核准前**不提交到 repo**（公開 repo 一提交就看得到）。repo 只保存本表、manifest、SHA-256 與檢查結果；SVG 檔另交給擁有者保管，用 `asset-hashes.json` 比對是不是同一份。

## 1. 逐檔紀錄

| 項目 | `happy.svg` | `gift.svg` | `cake.svg` | `hiking.svg` |
|---|---|---|---|---|
| 版本 | 第二輪（重繪） | 第一輪 | 第一輪 | 第二輪（重繪） |
| 製作服務 | Claude Code（Anthropic），本 repo 的工作階段 | ChatGPT（OpenAI）；方案與模型版本，接手包沒有記錄 | 同 gift | Claude Code（Anthropic），本 repo 的工作階段 |
| 日期 | 2026-11-14 | 2026-11-14（接手包 `asset-provenance.md`） | 同 gift | 2026-11-14 |
| 製作流程 | 依擁有者決策 2（臉部大特寫），由 agent 直接寫 SVG 的形狀與路徑。沒有參考圖、沒有描圖、沒有用圖像生成 | ChatGPT 輔助寫 SVG 向量程式。接手包說明這**不是**把第三方 emoji／SVG 套件改名包裝。概念海報是另一條 ChatGPT 圖像生成流程，不是這份 SVG 的來源 | 同 gift | 依擁有者決策 3（山峰為主＋日光，拿掉背包），由 agent 直接寫 SVG。沒有參考圖、沒有描圖、沒有用圖像生成 |
| 沿用第一輪 | 沒有沿用第一輪的任何形狀 | — | — | 沒有沿用第一輪的任何形狀 |
| 之後的修改 | 無 | Claude Code 只做等比縮放置中（長邊 92%）；形狀與色彩不變 | 同 gift | 無 |
| bytes | 1,005 | 926 | 1,193 | 686 |
| SHA-256 | `6e6ea33a546cab41acc1ae9c7f874b4354907743abbbb4dafd1e25db11ad883f` | `75c8baca07cf0862315c84caafbed7b625373ee44d9ea9c3ee101291d17d5707` | `76c8e72022ca95d2e1635d705119597c7cf69ad712235ba6ff2065ba67161dd8` | `e7c26921e7b220d78b25fc2842288dfc55233e693647302d9e650aad1a56440a` |
| 適用條款 | Anthropic（§2） | OpenAI（§3） | OpenAI（§3） | Anthropic（§2） |
| 相似性（§4） | 未發現問題 | 未發現問題 | 未發現問題 | 未發現問題 |
| `license` | `review-pending` | `review-pending` | `review-pending` | `review-pending` |

這四個 hash 與 [`asset-hashes.json`](asset-hashes.json)、[`check-results.json`](check-results.json)、[`measure-results.json`](measure-results.json) 一致。`check_stickers.py --assets` 會拒絕任何 hash 不同的檔案，所以審核過的就是之後要用的那一份。

「人工修改」這一欄沒有任何人手繪或手改。四張都是 AI 服務寫出的 SVG 程式，加上 agent 的程式化修改；擁有者做的是選擇方向和驗收，不是繪製。紀錄裡不能寫成人工手繪。

## 2. Anthropic 條款（happy、hiking）

2026-11-14 讀取，兩頁都只看到生效日期，沒有另外的「最後更新」日期。

| 條款 | 生效日期 | 關於輸出的原文（節錄） |
|---|---|---|
| [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) | Effective Oct 8, 2025 | §4：「Subject to your compliance with our Terms, we assign to you all of our right, title, and interest—if any—in Outputs.」§11 以「AS IS」提供，並明確排除 NON-INFRINGEMENT 在內的保證 |
| [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) | Effective Jun 17, 2025 | §B：「Anthropic agrees that Customer (a) retains all rights to its Inputs, and (b) owns its Outputs.」以及「Anthropic hereby assigns to Customer its right, title and interest (if any) in and to Outputs.」§L.2 排除 NON-INFRINGEMENT 在內的默示保證 |

**哪一份適用，取決於擁有者用的 Claude 方案**（個人方案多半是 Consumer，Team／Enterprise／API 多半是 Commercial），agent 從工作環境無法判斷。兩份的共同點：

- Anthropic 把它在輸出上的權利轉給使用者，但兩份都寫了「if any」，**沒有保證輸出一定有著作權**。
- 兩份都**不保證輸出不侵權**。
- 兩頁都沒有找到「輸出可能與其他人的輸出相同或相似」這類句子。

## 3. OpenAI 條款（gift、cake）

**這個工作環境連不到 openai.com**（兩頁都讀取失敗），所以 agent 無法存檔或引用原文。接手包列出的連結：

- [Terms of Use](https://openai.com/policies/terms-of-use/)（接手包寫的是 2026-01-01 版本）
- [Service Terms](https://openai.com/policies/service-terms/)

接手包的摘要是「有輸出歸屬約定，但不保證排他著作權、原創性或未侵害第三人權利」，與 Anthropic 兩份的結構相同。**這一項要由擁有者補上**：在可以連線的裝置把兩頁存成 PDF 或截圖，記下讀取日期，以及當時用的 ChatGPT 方案。

## 4. 相似性檢查

agent 在 2026-11-14 檢查了四張的結構，並以實寸預覽目視：

- **四張都沒有文字、標誌、商標或品牌元素。**
- **happy**：圓臉、棕色頭髮與瀏海、閉眼的彎線、張開的嘴與腮紅。這是 emoji 與兒童插畫常見的通用表情，沒有可辨識的角色特徵（沒有特定髮型輪廓、配件、服裝或標誌性配色）。
- **gift**：方盒、十字緞帶、上方蝴蝶結，是禮物圖示的通用畫法。
- **cake**：三角切片、夾層、上方草莓與奶油，是蛋糕切片的通用畫法。
- **hiking**：兩座三角山峰、雪頂、右上方的太陽，是山景圖示的通用畫法。

agent 沒有逐張比對 Apple、Google Noto、Microsoft Fluent、Twemoji、OpenMoji 的實際圖檔，**這一步要擁有者目視確認**：把實寸預覽與這幾套 emoji 的 😊🎁🍰⛰️ 並排看，看有沒有「看起來就是同一張」的情況。四張都是通用題材，相似度主要來自題材本身，不構成抄襲；要擋的是構圖、配色、比例都一樣的那種。happy 是人物，最需要看。

## 5. 擁有者簽核需要的證據

依擁有者決策 5，`review-pending` 改成專案授權格式前要有：

| 證據 | 狀態 |
|---|---|
| 服務名稱、日期、製作流程、修改紀錄、原檔 SHA-256 | **已完成**（§1） |
| Anthropic 條款頁與讀取日期 | **已完成**（§2）；適用哪一份待擁有者確認方案 |
| OpenAI 條款頁與讀取日期 | **待擁有者**（§3，這裡連不到） |
| 第三方相似性風險，經人工核對 | **agent 初查完成，待擁有者目視**（§4） |
| 擁有者明確簽核：誰、何時、批准哪幾個檔案、對應哪個 SHA-256 | **待擁有者** |

簽核前：manifest 維持 `review-pending`、SVG 不進 repo、App 不接這四張。

## 6. Phase 2 的 license gate 怎麼解讀

擁有者決策 7 寫的是「Phase 1 四張達 16px／10px 深淺背景與真實月格 QA、掃描、安全、license gate 後，可開始**製作**補充 20 張」。決策 5 則要求授權欄位在「QA 與權利查核通過後」才能更新。

這裡把兩個 gate 分開：

- **開始製作 Phase 2 的 license gate**：本表完成，而且沒有發現阻擋問題（服務條款沒有禁止商業使用、沒有發現抄襲或商標）。**現在已滿足。**
- **把任何一張改成已核准、進 repo、接 App 的 gate**：§5 的擁有者簽核。**現在未滿足。**

這樣解讀的理由：Phase 2 的新圖一樣只留在 repo 之外，不公開也不上線，在工作區多畫 20 張不會改變任何人的權利狀態。若擁有者認為開始製作也要先簽核，Phase 2 停下來即可，已畫的圖不會進 repo。
