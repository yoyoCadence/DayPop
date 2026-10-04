import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { checkPerformanceBudget, measureBuildAssets } from './build-performance-budget.mjs';

const totals = {
  javascript: { count: 3, rawBytes: 800, gzipBytes: 300 },
  css: { count: 1, rawBytes: 200, gzipBytes: 100 },
};
const budget = {
  javascript: { maxRawBytes: 800, maxGzipBytes: 300 },
  css: { maxRawBytes: 200, maxGzipBytes: 100 },
};

test('aggregate all JS/MJS/CSS chunks, including the worker, in bytes rather than characters', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'daypop-budget-'));
  try {
    await mkdir(join(directory, 'assets'));
    const fixtures = [
      ['assets/main.js', 'const title = "日蹦";'],
      ['assets/lazy.mjs', 'export const lazy = true;'],
      ['sw.js', 'self.addEventListener("install", () => {});'],
      ['assets/main.css', '.title { color: red; }'],
      ['assets/theme.css', '.title { background: white; }'],
      ['assets/main.js.map', 'not a shipped script'],
      ['assets/font.woff2', 'not part of the JS/CSS budget'],
    ];
    for (const [file, text] of fixtures) await writeFile(join(directory, file), text);
    const actual = await measureBuildAssets(fixtures.map(([file]) => join(directory, file)));
    const sum = (indexes, metric) => indexes.reduce((total, index) => {
      const bytes = Buffer.from(fixtures[index][1]);
      return total + (metric === 'raw' ? bytes.length : gzipSync(bytes).length);
    }, 0);
    assert.deepEqual(actual, {
      javascript: { count: 3, rawBytes: sum([0, 1, 2], 'raw'), gzipBytes: sum([0, 1, 2], 'gzip') },
      css: { count: 2, rawBytes: sum([3, 4], 'raw'), gzipBytes: sum([3, 4], 'gzip') },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the exact byte boundary passes', () => {
  assert.deepEqual(checkPerformanceBudget(totals, budget), []);
});

for (const [kind, limitKey, metric] of [
  ['javascript', 'maxRawBytes', 'rawBytes'],
  ['javascript', 'maxGzipBytes', 'gzipBytes'],
  ['css', 'maxRawBytes', 'rawBytes'],
  ['css', 'maxGzipBytes', 'gzipBytes'],
]) {
  test(`${kind} ${metric} exceeds independently, even while the other limits pass`, () => {
    const limits = structuredClone(budget);
    limits[kind][limitKey] -= 1;
    assert.deepEqual(checkPerformanceBudget(totals, limits), [
      `${kind} ${metric} ${totals[kind][metric]} exceeds budget ${limits[kind][limitKey]} bytes`,
    ]);
  });
}

test('missing, null, non-numeric and non-positive limits fail closed', () => {
  assert.equal(checkPerformanceBudget(totals, null).length, 4);
  for (const value of [undefined, null, '800', 0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const limits = structuredClone(budget);
    limits.javascript.maxRawBytes = value;
    assert.deepEqual(checkPerformanceBudget(totals, limits), [
      'performance-budget.json javascript.maxRawBytes must be a positive safe integer',
    ]);
  }
});
