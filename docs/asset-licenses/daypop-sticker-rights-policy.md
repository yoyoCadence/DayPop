# DayPop 圖檔貼圖：權利／使用許可政策（DP-244 / DP-246）

> 決策記錄日：2026-11-15。**本頁定義將來發表的 DayPop 自訂貼圖所採用的下游使用條件；不是宣布 24 張圖已獲核准。** `manifest.csv` 的 24 張圖仍為 `review-pending`，正式放行須看擁有者逐檔簽核。

## 明確決策

**DayPop 自製圖檔貼圖採保留權利（All Rights Reserved），不授與第三方一般再利用授權。** 在法律認可存在權利的範圍內，權利人保留對這些圖檔的複製、再散布、修改、重新包裝及商業使用等權利；不採用 CC0、CC BY、MIT 或 Apache 作為這批圖檔的對外授權。

這裡的「All Rights Reserved」**不是保證 AI 輸出在每個法域必然有著作權或排他性**。OpenAI／Anthropic 的使用條款安排僅處理服務提供者與使用者之間的權利，未保證作品可受著作權保護或不侵犯第三方權利。無權主張的素材部分不能藉這份聲明變成專有權利。

## 與公開 GitHub、App 的關係

- `yoyoCadence/DayPop` 是 **public repository**，根目錄查無 `LICENSE`／`LICENSE.md`；這並不代表程式碼已採用開源授權。一般預設著作權規則仍適用，GitHub 平台對瀏覽／fork 等的必要權限另由其平台條款規範。參考：https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository
- **本決策只針對 DayPop 自訂貼圖**，不將整個程式碼庫一併重新授權，也不撤銷第三方套件、字型、圖示或其他素材已存在的授權。
- 圖檔在 App 中被合法下載、顯示及瀏覽器快取，不等於授與使用者將素材抽出重新散布、再出售或整合進其他產品的額外許可；法律上強制允許的用途仍然適用。
- App 可顯示「DayPop 原創風格貼圖，AI 協助製作；未經授權不得重製或再散布（法律允許者除外）」等精簡告示。這是使用規則聲明，不應宣稱「100% 人工手繪」「保證獨創」。
- 若未來決定對整個程式碼庫開放 MIT／Apache／GPL，必須**另外**做授權決策，並在該開源授權的範圍明確排除這批美術素材；不可擅自用 root `LICENSE` 一口氣授權所有內容。
- 第三方來源權利優先依各來源合法條款處理，本政策不得覆蓋第三方授權要求。

## 上線／公開 repo 的 gate

1. 逐檔來源記錄，AI 工具、日期、prompt（只需可公開摘要）、修改記錄、授權查證證據完整。
2. 逐檔確認 fallback／SVG 安全／大小／一致性／與第三方圖檔及 Apple emoji 的相似性。
3. 最終實際 SVG 的 bytes 與 SHA-256 必須符合 `asset-hashes.json`；不同就重新審查，不得沿用舊簽核。
4. **專案擁有者明確批准具體檔案與 SHA-256** 後，Agent 才能依審核流程更改 `review-pending`；不能把此政策文件當作一鍵全數放行。
5. 是否把已核准素材提交 public repo、正式接入 App 或部署，仍按既有 DP-244/247 發布權限辦理；文件審核不等於部署授權。

## 署名／公開簡短聲明（未發布前僅供預備）

> DayPop custom stickers: AI-assisted original-style artwork. No general reuse license is granted. All rights reserved to the extent rights exist under applicable law. Third-party assets remain under their own licenses.

此段不是額外的「OpenAI／Anthropic 授權條款」，也不能替代逐圖權利查證。
