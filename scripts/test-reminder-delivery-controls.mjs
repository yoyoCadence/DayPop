// Negative controls for the server core. Never deploy, send push or read keys.
// Mutations run sequentially and always restore the exact source bytes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const source = resolve('src/reminders/delivery.ts');
const saved = readFileSync(source);
const original = saved.toString('utf8');
const controls = [
  { name: 'caller verification', before: "if (difference !== 0) return json({ error: 'unauthorized' }, 401);",
    after: "if (false) return json({ error: 'unauthorized' }, 401);", expected: 'rejects public or wrong caller before creating a privileged client' },
  { name: 'remaining TTL', before: 'ttl: Math.floor(remaining / 1000)', after: 'ttl: 300', expected: 're-reads time after claim' },
  { name: 'retry after tick deadline', before: "result = remaining < 1000 ? 'failed' : 'retry';", after: "result = 'failed';", expected: 'does not deliver when claim exhausts the invocation budget' },
];
for (const control of controls) {
  assert.equal(original.split(control.before).length, 2, 'Mutation target must occur exactly once');
  try {
    writeFileSync(source, original.replace(control.before, control.after));
    const result = spawnSync(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', 'src/reminders/delivery.test.ts'],
      { encoding: 'utf8', windowsHide: true, timeout: 90_000 });
    assert.equal(result.status, 1, 'Disabling a sender guarantee must fail the behavior tests');
    assert.ok((result.stdout + result.stderr).includes(control.expected), 'Control must fail at the intended behavior assertion');
    console.log(`Reminder delivery negative control: removed ${control.name} detected.`);
  } finally {
    writeFileSync(source, saved);
    assert.ok(readFileSync(source).equals(saved), 'Server core restored byte for byte');
  }
}
console.log(`Reminder delivery restored source SHA256: ${createHash('sha256').update(saved).digest('hex')}`);
