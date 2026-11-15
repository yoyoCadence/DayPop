# DP-244／246｜素材權利審核表（2026-11-14，11-15 補充）

> **結論：Phase 1 四張與 Phase 2 二十張都沒有發現阻擋問題，但這不是法律查核，也不是授權核准。** 2026-11-15 補上 OpenAI 條款查證紀錄（§3）與四套開放 emoji 圖集的量化＋目視比對（§4.2），兩者都沒有發現阻擋問題；剩下的事項見 §7。 二十四張的 `license` 全部維持 `review-pending`。能把它改成專案授權格式（例如 `owner-original`）的只有專案擁有者的簽核（§5），agent 不會自行更改。
>
> 依擁有者決策 6，這些 SVG 在核准前**不提交到 repo**（公開 repo 一提交就看得到）。repo 只保存本表、manifest、SHA-256 與檢查結果；SVG 檔另交給擁有者保管，用 `asset-hashes.json` 比對是不是同一份。

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
| 相似性（§4、§4.2） | 未發現問題 | 未發現問題 | 未發現問題（量測標記，目視為通用畫法） | 未發現問題 |
| `license` | `review-pending` | `review-pending` | `review-pending` | `review-pending` |

這四個 hash 與 [`asset-hashes.json`](asset-hashes.json)、[`check-results.json`](check-results.json)、[`measure-results.json`](measure-results.json) 一致。`check_stickers.py --assets` 會拒絕任何 hash 不同的檔案，所以審核過的就是之後要用的那一份。

「人工修改」這一欄沒有任何人手繪或手改。四張都是 AI 服務寫出的 SVG 程式，加上 agent 的程式化修改；擁有者做的是選擇方向和驗收，不是繪製。紀錄裡不能寫成人工手繪。

### 1.1 Phase 2 二十張（DP-246）

二十張都由 Claude Code（Anthropic）在 2026-11-14 直接寫出 SVG 形狀與路徑，沿用 Phase 1 的白色外框、墨線 `#261C22` 與色票；沒有參考圖、沒有描圖、沒有用圖像生成，也沒有沿用任何第三方 emoji／SVG 套件。部分檔案之後只經 [`normalize_svg.py`](normalize_svg.py) 等比縮放置中到長邊約 92%，形狀與色彩不變。沒有任何人手繪或手改。清單是人工的產品優先假設（App 不收集使用頻率）。

| id | fallback | bytes | SHA-256 |
|---|---|---|---|
| `star` | ⭐ | 533 | `2b8dc1a8e19b42f11539cde7e56813906335a7c6fa2879d3dd84d1db0fc66849` |
| `alert` | ❗ | 649 | `1f9a23187ee82f110c759a6cc48b3415d36467ad80be2ad740e2ad886216ebbe` |
| `done` | ✅ | 574 | `4aab54854cfceb7135213b48517452245ae8a1d7b95f73406ccb700b37ca3e47` |
| `heart` | ❤️ | 657 | `42f62e78be15c1ec419b4622ecef6e37b7ce632c0dda273053c2d5a0efc469ab` |
| `sad` | 😢 | 1,068 | `af45174e4b0a7011d3b687fba4e636b81c510457e86abe972bae2009a6567720` |
| `birthday` | 🎂 | 1,098 | `7c01ae39594afc5abac639b00a9d94593c4d9d6c3a9d558d4bc955153b6afeb7` |
| `party` | 🎉 | 1,197 | `bd379d8a670113e5a88e91236c98ee32b56057323eb37c66d137c3189fb9353d` |
| `briefcase` | 💼 | 869 | `95d8e473a374c9633b24e3d410e240dcb96638ab79690a66ea63699639ca394f` |
| `memo` | 📝 | 1,253 | `68daf5481753b381202ed37da3e769490c5174ae9be84c86efce8e3effd90d6e` |
| `money` | 💰 | 977 | `a6fdcfaf8d8e43528856ab94ba8da787c7ab8c47b0d3da177d3a577cbd387933` |
| `card` | 💳 | 651 | `a19cd76c9fe8c1ef80b000bc81fecf8afcc5e3b6f9cfbc89143dca9e86f2f704` |
| `pill` | 💊 | 661 | `a7ce19bcd4dedb33db08e6d5c77ce3a1ecc5d891408f58a8d5cefe3ed3622083` |
| `tooth` | 🦷 | 919 | `63ddaade949049670572dad17d63cb66f6f2f7eee4ebc36010bf5ddd62052a72` |
| `plane` | ✈️ | 1,067 | `bf50c6321f63493a8ad5e0cef92bdd3f6f66543cf673d60358f487b96cce04f0` |
| `coffee` | ☕ | 1,013 | `3bb3d524032eab74c6be8b0a9f802508e277f0a6b1cf8b5dc374a874d0511355` |
| `home` | 🏠 | 889 | `90f85b04d03b7d259f1362c41ad4ceb3d02f3c421c7dfae4caddc93f6ef143da` |
| `cart` | 🛒 | 1,315 | `2e057264c13ae49e309e8ef40992d2710f29f7601edb4c4b8cd7ece1d2cbb24a` |
| `music` | 🎵 | 1,050 | `cd8115c1c8d18e6ad02cfe30cc90cf9bab3ecde6229be5ef1f3e0c388c034960` |
| `sunny` | ☀️ | 993 | `4b49f3f687adeb4b83132f8254ab0368546125408bb0b2e033d04041a3e46325` |
| `rainy` | 🌧️ | 1,155 | `e8a91a3291b58f2a0df469ac5e73a824db20a809c6ba095fb755c72655923432` |

## 2. Anthropic 條款（happy、hiking 與 Phase 2 二十張）

2026-11-14 讀取，兩頁都只看到生效日期，沒有另外的「最後更新」日期。

| 條款 | 生效日期 | 關於輸出的原文（節錄） |
|---|---|---|
| [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) | Effective Oct 8, 2025 | §4：「Subject to your compliance with our Terms, we assign to you all of our right, title, and interest—if any—in Outputs.」§11 以「AS IS」提供，並明確排除 NON-INFRINGEMENT 在內的保證 |
| [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) | Effective Jun 17, 2025 | §B：「Anthropic agrees that Customer (a) retains all rights to its Inputs, and (b) owns its Outputs.」以及「Anthropic hereby assigns to Customer its right, title and interest (if any) in and to Outputs.」§L.2 排除 NON-INFRINGEMENT 在內的默示保證 |

**擁有者 2026-11-14 確認使用的是 Claude Pro（個人方案），因此適用 Consumer Terms**；Commercial Terms 留作對照。兩份的共同點：

- Anthropic 把它在輸出上的權利轉給使用者，但兩份都寫了「if any」，**沒有保證輸出一定有著作權**。
- 兩份都**不保證輸出不侵權**。
- 兩頁都沒有找到「輸出可能與其他人的輸出相同或相似」這類句子。

## 3. OpenAI 條款（gift、cake）

**這個工作環境連不到 openai.com**，原文由另一個可連線的 agent 在 2026-11-14 查證，紀錄是 [`docs/asset-licenses/openai-terms-evidence-2026-11-14.md`](../../asset-licenses/openai-terms-evidence-2026-11-14.md)（PR #247，2026-11-15 合併）。擁有者 2026-11-15 指示以這份作為 DP-244 的條款查證紀錄，不需要再由擁有者手動查閱。

那份紀錄的重點，與 §2 的 Anthropic 條款結構相同：

- Terms of Use（Published／Effective 2026-01-01）：OpenAI 把它在輸出上的權利（若有）轉給使用者；**不證明不侵權、不保證原創性**；輸出不一定獨一無二，不能宣稱獨占；不得把 AI 產出說成純人工製作。
- Service Terms（Updated 2026-11-13）§6 圖像功能的限制，不是對圖像輸出的保證。
- Sharing & publication policy：公開時要有人類審查、清楚交代 AI 參與。
- Usage policies：2026-11-14 適用 2025-10-29 版；**2026-11-20 起新版生效，若在那之後才接進 App 上線，要重新核對**。

**界線**（照那份紀錄）：那是人工整理的中文摘要，不是官網原件全文，也沒有官網 HTML／PDF 的 SHA-256。gift、cake 的 ChatGPT 方案與模型版本、可公開的 prompt 摘要，接手包都沒有記錄（§7）。

## 4. 相似性檢查

agent 在 2026-11-14 檢查了四張的結構，並以實寸預覽目視：

- **四張都沒有文字、標誌、商標或品牌元素。**
- **happy**：圓臉、棕色頭髮與瀏海、閉眼的彎線、張開的嘴與腮紅。這是 emoji 與兒童插畫常見的通用表情，沒有可辨識的角色特徵（沒有特定髮型輪廓、配件、服裝或標誌性配色）。
- **gift**：方盒、十字緞帶、上方蝴蝶結，是禮物圖示的通用畫法。
- **cake**：三角切片、夾層、上方草莓與奶油，是蛋糕切片的通用畫法。
- **hiking**：兩座三角山峰、雪頂、右上方的太陽，是山景圖示的通用畫法。

agent 沒有逐張比對 Apple、Google Noto、Microsoft Fluent、Twemoji、OpenMoji 的實際圖檔，**這一步要擁有者目視確認**：把實寸預覽與這幾套 emoji 的 😊🎁🍰⛰️ 並排看，看有沒有「看起來就是同一張」的情況。四張都是通用題材，相似度主要來自題材本身，不構成抄襲；要擋的是構圖、配色、比例都一樣的那種。happy 是人物，最需要看。

### 4.1 Phase 2 二十張

二十張都是通用題材的常見畫法：五角星、驚嘆號、打勾方框、愛心、與 happy 同一個角色的難過臉（眉毛、圓點眼、下彎嘴、藍色淚滴）、插蠟燭的整個蛋糕、拉炮與彩帶、公事包、便條紙與鉛筆、寫著 `$` 的錢袋、信用卡、膠囊、亮晶晶的牙齒、飛機俯視、馬克杯、房子、購物車、兩個連在一起的八分音符、太陽、雨雲。除了錢袋上以路徑畫出的 `$` 符號，沒有任何文字、標誌或商標。擁有者 2026-11-14 用手機看過二十四張的實寸預覽並答覆可以，那是**可讀性**驗收；與既有 emoji 圖集並排的相似性目視仍算在擁有者簽核的範圍內。

### 4.2 與四套開放 emoji 圖集的量化＋目視比對（2026-11-15）

§4 的「agent 沒有逐張比對實際圖檔」由本節補上。方法與程式在 [`similarity/`](similarity/)，分數在 [`similarity/similarity-results.json`](similarity/similarity-results.json)；比對用的第三方圖檔與我們的 SVG 都**不進 repo**，三支程式都會拒絕把圖寫進 repo。

- **比對對象**：二十四張各自 fallback emoji 在 Twemoji（@twemoji/svg 15.0.0，CC BY 4.0）、OpenMoji（17.0.0，CC BY-SA 4.0）、Noto（emoji-datasource-google 16.0.0，Apache 2.0）、Fluent（@lobehub/fluent-emoji-flat 1.1.0，MIT）的設計，共 96 張。以 `npm pack` 下載，不執行任何安裝程式。**Apple 的 emoji 不是開放授權，沒有下載**：擁有者的比對頁把裝置自己的 emoji 放在同一列，iPhone 上看到的就是 Apple 的設計。
- **量測**：各圖裁到可見範圍、置中縮成 64px，算輪廓重疊（IoU）、亮度 SSIM、dHash 距離、色彩重疊，取平均為 0–1 的分數。**基準**是同一個 emoji 的四套獨立設計兩兩比較：兩個不相干的設計師畫同一題材會有多像。
- **結果**：二十四張與任何一套的最高分都低於全部同題基準的第 95 百分位（0.727）；最高的是 pill 0.674（OpenMoji）、gift 0.649（OpenMoji）。不同題材的對照中位數是 0.363。
- **標記與目視**：七張（cake、cart、home、money、party、pill、rainy）的最高分略高於該 emoji 四套設計彼此之間的最高分（差 0.013–0.056），依規則逐張目視。七張都是明顯不同的畫法：構圖、細節數量與配色都不同，相近來自題材本身（三角切片、膠囊兩色斜放、雲加雨滴）與 OpenMoji 同樣使用粗黑描邊的畫風。其餘十七張也全部目視過；最接近的是信用卡（藍色卡身、黑色磁條、黃色晶片，與 OpenMoji 配色相近），那是信用卡的標準元素，我們的版本是三個矩形以程式畫成。happy、sad 是有頭髮的人物，與各套的黃色笑臉差異最大（色彩重疊 0.10／0.20）。
- **限制**：這些量測對簡單形狀很粗糙，高分不代表抄襲、低分也不保證沒問題；這不是法律查核。Apple 的比對與最終判斷仍屬擁有者（§5、§7）。

**目前判斷：二十四張沒有發現抄襲或近似特定作品的跡象。**

## 5. 擁有者簽核需要的證據

依擁有者決策 5，`review-pending` 改成專案授權格式前要有：

| 證據 | 狀態 |
|---|---|
| 服務名稱、日期、製作流程、修改紀錄、原檔 SHA-256 | **已完成**（§1、§1.1） |
| Anthropic 條款頁與讀取日期 | **已完成**（§2）；擁有者確認為 Pro，適用 Consumer Terms |
| OpenAI 條款頁與讀取日期 | **查證紀錄已完成**（§3，PR #247）；不是官網原件全文。只影響 gift、cake |
| 第三方相似性風險，經人工核對 | **agent 已完成四套開放圖集的量化＋目視比對**（§4.2）；Apple 與最終判斷待擁有者用比對頁目視 |
| 擁有者明確簽核：誰、何時、批准哪幾個檔案、對應哪個 SHA-256 | **待擁有者** |

簽核前：manifest 維持 `review-pending`、SVG 不進 repo、App 不接這些貼圖（Phase 3／DP-247 不開始）。

## 6. Phase 2 的 license gate 怎麼解讀

擁有者決策 7 寫的是「Phase 1 四張達 16px／10px 深淺背景與真實月格 QA、掃描、安全、license gate 後，可開始**製作**補充 20 張」。決策 5 則要求授權欄位在「QA 與權利查核通過後」才能更新。

這裡把兩個 gate 分開：

- **開始製作 Phase 2 的 license gate**：本表完成，而且沒有發現阻擋問題（服務條款沒有禁止商業使用、沒有發現抄襲或商標）。**現在已滿足。**
- **把任何一張改成已核准、進 repo、接 App 的 gate**：§5 的擁有者簽核。**現在未滿足。**

這樣解讀的理由：Phase 2 的新圖一樣只留在 repo 之外，不公開也不上線，在工作區多畫 20 張不會改變任何人的權利狀態。若擁有者認為開始製作也要先簽核，Phase 2 停下來即可，已畫的圖不會進 repo。

## 7. 還沒完成、需要擁有者的事（2026-11-15）

| 事項 | 影響 | 說明 |
|---|---|---|
| gift、cake 的 ChatGPT 方案／模型與可公開的 prompt 摘要 | gift、cake | OpenAI 查證紀錄要求逐張附上；接手包沒有記錄。只能由擁有者從自己的 ChatGPT 紀錄補，不需要貼私人對話全文。補不到時，可以改由 Claude Code 重畫這兩張（決策 1 保留了它們，重畫要擁有者同意）。 |
| 用比對頁看 Apple emoji 並做最終相似性判斷 | 二十四張 | 比對頁私下交給擁有者，不進 repo。 |
| 貼圖圖像的下游使用條件 | 二十四張 | repo 沒有 LICENSE 檔，`package.json` 也沒有 license 欄位；OWNER-DECISIONS 第 6 項寫的「保留原有開源授權」在 repo 裡找不到對應檔案。圖檔進公開 repo 前要決定：程式碼與貼圖各自用什麼條件，或貼圖只限本 App 使用。 |
| 擁有者明確簽核（誰、何時、哪些檔、哪個 SHA-256） | 二十四張 | §5。簽核前 `review-pending` 不變、SVG 不進 repo、Phase 3 不開始。 |
| 2026-11-20 之後才上線時，重新核對 OpenAI Usage policies | gift、cake | §3。 |
