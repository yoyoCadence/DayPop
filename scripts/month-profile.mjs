import assert from 'node:assert/strict';

const milliseconds = (microseconds) => Math.round(microseconds) / 1000;
const rows = (weights) => [...weights].map(([location, weight]) => ({
  location, milliseconds: milliseconds(weight),
})).sort((a, b) => b.milliseconds - a.milliseconds || a.location.localeCompare(b.location));
const add = (weights, key, value) => weights.set(key, (weights.get(key) ?? 0) + value);

function sourceLocation(frame, maps) {
  const entry = maps.get(frame.url)?.findEntry(frame.lineNumber, frame.columnNumber);
  // Publish repo-relative locations only, never an absolute build-machine path.
  const path = entry?.originalSource?.replaceAll('\\', '/').match(/(?:^|\/)((?:src|node_modules)\/.*)$/)?.[1];
  return path ? `${path}:${entry.originalLine + 1}` : null;
}

/**
 * CDP timestamps can arrive out of order. Sort cumulative timestamps with their
 * sample IDs, as DevTools does, then weight the interval to the next sample.
 * Leave the first gap and final tail unassigned rather than estimating them.
 * Inclusive rows overlap; never add them.
 */
export function summarizeCpu(profile, maps) {
  const { nodes, samples, timeDeltas } = profile;
  assert(samples?.length > 0, 'empty CPU profile');
  assert.equal(samples.length, timeDeltas?.length, 'missing sample weights');
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let timestamp = profile.startTime;
  const ordered = samples.map((id, index) => {
    assert(byId.has(id), 'unknown sampled node');
    assert(Number.isFinite(timeDeltas[index]), 'invalid sample weights');
    timestamp += timeDeltas[index];
    assert(timestamp >= profile.startTime && timestamp <= profile.endTime, 'sample outside profile');
    return { id, timestamp };
  }).sort((a, b) => a.timestamp - b.timestamp);
  const parents = new Map(nodes.flatMap((node) => (node.children ?? []).map((id) => [id, node.id])));
  const locations = new Map(nodes.map((node) => [node.id, sourceLocation(node.callFrame, maps)]));
  const self = new Map();
  const inclusive = new Map();
  const nearestSource = new Map();
  const eventTimeCallers = new Map();
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const weight = ordered[index + 1].timestamp - ordered[index].timestamp;
    const leaf = byId.get(ordered[index].id);
    const fallback = leaf.callFrame.url ? `${leaf.callFrame.functionName || '(anonymous)'} (unmapped)`
      : leaf.callFrame.functionName || '(native/unknown)';
    add(self, locations.get(leaf.id) ?? fallback, weight);
    const stack = [];
    const visited = new Set();
    let current = leaf;
    while (current) {
      assert(!visited.has(current.id), 'cyclic CPU stack');
      visited.add(current.id);
      const location = locations.get(current.id);
      if (location) stack.push(location);
      const parent = parents.get(current.id);
      assert(parent === undefined || byId.has(parent), 'unknown parent');
      current = byId.get(parent);
    }
    // One bucket per sample. Native leaves are attributed to their closest
    // mapped JS ancestor, an inference rather than native pipeline accounting.
    add(nearestSource, stack[0] ?? '(unmapped)', weight);
    for (const location of new Set(stack)) add(inclusive, location, weight);
    if (stack[0]?.startsWith('src/domain/eventTime.ts:')) {
      add(eventTimeCallers, stack.find((location) => !location.startsWith('src/domain/eventTime.ts:'))
        ?? '(unmapped caller)', weight);
    }
  }
  return {
    durationMs: milliseconds(profile.endTime - profile.startTime), samples: samples.length,
    sampledMs: milliseconds(ordered.at(-1).timestamp - ordered[0].timestamp),
    unsampledBeforeMs: milliseconds(ordered[0].timestamp - profile.startTime),
    unsampledAfterMs: milliseconds(profile.endTime - ordered.at(-1).timestamp),
    negativeDeltas: timeDeltas.filter((delta) => delta < 0).length,
    self: rows(self), nearestSource: rows(nearestSource), inclusive: rows(inclusive),
    eventTimeCallers: rows(eventTimeCallers),
  };
}

/** Main-renderer complete events only; nested timeline totals are independent. */
export function summarizeTimeline(trace) {
  const main = trace.traceEvents.find((event) => event.name === 'thread_name'
    && event.ph === 'M' && event.args?.name === 'CrRendererMain');
  assert(main, 'missing renderer main thread');
  const names = new Set(['FunctionCall', 'Layout', 'Paint', 'UpdateLayoutTree', 'MinorGC', 'MajorGC']);
  const groups = new Map();
  for (const event of trace.traceEvents) {
    if (event.pid !== main.pid || event.tid !== main.tid || event.ph !== 'X'
      || !names.has(event.name) || !Number.isFinite(event.dur)) continue;
    const group = groups.get(event.name) ?? { count: 0, sum: 0, longest: 0 };
    group.count += 1; group.sum += event.dur; group.longest = Math.max(group.longest, event.dur);
    groups.set(event.name, group);
  }
  return { events: [...groups].map(([name, group]) => ({ name, count: group.count,
    milliseconds: milliseconds(group.sum), longestMs: milliseconds(group.longest),
  })).sort((a, b) => b.milliseconds - a.milliseconds || a.name.localeCompare(b.name)) };
}
