/* global document, requestAnimationFrame, innerWidth, innerHeight, localStorage */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { SourceMap } from 'node:module';
import { chromium } from 'playwright';
import { build } from 'vite';
import { summarizeCpu, summarizeTimeline } from './month-profile.mjs';

// Manual measurement, deliberately outside CI timing gates. Never reads a real
// account, starts a network server, or changes the product's buffer strategy.
const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--(steps|runs|output|strategy|profile)=(.+)$/.exec(arg);
  if (!match) throw Error(`Unknown argument: ${arg}`);
  return [match[1], match[2]];
}));
const steps = Number(options.steps ?? 12);
const runs = Number(options.runs ?? 2);
const strategy = options.strategy ?? 'bounded';
const profiling = options.profile === 'mobile-last';
assert(!options.profile || profiling, 'profile must be mobile-last');
assert(['growth', 'bounded'].includes(strategy), 'strategy must be growth or bounded');
assert(Number.isInteger(steps) && steps >= 1 && steps <= 24, 'steps must be 1–24');
assert(Number.isInteger(runs) && runs >= 1 && runs <= 3, 'runs must be 1–3');
assert(!profiling || (strategy === 'bounded' && steps === 12), 'profile requires bounded / 12 steps');
const output = resolve(options.output ?? join(tmpdir(), 'daypop-month-scroll.json'));
await mkdir(dirname(output), { recursive: true });
const directory = await mkdtemp(join(tmpdir(), 'daypop-month-scroll-'));
// Keep raw profiles/maps outside the repo and outside the disposable build.
const profileDirectory = profiling ? await mkdtemp(join(tmpdir(), 'daypop-month-profile-')) : null;
let browser;
let browserVersion;
const files = new Map();
const samples = [];
const profiles = [];
const sourceMaps = new Map();
const profileAssets = [];
const origin = 'http://daypop-benchmark.test';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };

async function readTree(path, prefix = '') {
  for (const item of await readdir(path, { withFileTypes: true })) {
    if (item.isDirectory()) await readTree(join(path, item.name), `${prefix}/${item.name}`);
    else files.set(`${prefix}/${item.name}`, await readFile(join(path, item.name)));
  }
}

async function snapshot(page, cdp, label, scrollMs = null) {
  const dom = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.cal-cell')];
    return {
      rows: document.querySelectorAll('.cal-week-row').length,
      cells: cells.length,
      elements: document.querySelectorAll('*').length,
      chips: document.querySelectorAll('.cal-cell-event').length,
      startDate: cells[0]?.getAttribute('data-date-key'),
      endDate: cells.at(-1)?.getAttribute('data-date-key'),
      tabStops: cells.filter((cell) => cell.tabIndex === 0).length,
    };
  });
  assert.equal(dom.cells, dom.rows * 7, 'incomplete month DOM');
  assert.equal(dom.tabStops, 1, 'roving tabindex changed');
  assert(dom.startDate && dom.endDate, 'missing date window');
  // GC belongs to the memory sample, outside the scroll latency interval.
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  const counters = await cdp.send('Memory.getDOMCounters');
  return { label, ...dom, scrollMs, jsHeapBytesAfterGc: heap.usedSize, cdpNodes: counters.nodes };
}

async function finishProfile(cdp, run) {
  const { profile } = await cdp.send('Profiler.stop');
  const complete = new Promise((accept) => cdp.once('Tracing.tracingComplete', accept));
  await cdp.send('Tracing.end');
  const { stream } = await complete;
  const chunks = [];
  try {
    while (true) {
      const part = await cdp.send('IO.read', { handle: stream });
      chunks.push(Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8'));
      if (part.eof) break;
    }
  } finally { await cdp.send('IO.close', { handle: stream }); }
  const traceBytes = Buffer.concat(chunks);
  const cpuBytes = Buffer.from(JSON.stringify(profile));
  const artifacts = [];
  for (const [name, bytes] of [[`run-${run}.cpuprofile`, cpuBytes], [`run-${run}.trace.json`, traceBytes]]) {
    await writeFile(join(profileDirectory, name), bytes);
    artifacts.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return { artifacts, cpu: summarizeCpu(profile, sourceMaps),
    timeline: summarizeTimeline(JSON.parse(traceBytes.toString('utf8'))) };
}

try {
  process.env.VITE_SUPABASE_URL = '';
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = '';
  // Compile the actual canonical functions for independent Node timings.
  const fixtureBuild = await build({ configFile: false, logLevel: 'error', build: {
    write: false, minify: false, lib: { entry: resolve('e2e/fixtures/monthScroll.ts'), formats: ['es'] },
  } });
  const fixtureOutputs = Array.isArray(fixtureBuild) ? fixtureBuild : [fixtureBuild];
  const fixtureCode = fixtureOutputs.flatMap((result) => result.output)
    .find((item) => item.type === 'chunk' && item.isEntry).code;
  const fixturePath = join(directory, 'fixture.mjs');
  await writeFile(fixturePath, fixtureCode);
  const { monthScrollData, measureExpansion, measurementInstant } = await import(pathToFileURL(fixturePath).href);
  const appDirectory = join(directory, 'app');
  await build({ logLevel: 'error', base: '/', define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(''),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(''),
  }, build: { outDir: appDirectory, emptyOutDir: false, sourcemap: profiling ? 'hidden' : false } });
  await readTree(appDirectory);
  if (profiling) {
    for (const [path, bytes] of files) if (path.endsWith('.js.map')) {
      sourceMaps.set(`${origin}${path.slice(0, -4)}`, new SourceMap(JSON.parse(bytes.toString('utf8'))));
      const target = join(profileDirectory, path.slice(1));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      profileAssets.push({ name: path.slice(1), bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    assert(sourceMaps.size > 0, 'missing external source maps');
    console.log(`Raw profile directory: ${profileDirectory}`);
  }
  browser = await chromium.launch();
  browserVersion = browser.version();
  const nodeTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(JSON.stringify({ nodeTimezone, browserVersion, steps, runs, strategy, profiling }));
  const environments = [];
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    for (const seriesCount of [0, 20]) {
      for (let run = 1; run <= runs; run += 1) {
        const context = await browser.newContext({ viewport, locale: 'zh-TW', timezoneId: 'Asia/Taipei',
          isMobile: viewport.width === 390, hasTouch: viewport.width === 390, reducedMotion: 'reduce' });
        try {
          const data = monthScrollData(seriesCount);
          const page = await context.newPage();
          const problems = [];
          page.on('pageerror', (error) => problems.push(error.message));
          page.on('console', (message) => {
            if (['error', 'warning'].includes(message.type())) problems.push(message.text());
          });
          await context.route('**/*', async (route) => {
            const url = new URL(route.request().url());
            assert.equal(url.origin, origin, 'unexpected external request');
            const path = url.pathname === '/' ? '/index.html' : url.pathname;
            const body = files.get(path);
            assert(body, `missing build asset ${path}`);
            await route.fulfill({ body, contentType: mime[extname(path)] ?? 'application/octet-stream' });
          });
          // Freeze only calendar time. Keep native performance.now, timers and
          // requestAnimationFrame for latency measurements.
          await page.addInitScript((instant) => {
            const OriginalDate = Date;
            globalThis.Date = new Proxy(OriginalDate, {
              construct: (target, args) => Reflect.construct(target, args.length ? args : [instant]),
              apply: () => new OriginalDate(instant).toString(),
              get: (target, property) => property === 'now'
                ? () => target.parse(instant)
                : Reflect.get(target, property),
            });
          }, measurementInstant);
          await page.addInitScript(({ data, measurementInstant }) => {
            localStorage.setItem('daypop.release-notes-seen', '9999.0.0');
            localStorage.setItem('daypop.user-data', JSON.stringify({
              schemaVersion: 4, revision: 1, updatedAt: measurementInstant, data,
            }));
          }, { data, measurementInstant });
          await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
          await page.locator('.cal-week-row').first().waitFor();
          const environment = await page.evaluate(() => ({
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            viewport: { width: innerWidth, height: innerHeight },
            nativePerformance: performance.now.toString().includes('[native code]'),
            nativeRaf: requestAnimationFrame.toString().includes('[native code]'),
          }));
          assert.equal(environment.timezone, 'Asia/Taipei');
          assert.deepEqual(environment.viewport, viewport);
          assert(environment.nativePerformance && environment.nativeRaf, 'timing APIs must remain native');
          environments.push(environment);
          console.log(JSON.stringify({ environment, seriesCount, run }));
          const cdp = await context.newCDPSession(page);
          const points = [await snapshot(page, cdp, 'initial')];
          assert.equal(points[0].rows, 53, 'initial buffer differs from baseline');
          if (seriesCount) assert(points[0].chips > 0, 'synthetic events did not render');
          for (let step = 1; step <= steps; step += 1) {
            const before = { rows: await page.locator('.cal-week-row').count(),
              startDate: await page.locator('.cal-cell').first().getAttribute('data-date-key') };
            const capture = profiling && viewport.width === 390 && seriesCount === 20 && step === steps;
            if (capture) {
              await cdp.send('Profiler.enable');
              await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
              await cdp.send('Profiler.start');
              await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8,blink.user_timing',
                transferMode: 'ReturnAsStream' });
            }
            const elapsed = await page.evaluate(async ({ before, strategy }) => {
              const element = document.querySelector('.cal-month-scroll');
              const start = performance.now();
              element.scrollTop = element.scrollHeight - element.clientHeight;
              await new Promise((accept, reject) => {
                // This is a validity guard, not a performance budget. Allow
                // slow stress samples to finish instead of censoring them.
                const deadline = setTimeout(() => reject(Error('buffer did not advance')), 120_000);
                function frame() {
                  const advanced = strategy === 'growth'
                    ? document.querySelectorAll('.cal-week-row').length > before.rows
                    : document.querySelector('.cal-cell')?.getAttribute('data-date-key') !== before.startDate;
                  if (advanced) {
                    requestAnimationFrame(() => { clearTimeout(deadline); accept(); });
                  } else requestAnimationFrame(frame);
                }
                requestAnimationFrame(frame);
              });
              return performance.now() - start;
            }, { before, strategy });
            const captured = capture ? await finishProfile(cdp, run) : null;
            const count = await page.locator('.cal-week-row').count();
            if (strategy === 'growth') {
              assert.equal(count, before.rows + 12, 'sample must represent one growth step');
            } else {
              assert.equal(count, 53, 'bounded window must retain exactly 53 rows');
              const start = await page.locator('.cal-cell').first().getAttribute('data-date-key');
              assert.equal((Date.parse(`${start}T00:00:00Z`) - Date.parse(`${before.startDate}T00:00:00Z`)) / 86_400_000,
                84, 'bounded sample must advance exactly 12 weeks');
            }
            if (step === Math.ceil(steps / 2) || step === steps) {
              points.push(await snapshot(page, cdp, `${strategy === 'bounded' ? 'shift' : 'growth'}-${step}`, elapsed));
            }
            if (captured) profiles.push({ viewport, seriesCount, run, step, before,
              after: points.at(-1), ...captured });
          }
          assert.deepEqual(problems, [], 'browser must stay clean');
          samples.push({ viewport, seriesCount, run, points });
          console.log(JSON.stringify({ viewport, seriesCount, run, points }));
        } finally { await context.close(); }
      }
    }
  }
  // Browser work is done before Node timings, avoiding competing workloads.
  await browser.close(); browser = null;
  const expansion = [];
  const windows = new Map(samples.flatMap((sample) => sample.points.map((point) => [
    `${point.startDate}/${point.endDate}`, { startDate: point.startDate, endDate: point.endDate },
  ])));
  for (const seriesCount of [0, 20]) for (const window of windows.values()) {
    const data = monthScrollData(seriesCount);
    const count = measureExpansion(data, window.startDate, window.endDate); // warm-up
    const days = (Date.parse(`${window.endDate}T00:00:00Z`) - Date.parse(`${window.startDate}T00:00:00Z`)) / 86_400_000 + 1;
    assert.equal(count, days * seriesCount, 'expansion lost synthetic daily occurrences');
    const milliseconds = [];
    for (let repeat = 0; repeat < 3; repeat += 1) {
      const start = performance.now();
      assert.equal(measureExpansion(data, window.startDate, window.endDate), count);
      milliseconds.push(performance.now() - start);
    }
    expansion.push({ seriesCount, ...window, count, milliseconds });
  }
  const sourceSha256 = Object.fromEntries(await Promise.all([
    'src/screens/calendar/MonthView.tsx', 'src/screens/calendar/monthWindow.ts',
    'src/screens/calendar/CalendarScreen.tsx', 'src/screens/calendar/calendar.css',
    'src/domain/calendars.ts', 'src/domain/recurrence.ts', 'src/domain/eventTime.ts',
    'src/domain/displaySegments.ts', 'e2e/fixtures/monthScroll.ts',
    'scripts/measure-month-scroll.mjs', 'scripts/month-profile.mjs',
  ].map(async (path) => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
  if (profiling) assert.equal(profiles.length, runs, 'missing mobile profiles');
  await writeFile(output, JSON.stringify({ baseline: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    strategy, sourceSha256,
    measuredAt: new Date().toISOString(), measurementInstant,
    node: process.version, nodeTimezone, platform: platform(), release: release(), cpu: cpus()[0]?.model,
    logicalCpus: cpus().length, memoryBytes: totalmem(), browser: `Chromium ${browserVersion}`,
    steps, runs, environments, samples, expansion,
    ...(profiling ? { profiling: { mode: options.profile, samplingIntervalUs: 1000,
      rawDirectoryName: basename(profileDirectory), assets: profileAssets, profiles } } : {}),
  }, null, 2));
  console.log(`Measurement written to ${output}`);
} finally {
  if (browser) await browser.close();
  // Only remove the exact mkdtemp directory under the OS temp root.
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert(basename(directory).startsWith('daypop-month-scroll-'));
  await rm(directory, { recursive: true, force: true });
}
