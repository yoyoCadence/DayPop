// Behavioral controls for the actual pinned Deno/library/native fetch path.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const source = resolve('supabase/functions/reminder-sender/runtime.ts');
const saved = readFileSync(source), original = saved.toString('utf8');
assert.ok(process.env.npm_execpath, 'Run this through its npm script');
const controls = [
  { name: 'configuration key binding', before: ' || configuration.data.publicKey !== vapid.publicKey', after: '',
    file: 'runtime.test.ts', expected: 'disabled/mismatched DB key stays unavailable', network: false },
  { name: 'anonymous encrypted payload', before: 'JSON.stringify({ v: 1, tag: message.tag })', after: "JSON.stringify({ v: 1, tag: message.tag, privateText: 'PRIVATE_FIXTURE' })",
    file: 'runtime.test.ts', expected: 'real library encryption decrypts with independent recipient', network: false },
  { name: 'native redirect refusal', before: "redirect: 'manual'", after: "redirect: 'follow'",
    file: 'runtime-network.test.ts', expected: 'native fetch never follows provider redirects', network: true },
];
for (const control of controls) {
  assert.equal(original.split(control.before).length, 2);
  try {
    writeFileSync(source, original.replace(control.before, control.after));
    const result = spawnSync(process.execPath, [process.env.npm_execpath, 'exec', '--yes', '--package=deno@2.9.6', '--', 'deno',
      'test', '--frozen', '--allow-env', control.network ? '--allow-net=127.0.0.1' : '--deny-net',
      '--config', 'supabase/functions/reminder-sender/deno.json', 'supabase/functions/reminder-sender/' + control.file],
    { encoding: 'utf8', windowsHide: true, timeout: 90_000 });
    assert.equal(result.status, 1, 'Disabling the runtime guarantee must fail');
    assert.ok((result.stdout + result.stderr).includes(control.expected), 'Control must reach the intended assertion');
    console.log(`Reminder Edge negative control: removed ${control.name} detected.`);
  } finally {
    writeFileSync(source, saved);
    assert.ok(readFileSync(source).equals(saved));
  }
}
console.log(`Reminder Edge restored runtime SHA256: ${createHash('sha256').update(saved).digest('hex')}`);
