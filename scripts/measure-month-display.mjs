import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, platform, release, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { build, normalizePath } from 'vite';

// Synthetic, synchronous grouping only. No browser/server/account or timing CI gate.
const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--(baseline|output)=(.+)$/.exec(arg);
  assert(match, `Unknown argument: ${arg}`);
  return [match[1], match[2]];
}));
assert(/^[0-9a-f]{7,40}$/.test(options.baseline ?? ''), 'provide the approved baseline commit');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const baselineCommit = git('rev-parse', options.baseline);
const sources = ['src/domain/eventTime.ts', 'src/domain/displaySegments.ts', 'src/screens/calendar/MonthView.tsx'];
const baselineSources = new Map(sources.map((path) => [normalizePath(resolve(path)),
  execFileSync('git', ['show', `${baselineCommit}:${path}`], { encoding: 'utf8' })]));
const directory = await mkdtemp(join(tmpdir(), 'daypop-month-display-'));
const output = resolve(options.output ?? join(tmpdir(), 'daypop-month-display.json'));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const snapshot = (map) => JSON.stringify([...map]);

async function compile(variant) {
  const loadedBaseline = new Set();
  const entry = join(directory, `${variant}-entry.ts`);
  const view = normalizePath(resolve('src/screens/calendar/MonthView.tsx'));
  const fixture = normalizePath(resolve('e2e/fixtures/monthScroll.ts'));
  const calendars = normalizePath(resolve('src/domain/calendars.ts'));
  await writeFile(entry, `import { monthScrollData } from ${JSON.stringify(fixture)};
    import { visibleOccurrences } from ${JSON.stringify(calendars)};
    import { groupEventsByDate } from ${JSON.stringify(view)};
    export { monthScrollData, visibleOccurrences, groupEventsByDate };`);
  const result = await build({ configFile: false, logLevel: 'error', plugins: [{
    name: 'daypop-measure-private-grouping', enforce: 'pre',
    load(id) {
      if (variant === 'baseline' && baselineSources.has(id)) {
        loadedBaseline.add(id);
        return baselineSources.get(id);
      }
    },
    transform(code, id) {
      // Export the actual private function only in this disposable measurement
      // build. Do not copy its algorithm or change the product's exports.
      if (id === view) return { code: `${code}\nexport { groupEventsByDate };`, map: null };
    },
  }], build: { write: false, minify: false, lib: { entry, formats: ['es'] } } });
  if (variant === 'baseline') assert.deepEqual(loadedBaseline, new Set(baselineSources.keys()),
    'baseline source override incomplete');
  const builds = Array.isArray(result) ? result : [result];
  const code = builds.flatMap((item) => item.output).find((item) => item.type === 'chunk' && item.isEntry).code;
  const path = join(directory, `${variant}.mjs`);
  await writeFile(path, code);
  return import(pathToFileURL(path).href);
}

try {
  const baseline = await compile('baseline');
  const candidate = await compile('candidate');
  const windows = [
    ['2026-04-19', '2027-04-24'], ['2027-09-05', '2028-09-09'], ['2029-01-21', '2030-01-26'],
  ];
  const samples = [];
  for (const [startDate, endDate] of windows) {
    const variants = [baseline, candidate].map((module) => {
      const data = module.monthScrollData(20);
      const occurrences = module.visibleOccurrences(data, { startDate, endDate }, data.preferences.timezone);
      assert.equal(occurrences.length, 7420, 'incomplete occurrence fixture');
      return { module, occurrences, input: JSON.stringify(occurrences), group: () => module.groupEventsByDate(
        occurrences, data.preferences.timezone, { startDateKey: startDate, endDateKey: endDate },
      ) };
    });
    assert.equal(variants[0].input, variants[1].input, 'different resolved input');
    const results = variants.map(({ group }) => {
      const map = group(); // Warm-up is outside timing/counter intervals.
      assert.equal(map.size, 371, 'missing display days');
      assert.equal([...map.values()].reduce((sum, rows) => sum + rows.length, 0), 7420, 'missing display entries');
      return snapshot(map);
    });
    assert.equal(results[0], results[1], 'grouping output differs');
    const conversions = variants.map(({ group }) => {
      const native = Intl.DateTimeFormat.prototype.formatToParts;
      let count = 0;
      Intl.DateTimeFormat.prototype.formatToParts = function (...args) {
        count += 1; return Reflect.apply(native, this, args);
      };
      try { assert.equal(snapshot(group()), results[0]); }
      finally { Intl.DateTimeFormat.prototype.formatToParts = native; }
      return count;
    });
    const milliseconds = [[], []];
    for (let repeat = 0; repeat < 4; repeat += 1) {
      // Alternate order within the same process; no conversion spy while timed.
      for (const index of repeat % 2 ? [1, 0] : [0, 1]) {
        const start = performance.now();
        const map = variants[index].group();
        milliseconds[index].push(performance.now() - start);
        assert.equal(snapshot(map), results[0]);
        assert.equal(JSON.stringify(variants[index].occurrences), variants[index].input, 'input mutated');
      }
    }
    samples.push({ startDate, endDate, occurrences: 7420, days: 371,
      inputSha256: digest(variants[0].input), outputSha256: digest(results[0]),
      baseline: { conversions: conversions[0], milliseconds: milliseconds[0] },
      candidate: { conversions: conversions[1], milliseconds: milliseconds[1] } });
  }
  const sourceSha256 = Object.fromEntries(await Promise.all([...sources, 'e2e/fixtures/monthScroll.ts',
    'scripts/measure-month-display.mjs'].map(async (path) => [path, digest(await readFile(path))])));
  const report = { measuredAt: new Date().toISOString(), baselineCommit, candidateParent: git('rev-parse', 'HEAD'),
    node: process.version, nodeTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: platform(), release: release(), cpu: cpus()[0]?.model, sourceSha256, samples };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert(basename(directory).startsWith('daypop-month-display-'));
  await rm(directory, { recursive: true, force: true });
}
