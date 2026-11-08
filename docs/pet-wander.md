# 夥伴前景自主走動（DP-240）

> 狀態：2026-11-07 實作完成。只在瀏覽器（Chromium mobile／desktop、jsdom）驗證；iPhone 真機的走動觀感、觸控抓取與 standalone 下的表現**尚未驗收**。

## 契約

一次「出遊」（excursion）＝ 休息 → 走出去 → 坐下 → 走回 → 休息。

| 項目 | 規則 | 位置 |
| --- | --- | --- |
| 誰會走 | 只有 registry 有 `walk` 動作的夥伴（棉花貓、蜂蜜熊、蜜桃兔）。月光貓、軌道噗沒有走路動作，用滑的會像在溜冰，所以不動 | `PetLayer.tsx` 的 `enabled` |
| 何時開始 | 最後一次輸入後 30–60 秒第一次，之後每次間隔 45–90 秒 | `WANDER_FIRST_DELAY_MS`／`WANDER_NEXT_DELAY_MS` |
| 最多幾次 | 沒有輸入時最多 2 次，然後停在原地，直到下一次輸入。所以安靜的畫面仍會照 DP-193 在 120 秒後睡著，也不會無止盡踱步 | `WANDER_MAX_PER_QUIET` |
| 走多遠、多快 | 沿自己那一列水平走 40–140px，36px/s，每段 1.2–5 秒；坐 5 秒 | `petWander.ts` |
| 能走到哪 | 路徑每 4px 取樣，每一點都必須是 `constrainPet()` 原樣接受的合法停留點：不進標頭、分頁列、safe area、FAB 與它的 8px 間距。偏好方向放不下就縮短，再不行換邊，兩邊都不行就跳過這一次 | `wanderPathClear()`／`planWanderOffset()` |
| 什麼時候不走 | 拖移、鍵盤移動、泡泡開著、look／jump 動作中、暫藏（表單聚焦、viewport 遮住、modal）、收起、背景分頁、減少動態效果 | `PetLayer.tsx`／`usePetWander.ts` 的 `active` |
| 被打斷 | 任何地方的 `pointerdown`／`keydown`／`wheel`（document capture）立即結束出遊，回到保存位置，沒有過場，並重新開始安靜計時 | `usePetWander.ts` |
| 保存位置 | **永遠不寫。** 出遊只是疊在 `placePet()` 結果上的暫時水平位移；只有使用者自己的拖移／鍵盤移動會寫 `daypop.pet-placement` | — |

### 中途抓起

壓在正在走或坐著的夥伴身上時，夥伴**停在畫面上它所在的位置**（包括 CSS 過場進行到一半的位置），拖移從那裡接著走，放開時保存在手指放開的地方。單純點一下（沒有拖）則回到保存位置並照常打開泡泡，不寫任何東西。

這需要一個時序上的細節：真實瀏覽器在每個 event listener 之間會跑 microtask，所以 React 的 `onPointerDown` 執行時，出遊重設已經 re-render，夥伴已經被畫回家。唯一還看得到「夥伴畫在哪」的時機是重設本身的 document capture listener。所以 `usePetWander` 的 `onInput` 在排程重設之前同步呼叫，`PetLayer` 在那裡用 `getComputedStyle(...).transform` 讀出當下位置並 hold 住。

> 不能改成 hold 在該段的目標點：目標點的 transform 字串與出遊時相同，Chromium 會讓進行中的過場繼續跑完，夥伴在手指下滑走。e2e 的「靜止 400ms 後位置不變」就是抓這個。

## 驗證（2026-11-07，main `1774cc8` + DP-239 的 e2e 修正 + 本變更）

- **單元／元件**：1,843 單元（106 檔）＋41 Node；`src/screens/calendar` 在實際 `Etc/GMT-8` 下 342 項。
  - `petWander.test.ts` 7 項：距離範圍、換邊、FAB 與 8px 間距、內容邊界與標頭、空間不足回傳 null、單段時長上下限、延遲範圍。
  - `usePetWander.test.tsx` 9 項：完整一輪、最多兩次、三種輸入各自打斷、停用時不留一個 frame 的舊位移、保存位置改變時重來、減少動態、背景。
  - `PetPlacement.test.tsx` 新增 4 項：自己走完一輪且不寫 storage、中途拖移從所在處接著走並保存在放開處、中途點一下回家開泡泡且不保存、沒有走路動作的夥伴 10 分鐘不動。
- **負控制**（都先失敗，再逐 byte 還原後通過）：hook 拿掉 reduce／background 條件、兩次上限、`active` 回傳閘、input listener、cleanup 重設，各自被對應測試抓到；PetLayer 拿掉 hold、drag 改回從保存點起算、每款都走、放開不釋放 hold，各自被元件測試抓到。
- **Chromium e2e**（`e2e/pet-wander.spec.ts`，mobile／desktop 4 passed，實際 `Asia/Taipei`，console 0）：真正選棉花貓、走出去、坐下（走路與坐下圖片都實際解碼）、坐著時抓起拖移、下一次中途按鍵立即回家、中途按住停在當下位置且 400ms 不動、點一下開泡泡；月光貓不動、減少動態不動、恢復動態後同一款會走。在真實瀏覽器裡把 hold 拿掉，或改成 hold 在目標點，這份 e2e 都會失敗。寵物相關 7 份 spec 共 40 passed／2 skipped（既有桌面略過）。
- **預算**：JS＋worker 804,070 raw／**238,124 gzip**（上限 240,640，比 DP-239 多 1,105 bytes，剩 2,516）。擁有者同意可以調高上限，但這次不需要，所以沒有調；下一個放不下的功能應該重新決定，而不是先把上限放寬。

### 測試上要知道的一件事

`page.clock` 只假造 JavaScript 的時間，CSS 過場跑真實時間。快轉時鐘會讓「坐下」的計時器在過場只走了幾 px 時就觸發，所以 e2e 先讀出該段的毫秒數、真的等完，再快轉計時器。正式環境兩者都是真實時間，`setTimeout` 只會晚不會早，所以坐下時一定已經走到。

## 設定頁說明

設定「夥伴」卡片原本寫著「還沒有的功能：在角落走動」，「關於」的清單也還列著「為桌寵選擇其他夥伴」（DP-239 加了選擇卻沒移除）。兩條都改掉：說明改成哪三款會走、碰一下就回來、減少動態效果時不走；「還沒有」只剩行程建議、AI 助理、等級與成長、逐筆提醒覆寫。`SettingsPreferences.test.tsx` 的「設定 說明不與已有的功能矛盾」釘住這件事，換回舊文案時失敗。

## 沒做與剩下的風險

- iPhone 真機（觸控抓取、standalone、低電量節流下的過場）未驗。
- 夥伴只沿水平走，沒有垂直移動。DP-238 的 walk 是面向使用者的原地踏步（看過 `renders/bear/walk-02.png`、`renders/bunny/walk-05.png`），不是側面，所以往左往右都不會像倒著走，沒有加鏡像；平移時的觀感是「側步」，是否夠自然仍待擁有者目視判斷。
- 出遊與泡泡尾巴：泡泡位置固定（DP-170），出遊時不會開泡泡，所以沒有尾巴錯位的情況。
- 新夥伴的造型與走路品質仍待擁有者目視驗收。
