# DP-244 — OpenAI 生成圖像權利／條款查證紀錄（2026-11-14）

> **查證日：2026-11-14（Asia/Taipei）**；來源為 OpenAI 官網公開英文頁面。這是人工整理的中文離線查證摘要，**不是 OpenAI 的授權證書、法律意見或官網整頁逐字備份**。正式接進 App 前仍需逐張審查素材並重新核對當時的有效條款。

## 官方來源與版本日期

| 來源 | 官方原文連結 | 官網標示日期 | 2026-11-14 的判定 |
| --- | --- | --- | --- |
| Terms of Use | https://openai.com/policies/terms-of-use/ | Published / Effective: **2026-01-01** | 個人 ChatGPT 等服務目前適用的一般條款（地區／方案可能另有適用版本） |
| Service terms | https://openai.com/policies/service-terms/ | Updated: **2026-11-13** | 目前的服務附加條款 |
| Usage policies（舊版） | https://openai.com/policies/usage-policies/revisions/2025-10-29/ | Effective: **2025-10-29** | **查證當日仍有效** |
| Usage policies（新版） | https://openai.com/policies/usage-policies/ | Effective: **2026-11-20** | **查證當日尚未生效**，不可當作目前規則 |
| Sharing & publication policy | https://openai.com/policies/sharing-publication-policy/ | Updated: **2022-11-14** | 官網仍提供的分享／發表政策 |

### 實際涉及的條款與 DayPop 解釋

1. **Terms of Use → Content → Ownership of content**：在使用者與 OpenAI 兩者之間，OpenAI 依適用法律允許的範圍，將自己在輸出中擁有的權利（若有）轉讓給使用者。這支持使用者將 ChatGPT 生成圖像納入商業產品的評估，但**不證明對第三方不侵權，也不保證輸出具著作權法上的原創性**。
2. **Terms of Use → Similarity of content**：AI 輸出不一定獨一無二，權利安排不涵蓋其他使用者的輸出或第三方內容。**不得以此宣稱貼圖享有必然的獨占性**。
3. **Terms of Use → Using our Services / Content**：不可侵犯第三方權利，也不得將 AI 產生的內容假稱為純人工製作。公開前須由人員審視輸出是否適用。
4. **Service terms → §6 Image and Video Capabilities**：圖像／影片相關限制包括未經授權使用真人肖像等。此節**不是對所有圖像輸出的無條件免責或保證**。
5. **Sharing & publication policy**：公開發表時需有人類審查、適當歸屬及清楚交代 AI 參與。DayPop 可以在來源文件、必要的授權／關於頁面正確披露「ChatGPT AI-assisted artwork」，不應假稱純手繪。
6. **Usage policies 的日期差異**：2026-11-14 需參照 2025-10-29 修訂版。若正式上線發生在 2026-11-20 或之後，務必重新核對屆時已生效的新規則。

## DP-244 的實務結論

**可進入商用／公開 GitHub 素材的審查流程，但不等於所有貼圖已獲法律放行**。需注意：

- 「使用者與 OpenAI 之間的輸出權利」≠「CC0／MIT／公眾領域」；公開 repo 是否讓別人重製、改作貼圖，仍由 DayPop 的素材授權聲明決定。
- 每張貼圖需附生成日期、工具名稱（ChatGPT 圖像生成）、prompt 的可公開摘要、修改歷史、最終檔案 SHA-256、以及人工風格與第三方智慧財產權審查結果；不應把私人聊天全文直接推到 public repo。
- 對於可能包含其他來源改作、AI SVG 向量重製、外來圖示的作品，應分別追溯來源及授權，不能用 OpenAI 條款替代第三方授權。
- 不應標記為「owner-original / human-drawn」而不揭露 AI 參與；可另行設計正確的來源標籤。
- 已存檔的英文 URL 與版本日期為本次查證所見；**尚未取得官網完整 HTML／PDF 原始 bytes、也沒有官網 HTML SHA-256**，不得冒充已保存官方原件。

## Agent 行動清單

- [x] 已依官方來源查證上述條款、保存 2026-11-14 查閱日期。
- [x] 已區分 2026-11-14 仍有效的舊版 Usage policies 和 2026-11-20 才生效的新版。
- [ ] 逐張完成 prompt／修改／素材 hash／權利狀態／近似性檢查。
- [ ] 清楚分開公開程式碼授權與貼圖圖像的下游使用條件。
- [ ] 正式發布前重新核對當天生效的條款；必要時取得法務意見。
- [ ] 若需**完整官網網頁存證**，由能連線者在官方網頁以「列印 → 儲存為 PDF」另存，記錄日期與 PDF SHA-256。此摘要不能假裝是完整官方條款全文。

此文件僅補足 DP-244 「Agent 的環境無法連線 openai.com」的查證紀錄缺口，不解除貼圖產品及發布驗收的其他關卡。
