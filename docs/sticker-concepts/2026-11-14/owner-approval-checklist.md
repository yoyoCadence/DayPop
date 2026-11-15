# DP-244 / DP-246｜24 張圖檔的發布前簽核清單

> 編製日期：2026-11-15。以下 **檔名、位元組數、SHA-256 均轉錄自 GitHub `docs/sticker-concepts/2026-11-14/asset-hashes.json`**，並與該目錄 `manifest.csv` 的 24 個 ID 對齊。**本次未取得最後版本的 24 張 SVG 位元組，故尚未獨立重算 hash。** 本表是簽核用「期望值」，不是現在已核准或已重新驗證的證明。

| 最終候選檔案 | 記錄 bytes | 預期 SHA-256 | 實檔逐一比對與簽核 |
| --- | ---: | --- | --- |
| `happy.svg` | 1005 | `6e6ea33a546cab41acc1ae9c7f874b4354907743abbbb4dafd1e25db11ad883f` | ☐ |
| `gift.svg` | 926 | `75c8baca07cf0862315c84caafbed7b625373ee44d9ea9c3ee101291d17d5707` | ☐ |
| `cake.svg` | 1193 | `76c8e72022ca95d2e1635d705119597c7cf69ad712235ba6ff2065ba67161dd8` | ☐ |
| `hiking.svg` | 686 | `e7c26921e7b220d78b25fc2842288dfc55233e693647302d9e650aad1a56440a` | ☐ |
| `star.svg` | 533 | `2b8dc1a8e19b42f11539cde7e56813906335a7c6fa2879d3dd84d1db0fc66849` | ☐ |
| `alert.svg` | 649 | `1f9a23187ee82f110c759a6cc48b3415d36467ad80be2ad740e2ad886216ebbe` | ☐ |
| `done.svg` | 574 | `4aab54854cfceb7135213b48517452245ae8a1d7b95f73406ccb700b37ca3e47` | ☐ |
| `heart.svg` | 657 | `42f62e78be15c1ec419b4622ecef6e37b7ce632c0dda273053c2d5a0efc469ab` | ☐ |
| `sad.svg` | 1068 | `af45174e4b0a7011d3b687fba4e636b81c510457e86abe972bae2009a6567720` | ☐ |
| `birthday.svg` | 1098 | `7c01ae39594afc5abac639b00a9d94593c4d9d6c3a9d558d4bc955153b6afeb7` | ☐ |
| `party.svg` | 1197 | `bd379d8a670113e5a88e91236c98ee32b56057323eb37c66d137c3189fb9353d` | ☐ |
| `briefcase.svg` | 869 | `95d8e473a374c9633b24e3d410e240dcb96638ab79690a66ea63699639ca394f` | ☐ |
| `memo.svg` | 1253 | `68daf5481753b381202ed37da3e769490c5174ae9be84c86efce8e3effd90d6e` | ☐ |
| `money.svg` | 977 | `a6fdcfaf8d8e43528856ab94ba8da787c7ab8c47b0d3da177d3a577cbd387933` | ☐ |
| `card.svg` | 651 | `a19cd76c9fe8c1ef80b000bc81fecf8afcc5e3b6f9cfbc89143dca9e86f2f704` | ☐ |
| `pill.svg` | 661 | `a7ce19bcd4dedb33db08e6d5c77ce3a1ecc5d891408f58a8d5cefe3ed3622083` | ☐ |
| `tooth.svg` | 919 | `63ddaade949049670572dad17d63cb66f6f2f7eee4ebc36010bf5ddd62052a72` | ☐ |
| `plane.svg` | 1067 | `bf50c6321f63493a8ad5e0cef92bdd3f6f66543cf673d60358f487b96cce04f0` | ☐ |
| `coffee.svg` | 1013 | `3bb3d524032eab74c6be8b0a9f802508e277f0a6b1cf8b5dc374a874d0511355` | ☐ |
| `home.svg` | 889 | `90f85b04d03b7d259f1362c41ad4ceb3d02f3c421c7dfae4caddc93f6ef143da` | ☐ |
| `cart.svg` | 1315 | `2e057264c13ae49e309e8ef40992d2710f29f7601edb4c4b8cd7ece1d2cbb24a` | ☐ |
| `music.svg` | 1050 | `cd8115c1c8d18e6ad02cfe30cc90cf9bab3ecde6229be5ef1f3e0c388c034960` | ☐ |
| `sunny.svg` | 993 | `4b49f3f687adeb4b83132f8254ab0368546125408bb0b2e033d04041a3e46325` | ☐ |
| `rainy.svg` | 1155 | `e8a91a3291b58f2a0df469ac5e73a824db20a809c6ba095fb755c72655923432` | ☐ |

### 簽核流程（Agent 不得代簽）

- [ ] 先對**擁有者保管的最終 24 張 SVG** 跑 `python3 -I docs/sticker-concepts/2026-11-14/check_stickers.py --assets <DIR>`，確認 24 份皆與 manifest／hash 比對相同。若任何一張不同，回到設計／來源／權利審核，不得直接覆蓋 `asset-hashes.json`。
- [ ] ChatGPT 的 gift／cake 製作摘要：`gift-cake-prompt-summary.md`；OpenAI 條款：`docs/asset-licenses/openai-terms-evidence-2026-11-14.md`。
- [ ] Anthropic 的 22 張來源與條款：`rights-review.md`；逐張實圖相似性（含 Apple）由專案擁有者確認。若 Apple 比對未做完，就不得全數通過。
- [ ] 確認 `docs/asset-licenses/daypop-sticker-rights-policy.md` 中的下游權利保留政策符合意圖；不得假裝 repo 已有可對外再利用的開源授權。
- [ ] 逐張由擁有者核對後在表格最後欄寫「已驗證／通過」、日期與簽核者；可逐張簽，不必一次 24 張全過。
- [ ] 另行批准是否可將通過者放進 public repo，及之後 Phase 3 的程式整合與 deployment。

**擁有者簽核欄（刻意保留空白）**

- 簽核人／帳號：
- 簽核日期（含時區）：
- 簽核範圍（列出確定核准的檔名；若 24 張全數，請明確寫「上表 24 張全部」）：
- 確認權利政策（All Rights Reserved，不授予第三方一般再利用授權）：是／否
- Apple emoji 人工相似性比對：通過／未通過；證據位置：
- 原始 24 張最終版本保存位置（不得存公開私人路徑／密鑰）：
- 對 SHA-256 全部核對結果：
- 明確同意上傳核准 SVG 至 public repo：是／否
- Phase 3 程式整合授權：是／否
- 正式部署授權：是／否

> **未填不等於同意。** 本文件的存在、GitHub PR 合併或 CI 通過都不構成擁有者的放行簽核。若尚缺 Apple 比對或實檔雜湊核對，`manifest.csv` 的 `license` 必須維持 `review-pending`。
