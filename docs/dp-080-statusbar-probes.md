# DP-080 狀態列探針：受控對照的操作手冊

> 建立於 2026-08-25。對象是拿著 iPhone 的專案擁有者。
> 症狀本身記在 [`mobile-qa-2026-08-22.md`](mobile-qa-2026-08-22.md) §2.7，這一份只講怎麼測。

## 0. 這一份存在的理由

DP-080 的症狀是：從主畫面圖示開啟（standalone）時，iOS 狀態列的時間／訊號／電量看不見；Safari 裡正常；淺色與深色主題都會；版面沒有位移。

目前只有**時序關聯**：DP-074 之前的 standalone 截圖看得見狀態列，之後看不見。但那次部署一口氣帶進 DP-074、DP-076、DP-078 三個合併，而且**從來沒有做過 revert 或 before／after 的對照**。§2.7 因此把第一步定為「只回退畫布顏色重新建置，看狀態列是否恢復」，並允許用「一個帶診斷輸出的暫時建置」代替接 Safari Web Inspector。

這些探針就是那個暫時建置。**它們不是修正，也不主張任何成因**；它們只是把「只改畫布顏色」這件事做成可以直接加到主畫面的樣子。

## 1. 探針是什麼

六張靜態頁，放在 [`public/diag/statusbar/`](../public/diag/statusbar/)，由 [`scripts/generate-statusbar-probes.mjs`](../scripts/generate-statusbar-probes.mjs) 產生（`npm run probes:statusbar`）。**產生而不是手寫，是因為受控對照的價值全在「除了指定的那一項以外每一位元都相同」**；手改六張 HTML 遲早會漂掉。

每張頁面：

- 各有自己的 `.webmanifest`（`display: standalone`）與 `apple-mobile-web-app-capable`，可以各自加到主畫面、各自是一個圖示。
- **版面結構照抄正式 App 的 `shell.css`**：畫布顏色只在 `html` 上，`body` 維持透明，`.dp-viewport` 疊上主題底色並帶 `padding-top: env(safe-area-inset-top)`。探針要有意義，前提就是它畫螢幕頂端的方式與 App 一致；若哪天 `shell.css` 改了而這裡沒跟上，探針的結果就不再能說明 App 的事。
- `manifest` 的 `theme_color` 與 `background_color` 一律沿用正式 App 的常數 `#ffffff`。正式 App 的 manifest 在 DP-074 前後沒有變過，所以它不該進入實驗。**探針 D 只少掉 `theme_color`**，`background_color` 照留 —— 兩個一起拿掉的話，D 就與 B 差了兩件事，結果無法單獨歸因。
- 完全沒有 JavaScript，並帶 `script-src 'none'` 的 CSP。這些頁在 staging 上是公開可達的，必須是惰性的。
- 用 CSS 自己報告兩件事：**目前是不是 standalone**（`@media (display-mode: standalone)`；在 Safari 分頁裡看到的結果不算數），以及 **`env(safe-area-inset-top)` 有多高**（頁面上那個虛線框的高度就是）。

| | 畫布 `html` 底色 | App viewport 底色 | `theme-color` | `status-bar-style` | 這張在問什麼 |
| --- | --- | --- | --- | --- | --- |
| **A** 舊畫布 | `#f7f3ff` | `#ffffff` | `#ffffff` | 未宣告 | DP-074 之前 |
| **B** 新畫布 | `#ffffff` | `#ffffff` | `#ffffff` | 未宣告 | DP-074 之後（與 A 只差畫布這一個顏色） |
| **C** 深色畫布 | `#121212` | `#121212` | `#121212` | 未宣告 | 深色那一半重不重現 |
| **D** 無 theme-color | `#ffffff` | `#ffffff` | **完全不給** | 未宣告 | theme-color 有沒有份 |
| **E** bar=default | `#ffffff` | `#ffffff` | `#ffffff` | `default` | 補 meta 有沒有用 |
| **F** bar=black | `#ffffff` | `#ffffff` | `#ffffff` | `black` | 同上，另一個值 |

**A 的兩欄不同色是刻意的**，不是筆誤：DP-074 之前的正式 App 就是 `#f7f3ff` 畫布配 `#ffffff` viewport，那個落差正是專案擁有者當初看到的淡紫色帶。把 A 的兩欄一起改成 `#f7f3ff`，反而會讓「之前」那張沒有色帶。

E、F 是**待測項，不是結論**。§2.7 明講「不要直接加一個 meta 就宣稱修好」——它們放在這裡是為了讓那個假設可以被否證，不是為了直接採用。刻意沒有放 `black-translucent`：它會讓內容頂到狀態列底下，而症狀明確記載版面沒有位移，改版面的候選會換掉待答的問題。

## 2. 操作步驟

前提：staging 已經部署到含這個分支的 `main`。網址是 <https://yoyocadence.github.io/DayPop/diag/statusbar/>。**要連著網路**——App 的 service worker 在離線時會把導覽退回 `index.html`，那樣會開到 App 而不是探針。

### 第一輪：因果對照（只有這兩張是必要的）

1. 用 Safari 開探針清單，點進 **A**，分享 →「加入主畫面」。
2. 回清單，點進 **B**，同樣加入主畫面。
3. 分別**從主畫面圖示**開啟 A 與 B。頁面上方應該顯示「是從主畫面開啟的（standalone）」；如果顯示的是「在瀏覽器分頁裡」，這次不算數，重開。
4. 各記一次：狀態列的時間／訊號／電量**看得見還是看不見**。淺色與深色系統外觀各做一次（A、B 兩張的顏色是寫死的，不會跟著系統跑，但 iOS 的判斷可能會）。

判讀：

- **A 看得見、B 看不見** ⇒ 畫布顏色就是成因，而且差別只有 `#f7f3ff` 與 `#ffffff`。這同時回答了 §2.7 裡「兩個都是接近白的淺色，這點差距憑什麼」的疑問——答案會是「不是憑亮度」。接著做第二輪縮小機制。
- **兩張都看得見** ⇒ **靜態頁沒有重現症狀**。這**不代表沒問題**，代表成因不在靜態的畫布顏色，要往 App 執行期做的事去找：`ThemeProvider` 在掛載後改寫 `theme-color` meta 與 `color-scheme`、service worker、或 DP-076／DP-078 那兩個合併。這種結果一樣要記回 §2.7。
- **兩張都看不見** ⇒ 症狀與畫布顏色無關，DP-074 洗清嫌疑。直接做第二輪。

### 第二輪：縮小機制（第一輪有結果再做）

同樣的加入主畫面流程，跑 C、D、E、F，各記一次。重點比較：

- **C vs B**：深色是不是同一件事。
- **D vs B**：完全不給 `theme-color` 之後有沒有變 → 它是否有份。
- **E、F vs B**：宣告 `status-bar-style` 會不會改變結果。**就算 E 或 F 看得見，那也只是「這個值蓋掉了症狀」，不等於知道了成因**；要不要採用是另一個決定。

## 3. 記錄方式

把六格結果（看得見／看不見／沒重現）連同 iOS 版本寫回 [`mobile-qa-2026-08-22.md`](mobile-qa-2026-08-22.md) §2.7，再更新 `tasks.md` 的 DP-080。**沒有量到的事不要寫成量到的**——這是 DP-080 一開始就被要求的態度。

## 4. 已經驗過與沒驗過的

**已驗（Chromium 390×844，production build，`vite preview`，每一頁一個全新 context）**：六張探針＋清單頁 HTTP 200、`html` 的計算底色與表格一致、**`body` 維持透明**、`.dp-preview`／`.dp-viewport` 的底色是該探針的 App viewport 顏色、`probe.css` 確實套用（CSP 沒擋掉）、`theme-color` 與 `status-bar-style` 兩個 meta 與表格一致、每張都宣告了 `rel=icon` 且該檔真的取得得到、`.webmanifest` 可取得且 `display`／`start_url`／`background_color`／`theme_color` 正確、`.inset-bar` 在 inset 為 0 時量到 0px、水平溢出 0、沒有任何 4xx 或失敗請求、console error／warning 與 page error 皆為 0。另外會回頭讀正式 App 的 `body` 與 viewport 計算值，確認探針抄的那組前提還成立。反向測試（把 `body` 塗色、拿掉 D 的 `background_color`、把 `.inset-bar` 換回 `border`、刪掉 `rel=icon`）會紅九項，所以這個檢查不是空的。`npm run check:build` 通過，六張探針沒有帶進任何遠端資源。

**沒驗，也不宣稱**：

- **iOS 上會發生什麼，一項都沒有。** 這裡只有 Chromium。
- **`@media (display-mode: standalone)` 那一段沒有被實際觸發過。** Chromium 在這台機器上無法被切到 standalone：Playwright 沒有這個 API，`Emulation.setEmulatedMedia` 不吃這個 feature（導覽前後都試過），`--app=` 開的視窗 Playwright 也拿不到。驗到的是**那條規則存在、可解析、文字正確**，不是它會在 iOS 上生效。
- **這些探針會不會重現症狀本身，未知。** 靜態頁少了 App 執行期做的事（`ThemeProvider` 改寫 meta、service worker、React 掛載）。第一輪「兩張都看得見」是一個有意義的結果，不是測試失敗。
- **`/favicon.ico` 的 404 沒有在這裡被重現過。** 複審在真實 Chrome session 觀察到它；Playwright 的 Chromium **完全不會**去要 favicon —— headless 與 headed、有無 `rel=icon` 四種組合都試過，一次請求都沒發出。所以修法（每張都宣告 `rel=icon`）驗到的是「連結存在，而且它指的檔案真的取得得到」，不是「那個 404 已被觀察到消失」。

## 5. 清理

這些是暫時素材。DP-080 結案時一併刪除 `public/diag/`、`scripts/generate-statusbar-probes.mjs` 與 `package.json` 的 `probes:statusbar`。這一條也寫在 `tasks.md` 的 DP-080 條目裡。
