import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Generates the standalone status bar probe matrix — DP-080.
 *
 * The defect: opened from the iOS home screen, the status bar's clock, signal
 * and battery are invisible in both light and dark themes, while Safari is
 * fine. It appeared after the deploy that carried DP-074 (the page canvas
 * started following the theme) together with DP-076 and DP-078, and **the
 * causal link has never been tested** — there is only a before/after
 * observation across a three-merge deploy.
 *
 * `docs/mobile-qa-2026-08-22.md` §2.7 names the first step: a controlled
 * comparison that changes the canvas colour and nothing else. It also allows
 * "一個帶診斷輸出的暫時建置" as an alternative to attaching Safari Web
 * Inspector to the device. These probes are that build. Each page is a static
 * reproduction of one first-paint configuration, installable to the home
 * screen on its own, and the pages differ **only** in the properties listed in
 * `PROBES` below — that is the entire point, so keep them generated rather
 * than hand-edited.
 *
 * Deliberately no JavaScript: the pages carry a `script-src 'none'` policy so
 * a publicly reachable diagnostic page cannot do anything at all. Everything
 * the owner needs to read is rendered by CSS, including whether the page
 * actually launched standalone (`@media (display-mode: standalone)`) and how
 * tall `env(safe-area-inset-top)` came out.
 *
 * These files are temporary. Deleting `public/diag/`, this script and its npm
 * script is part of closing DP-080 — the task entry says so.
 *
 * Run: `npm run probes:statusbar`
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(root, 'public/diag/statusbar');

/**
 * The controlled variables. Everything not named here is identical across all
 * six pages, so a difference in behaviour can only come from these.
 *
 * `canvas` is the `html` background colour, i.e. what shows through the iOS
 * safe-area strip. `fg` only has to stay readable on it; it is not part of the
 * experiment. `themeColor: null` means the page declares no theme colour from
 * any source — neither the meta nor the manifest.
 */
/**
 * The shipped `public/manifest.webmanifest` declares these two and never
 * changes them — `ThemeProvider` only rewrites the `theme-color` *meta*. They
 * are copied here as constants rather than derived from each probe so that
 * they stay out of the experiment: A and B must differ in the canvas colour
 * and nothing else, and in the real app the manifest was identical before and
 * after DP-074. Probe D is the one page that withholds both.
 */
const APP_MANIFEST_THEME_COLOR = '#ffffff';
const APP_MANIFEST_BACKGROUND_COLOR = '#ffffff';

const PROBES = [
  {
    slug: 'a-canvas-pre-074',
    letter: 'A',
    round: 1,
    name: 'A 舊畫布',
    canvas: '#f7f3ff',
    fg: '#2e2a3b',
    themeColor: '#ffffff',
    colorScheme: 'light',
    statusBarStyle: null,
    summary: 'DP-074 之前的畫布顏色',
    detail:
      '畫布是 DP-074 之前寫死的 #f7f3ff。這是狀態列還看得見的那個版本。' +
      '除了畫布顏色以外，每一項設定都與 B 相同。',
  },
  {
    slug: 'b-canvas-post-074',
    letter: 'B',
    round: 1,
    name: 'B 新畫布',
    canvas: '#ffffff',
    fg: '#2e2a3b',
    themeColor: '#ffffff',
    colorScheme: 'light',
    statusBarStyle: null,
    summary: 'DP-074 之後的畫布顏色（漫畫淺色）',
    detail:
      '畫布是 DP-074 之後 ThemeProvider 發佈的漫畫淺色 #ffffff。' +
      '與 A 唯一的差別就是這個顏色 —— A、B 兩張就是那個受控對照。',
  },
  {
    slug: 'c-canvas-dark',
    letter: 'C',
    round: 2,
    name: 'C 深色畫布',
    canvas: '#121212',
    fg: '#f2f2f2',
    themeColor: '#121212',
    colorScheme: 'dark',
    statusBarStyle: null,
    summary: '漫畫深色',
    detail:
      '畫布與 theme-color 都是漫畫深色 #121212。症狀在深色主題下也會出現，' +
      '這張確認靜態頁是否重現得了那一半。',
  },
  {
    slug: 'd-no-theme-color',
    letter: 'D',
    round: 2,
    name: 'D 無 theme-color',
    canvas: '#ffffff',
    fg: '#2e2a3b',
    themeColor: null,
    colorScheme: 'light',
    statusBarStyle: null,
    summary: '與 B 相同，但完全不宣告 theme-color',
    detail:
      '與 B 的每一項都一樣，只是 meta 與 manifest 都不給 theme-color。' +
      '如果 B 看不見而 D 看得見，theme-color 就進入嫌疑範圍。',
  },
  {
    slug: 'e-bar-style-default',
    letter: 'E',
    round: 2,
    name: 'E bar=default',
    canvas: '#ffffff',
    fg: '#2e2a3b',
    themeColor: '#ffffff',
    colorScheme: 'light',
    statusBarStyle: 'default',
    summary: '與 B 相同，另外宣告 status-bar-style=default',
    detail:
      '與 B 的每一項都一樣，只是補上 apple-mobile-web-app-status-bar-style=default。' +
      '這是「補一個 meta 就好了嗎」的那個問題 —— 它是待測項，不是結論。',
  },
  {
    slug: 'f-bar-style-black',
    letter: 'F',
    round: 2,
    name: 'F bar=black',
    canvas: '#ffffff',
    fg: '#2e2a3b',
    themeColor: '#ffffff',
    colorScheme: 'light',
    statusBarStyle: 'black',
    summary: '與 B 相同，另外宣告 status-bar-style=black',
    detail:
      '與 B 的每一項都一樣，只是宣告 apple-mobile-web-app-status-bar-style=black。' +
      '同樣不改變版面（black-translucent 才會，所以刻意不放進來 ——' +
      '症狀明確記載版面沒有位移，改版面的候選會換掉待答的問題）。',
  },
];

/**
 * The one policy every page carries. `script-src 'none'` is the important
 * line: these pages are publicly reachable on staging and must stay inert.
 */
const CSP =
  "default-src 'none'; style-src 'self'; img-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'";

const escapeHtml = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

function probeHtml(probe) {
  // Built line by line so an absent meta leaves no blank line behind — an
  // empty line in the head would be a difference between the pages, and the
  // whole value of this matrix is that there are none beyond `PROBES`.
  const head = [
    '<meta charset="UTF-8" />',
    `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
    '<meta name="robots" content="noindex" />',
    probe.themeColor ? `<meta name="theme-color" content="${probe.themeColor}" />` : null,
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="mobile-web-app-capable" content="yes" />',
    probe.statusBarStyle
      ? `<meta name="apple-mobile-web-app-status-bar-style" content="${probe.statusBarStyle}" />`
      : null,
    `<meta name="apple-mobile-web-app-title" content="${escapeHtml(probe.name)}" />`,
    `<link rel="manifest" href="./${probe.slug}.webmanifest" />`,
    '<link rel="apple-touch-icon" sizes="180x180" href="../../icons/apple-touch-icon-180.png" />',
    '<link rel="stylesheet" href="./probe.css" />',
    `<title>DP-080 探針 ${escapeHtml(probe.name)}</title>`,
  ]
    .filter(Boolean)
    .map((line) => `    ${line}`)
    .join('\n');

  const declared = [
    `theme-color：${probe.themeColor ?? '（未宣告）'}`,
    `status-bar-style：${probe.statusBarStyle ?? '（未宣告，與正式 App 相同）'}`,
    `畫布 html background-color：${probe.canvas}`,
    `color-scheme：${probe.colorScheme}`,
  ]
    .map((line) => `        <li>${escapeHtml(line)}</li>`)
    .join('\n');

  return `<!doctype html>
<html lang="zh-Hant" class="probe probe-${probe.slug}">
  <head>
${head}
  </head>
  <body>
    <main class="sheet">
      <p class="letter">${probe.letter}</p>
      <h1>${escapeHtml(probe.name)}</h1>
      <p class="summary">${escapeHtml(probe.summary)}</p>
      <p class="mode-flag">此頁<strong class="mode-word"></strong></p>
      <div class="inset-block">
        <div class="inset-bar"></div>
        <p class="inset-label">上面那一格的高度就是 env(safe-area-inset-top)。高度為 0 代表這台裝置或這個模式沒有給安全區。</p>
      </div>
      <ul class="declared">
${declared}
      </ul>
      <p class="detail">${escapeHtml(probe.detail)}</p>
      <p class="back"><a href="./">回到探針清單</a></p>
    </main>
  </body>
</html>
`;
}

function probeManifest(probe) {
  const manifest = {
    name: `DP-080 ${probe.name}`,
    short_name: probe.name,
    lang: 'zh-TW',
    start_url: `./${probe.slug}.html`,
    scope: './',
    display: 'standalone',
    orientation: 'portrait-primary',
    icons: [
      {
        src: '../../icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '../../icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
  // Probe D withholds the theme colour from *every* source, so the manifest
  // must not quietly hand one back. Every other probe gets the app's own
  // constants — including C, where the real app also leaves the manifest light
  // while the meta goes dark.
  if (probe.themeColor) {
    manifest.theme_color = APP_MANIFEST_THEME_COLOR;
    manifest.background_color = APP_MANIFEST_BACKGROUND_COLOR;
  }
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function probeCss() {
  const perProbe = PROBES.map(
    (probe) => `
html.probe-${probe.slug},
html.probe-${probe.slug} body {
  background-color: ${probe.canvas};
  color: ${probe.fg};
  color-scheme: ${probe.colorScheme};
}`,
  ).join('\n');

  return `/*
 * Generated by scripts/generate-statusbar-probes.mjs — DP-080. Do not edit.
 *
 * Mirrors how the real App paints the top of the screen: the canvas colour is
 * on \`html\`, and the viewport below it uses the same colour with
 * \`padding-top: env(safe-area-inset-top)\`, so the safe-area strip shows the
 * canvas exactly as \`shell.css\` lets it.
 */

* {
  box-sizing: border-box;
}

html {
  min-height: 100%;
}

body {
  margin: 0;
  min-height: 100dvh;
  padding-top: env(safe-area-inset-top);
  padding-right: env(safe-area-inset-right);
  padding-left: env(safe-area-inset-left);
  font-family: system-ui, -apple-system, "Noto Sans TC", sans-serif;
  line-height: 1.6;
  overscroll-behavior: none;
}

.sheet {
  padding: 1.25rem 1.25rem 3rem;
}

.letter {
  margin: 0;
  font-size: 4rem;
  font-weight: 800;
  line-height: 1;
}

h1 {
  margin: 0.25rem 0 0;
  font-size: 1.375rem;
}

.summary {
  margin: 0.25rem 0 1.25rem;
  font-size: 1rem;
}

/* CSS is the only thing allowed to run here, so this is how the page reports
   whether iOS actually launched it as a home screen app. A probe read in
   Safari answers a different question and must not be recorded as a result. */
.mode-flag {
  margin: 0 0 1.25rem;
  padding: 0.5rem 0.75rem;
  border: 2px solid currentColor;
  border-radius: 0.5rem;
  font-size: 0.9375rem;
}

.mode-word::after {
  content: "在瀏覽器分頁裡（不是 standalone，這一次的結果不算數）";
}

@media (display-mode: standalone) {
  .mode-word::after {
    content: "是從主畫面開啟的（standalone）";
  }
}

.inset-block {
  margin: 0 0 1.25rem;
}

.inset-bar {
  height: env(safe-area-inset-top);
  border: 2px dashed currentColor;
  border-radius: 0.25rem;
}

.inset-label,
.detail {
  margin: 0.5rem 0 0;
  font-size: 0.875rem;
}

.declared {
  margin: 0;
  padding-left: 1.25rem;
  font-size: 0.875rem;
}

.detail {
  margin-top: 1.25rem;
}

.back {
  margin-top: 2rem;
  font-size: 0.875rem;
}

a {
  color: inherit;
}

.index-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.index-list li {
  margin: 0 0 0.75rem;
  padding: 0.75rem;
  border: 2px solid currentColor;
  border-radius: 0.5rem;
}

.index-list a {
  font-size: 1.0625rem;
  font-weight: 700;
}

.index-list p {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
}

.round-heading {
  margin: 1.5rem 0 0.5rem;
  font-size: 1rem;
}

ol.protocol {
  margin: 0;
  padding-left: 1.25rem;
  font-size: 0.875rem;
}

html.probe-index,
html.probe-index body {
  background-color: #ffffff;
  color: #2e2a3b;
  color-scheme: light;
}
${perProbe}
`;
}

function indexHtml() {
  const group = (round) =>
    PROBES.filter((probe) => probe.round === round)
      .map(
        (probe) => `        <li>
          <a href="./${probe.slug}.html">${probe.letter} — ${escapeHtml(probe.name)}</a>
          <p>${escapeHtml(probe.summary)}</p>
        </li>`,
      )
      .join('\n');

  return `<!doctype html>
<html lang="zh-Hant" class="probe probe-index">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${CSP}" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex" />
    <link rel="stylesheet" href="./probe.css" />
    <title>DP-080 狀態列探針</title>
  </head>
  <body>
    <main class="sheet">
      <h1>DP-080 狀態列探針</h1>
      <p class="summary">
        每一張都要「加到主畫面」再從主畫面圖示開啟才算數。在 Safari 分頁裡看到的結果不算 ——
        頁面本身會告訴你目前是哪一種。
      </p>

      <h2 class="round-heading">第一輪：因果對照（先做這兩張）</h2>
      <ol class="protocol">
        <li>把 A 與 B 都加到主畫面。</li>
        <li>各自從主畫面圖示開啟，記下狀態列的時間／訊號／電量看不看得見。</li>
        <li>A 看得見、B 看不見 ⇒ 畫布顏色就是成因，而且差別只有 #f7f3ff 與 #ffffff。</li>
        <li>兩張都看得見 ⇒ 靜態頁沒有重現症狀。這不代表沒問題，代表成因不在靜態的畫布顏色，要往 App 執行期做的事去找。</li>
      </ol>
      <ul class="index-list">
${group(1)}
      </ul>

      <h2 class="round-heading">第二輪：縮小機制（第一輪有結果再做）</h2>
      <ul class="index-list">
${group(2)}
      </ul>

      <p class="detail">
        這些頁面是暫時的診斷素材，沒有任何 JavaScript，也不碰帳號或資料。DP-080 結案時整個
        public/diag/ 一併刪除。
      </p>
    </main>
  </body>
</html>
`;
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await Promise.all([
  writeFile(resolve(outputDir, 'index.html'), indexHtml()),
  writeFile(resolve(outputDir, 'probe.css'), probeCss()),
  ...PROBES.flatMap((probe) => [
    writeFile(resolve(outputDir, `${probe.slug}.html`), probeHtml(probe)),
    writeFile(resolve(outputDir, `${probe.slug}.webmanifest`), probeManifest(probe)),
  ]),
]);

const written = (await readdir(outputDir)).length;
console.log(`Generated ${PROBES.length} status bar probes (${written} files) in public/diag/statusbar`);
