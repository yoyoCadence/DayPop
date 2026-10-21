import assert from 'node:assert/strict';
import { SourceMap } from 'node:module';
import test from 'node:test';
import { summarizeCpu, summarizeTimeline } from './month-profile.mjs';

const url = 'http://daypop-benchmark.test/assets/app.js';
// Generated line 0/column 0 -> original line 2/column 0; no bundler needed.
const maps = new Map([[url, new SourceMap({ version: 3, sources: ['../../src/domain/eventTime.ts'],
  names: [], mappings: 'AAEA' })]]);
const frame = (functionName, source = '', lineNumber = -1) => ({
  functionName, url: source, lineNumber, columnNumber: lineNumber < 0 ? -1 : 0,
});
const profile = {
  startTime: 1000, endTime: 12000,
  nodes: [
    { id: 1, callFrame: frame('(root)'), children: [2, 5] },
    { id: 2, callFrame: frame('minified', url, 0), children: [3] },
    // Recursion at the same mapped location must not double-count inclusive time.
    { id: 3, callFrame: frame('minified', url, 0), children: [4] },
    { id: 4, callFrame: frame('formatToParts') },
    { id: 5, callFrame: frame('(idle)') },
  ],
  samples: [4, 2, 5], timeDeltas: [1000, 2000, 7000],
};

test('weights uneven deltas, keeps native self time and deduplicates recursive inclusive frames', () => {
  const result = summarizeCpu(profile, maps);
  assert.equal(result.durationMs, 11);
  assert.equal(result.sampledMs, 9); // Do not fabricate either unsampled edge.
  assert.equal(result.samples, 3);
  assert.deepEqual(result.self, [
    { location: 'src/domain/eventTime.ts:3', milliseconds: 7 },
    { location: 'formatToParts', milliseconds: 2 },
  ]);
  assert.equal(result.inclusive.find((row) => row.location === 'src/domain/eventTime.ts:3').milliseconds, 9);
  assert.deepEqual(result.nearestSource, [
    { location: 'src/domain/eventTime.ts:3', milliseconds: 9 },
  ]);
});

test('does not silently publish missing weights, unknown samples or empty profiles', () => {
  assert.throws(() => summarizeCpu({ ...profile, timeDeltas: [1000] }, maps), /weights/);
  assert.throws(() => summarizeCpu({ ...profile, samples: [99], timeDeltas: [1000] }, maps), /unknown/);
  assert.throws(() => summarizeCpu({ ...profile, samples: [], timeDeltas: [] }, maps), /empty/);
});

test('does not claim an unknown source map as mapped code', () => {
  const result = summarizeCpu(profile, new Map());
  assert.deepEqual(result.nearestSource, [{ location: '(unmapped)', milliseconds: 9 }]);
  assert.equal(result.self.find((row) => row.location === 'minified (unmapped)').milliseconds, 7);
});

test('sorts cumulative timestamps together with samples when CDP deltas arrive out of order', () => {
  const result = summarizeCpu({ ...profile, samples: [2, 4, 5], timeDeltas: [2000, -1000, 5000] }, maps);
  assert.equal(result.negativeDeltas, 1);
  assert.equal(result.sampledMs, 5);
  assert.equal(result.unsampledBeforeMs, 1);
  assert.equal(result.unsampledAfterMs, 5);
  assert.deepEqual(result.self, [
    { location: 'src/domain/eventTime.ts:3', milliseconds: 4 },
    { location: 'formatToParts', milliseconds: 1 },
  ]);
});

test('timeline keeps nested categories separate and excludes another thread and incomplete events', () => {
  const event = (name, ts, dur, tid = 2, ph = 'X') => ({ name, ts, dur, pid: 1, tid, ph });
  const result = summarizeTimeline({ traceEvents: [
    { name: 'thread_name', ph: 'M', pid: 1, tid: 2, args: { name: 'CrRendererMain' } },
    event('FunctionCall', 0, 10000), event('Layout', 2000, 3000), event('Paint', 5000, 1000),
    event('Paint', 0, 90000, 3), event('Layout', 0, 50000, 2, 'B'),
  ] });
  assert.deepEqual(result.events, [
    { name: 'FunctionCall', count: 1, milliseconds: 10, longestMs: 10 },
    { name: 'Layout', count: 1, milliseconds: 3, longestMs: 3 },
    { name: 'Paint', count: 1, milliseconds: 1, longestMs: 1 },
  ]);
  assert.throws(() => summarizeTimeline({ traceEvents: [] }), /renderer/);
});
