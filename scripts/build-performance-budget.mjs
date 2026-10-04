import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { gzipSync } from 'node:zlib';

/** Sum every emitted chunk, compressing each file separately as a host would. */
export async function measureBuildAssets(files) {
  const totals = {
    javascript: { count: 0, rawBytes: 0, gzipBytes: 0 },
    css: { count: 0, rawBytes: 0, gzipBytes: 0 },
  };
  for (const file of files) {
    const extension = extname(file);
    const kind = extension === '.js' || extension === '.mjs' ? 'javascript'
      : extension === '.css' ? 'css' : null;
    if (kind === null) continue;
    const bytes = await readFile(file);
    totals[kind].count += 1;
    totals[kind].rawBytes += bytes.length;
    totals[kind].gzipBytes += gzipSync(bytes).length;
  }
  return totals;
}

/** Invalid or incomplete configuration must never disable the gate. */
export function checkPerformanceBudget(totals, budget) {
  const problems = [];
  for (const kind of ['javascript', 'css']) {
    for (const [metric, limitKey] of [
      ['rawBytes', 'maxRawBytes'], ['gzipBytes', 'maxGzipBytes'],
    ]) {
      const limit = budget?.[kind]?.[limitKey];
      if (!Number.isSafeInteger(limit) || limit <= 0) {
        problems.push(`performance-budget.json ${kind}.${limitKey} must be a positive safe integer`);
      } else if (totals[kind][metric] > limit) {
        problems.push(`${kind} ${metric} ${totals[kind][metric]} exceeds budget ${limit} bytes`);
      }
    }
  }
  return problems;
}
