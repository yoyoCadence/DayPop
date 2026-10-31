// Actual local Supabase Edge Runtime cold start. No user/device or real push.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createDecipheriv, createECDH, generateKeyPairSync, hkdfSync, randomBytes, verify } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { localSupabaseHttpConfig, localSupabaseFetch } from './local-supabase-http.mjs';

const workdir = process.env.DAYPOP_HTTP_WORKDIR;
const cli = resolve('node_modules/supabase/dist/supabase.js');
const cliRequire = createRequire(cli);
const platformPackages = process.platform === 'win32' ? [`windows-${process.arch}`] : process.platform === 'linux'
  ? [`linux-${process.arch}`, `linux-${process.arch}-musl`] : [`darwin-${process.arch}`];
let nativeCli;
for (const platform of platformPackages) {
  try { nativeCli = join(dirname(cliRequire.resolve(`@supabase/cli-${platform}/package.json`)), 'bin', process.platform === 'win32' ? 'supabase.exe' : 'supabase'); break; } catch { /* next supported libc */ }
}
assert.ok(nativeCli && existsSync(nativeCli), 'Use the exact package-lock CLI binary');
const status = spawnSync(process.execPath, [cli, 'status', '--output', 'json', ...(workdir ? ['--workdir', workdir] : [])], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
assert.equal(status.status, 0, 'Start the local HTTP stack first');
const config = localSupabaseHttpConfig(status.stdout);
const container = process.env.DAYPOP_REMINDER_DB_CONTAINER || 'supabase_db_DayPop';
assert.ok(['supabase_db_DayPop', 'supabase_db_DayPopReminders'].includes(container));
assert.equal(config.url.port, container === 'supabase_db_DayPopReminders' ? '56321' : '54321');
const edgeContainer = container.replace('supabase_db_', 'supabase_edge_runtime_');
const docker = process.env.DAYPOP_DOCKER_BIN || 'docker';
function sql(input) {
  const result = spawnSync(docker, ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(result.status, 0, 'Local fixture SQL failed (details withheld)'); return result.stdout.trim();
}
assert.equal(sql('select count(*) from daypop_reminders.configuration where singleton and not enabled and public_key is null and last_tick is null;'), '1', 'Never overwrite an installed sender');
assert.equal(sql('select count(*) from public.reminder_push_devices;'), '0', 'Never send to existing devices');
const existing = spawnSync(docker, ['ps', '-a', '--format', '{{.Names}}'], { encoding: 'utf8', windowsHide: true });
assert.equal(existing.status, 0); assert.ok(!existing.stdout.split(/\r?\n/).includes(edgeContainer), 'Cold start requires an absent Edge Runtime; never reuse or replace an existing one');
const scratch = mkdtempSync(join(tmpdir(), 'daypop-reminder-edge-'));
const environmentFile = join(scratch, '.env');
const token = randomBytes(48).toString('base64url');
const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const key = pair.privateKey.export({ format: 'jwk' });
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(key.x, 'base64url'), Buffer.from(key.y, 'base64url')]).toString('base64url');
let launcher, child, touched = false, copied = [], stage = 'start', passed = false, lastStatus = 0;
const source = resolve('supabase/functions/reminder-sender');
const destination = workdir ? resolve(workdir, 'supabase/functions/reminder-sender') : source;
const probeDirectory = resolve(dirname(destination), 'reminder-runtime-probe');
let createdProbe = false;
const psQuote = value => "'" + value.replaceAll("'", "''") + "'";
try {
  writeFileSync(environmentFile, `DAYPOP_REMINDER_TOKEN=${token}\nDAYPOP_VAPID_PUBLIC_KEY=${publicKey}\nDAYPOP_VAPID_PRIVATE_KEY=${key.d}\nDAYPOP_VAPID_SUBJECT=https://example.test/contact\nDAYPOP_REMINDER_ALLOW_LOCAL=true\n`, { mode: 0o600 });
  if (destination !== source) {
    assert.equal(resolve(workdir), resolve(tmpdir(), 'daypop-reminders-supabase-20261029'), 'Only the dedicated TEMP stack can receive fixture code');
    mkdirSync(destination, { recursive: true });
    for (const file of ['index.ts', 'runtime.ts', 'core.generated.js', 'deno.json', 'deno.lock']) {
      const target = join(destination, file);
      assert.ok(!existsSync(target) || readFileSync(target).equals(readFileSync(join(source, file))), 'Never overwrite different fixture code');
      if (!existsSync(target)) { copyFileSync(join(source, file), target); copied.push(target); }
    }
  }
  assert.ok(!existsSync(probeDirectory), 'Never replace an existing probe directory');
  mkdirSync(probeDirectory); createdProbe = true;
  copyFileSync(join(source, 'runtime-probe.fixture.ts'), join(probeDirectory, 'index.ts'));
  for (const file of ['deno.json', 'deno.lock']) copyFileSync(join(source, file), join(probeDirectory, file));
  const args = ['functions', 'serve', '--no-verify-jwt', '--env-file', environmentFile, ...(workdir ? ['--workdir', resolve(workdir)] : [])];
  if (process.platform === 'win32') {
    // Hidden background launcher; never expose service environment or logs.
    const command = `$p=Start-Process -FilePath ${psQuote(nativeCli)} -ArgumentList ${args.map(value => psQuote('"' + value + '"')).join(',')} -WindowStyle Hidden -PassThru -RedirectStandardOutput ${psQuote(join(scratch, 'stdout.log'))} -RedirectStandardError ${psQuote(join(scratch, 'stderr.log'))}; if ($p.Path -ne ${psQuote(nativeCli)}) { throw 'Unexpected launcher' }; $p.Id`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    assert.equal(result.status, 0, 'Hidden Edge launcher failed');
    launcher = Number(result.stdout.trim()); assert.ok(Number.isInteger(launcher) && launcher > 0);
  } else {
    const out = openSync(join(scratch, 'stdout.log'), 'w'), err = openSync(join(scratch, 'stderr.log'), 'w');
    child = spawn(nativeCli, args, { stdio: ['ignore', out, err] });
    closeSync(out); closeSync(err);
  }
  const request = async (bearer, body = '{}') => {
    const response = await localSupabaseFetch(config.url)(new URL('/functions/v1/reminder-sender', config.url), {
      method: 'POST', headers: bearer ? { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' } : {}, body,
    });
    lastStatus = response.status; return response;
  };
  const deadline = Date.now() + 120_000; let response;
  while (Date.now() < deadline) {
    try { response = await request(); if (response.status === 401) break; await response.body?.cancel(); } catch { /* bounded local cold start */ }
    await delay(500);
  }
  assert.equal(response?.status, 401, 'Cold-start function must reject missing sender authorization');
  await response.body?.cancel();
  // This is a static runtime integration test, not a development watcher test.
  // The CLI's Windows directory WRITE watcher can restart the whole container
  // after Deno initializes dependencies. Stop OUR native watcher immediately;
  // SIGKILL leaves its already-started Docker runtime alive for all assertions.
  if (launcher) { process.kill(launcher, 'SIGKILL'); launcher = undefined; }
  if (child) {
    assert.equal(child.exitCode, null, 'The native CLI must still be our live watcher');
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(10_000) });
    child.kill('SIGKILL'); await exited; child = undefined;
  }
  const alive = spawnSync(docker, ['inspect', edgeContainer, '--format', '{{.State.Running}}'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  assert.equal(alive.status, 0); assert.equal(alive.stdout.trim(), 'true', 'The real Edge container must remain running without its watcher');
  stage = 'authorization';
  for (const bearer of [config.publicKey, config.adminKey, randomBytes(48).toString('base64url')]) {
    const denied = await request(bearer); assert.equal(denied.status, 401); await denied.body?.cancel();
  }
  const selected = await request(token, '{"recipients":["caller-selected"]}'); assert.equal(selected.status, 400); await selected.body?.cancel();
  assert.equal(sql('select count(*) from daypop_reminders.configuration where last_tick is not null;'), '0');
  stage = 'container encryption';
  const recipient = createECDH('prime256v1'); const recipientPublic = recipient.generateKeys(); const auth = randomBytes(16);
  const encrypted = await localSupabaseFetch(config.url)(new URL('/functions/v1/reminder-runtime-probe', config.url), {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/local-crypto-probe', p256dh: recipientPublic.toString('base64url'), auth: auth.toString('base64url') }),
  });
  lastStatus = encrypted.status; assert.equal(encrypted.status, 200);
  stage = 'container cipher parameters';
  const envelope = await encrypted.json(); assert.equal(envelope.encoding, 'aes128gcm');
  assert.ok(Number(envelope.ttl) > 0 && Number(envelope.ttl) <= 240);
  const bytes = Buffer.from(envelope.ciphertext, 'base64'), senderPublic = bytes.subarray(21, 86);
  assert.equal(bytes[20], 65);
  stage = 'container decryption';
  // Independent RFC 8291 / 8188 recipient in Node, not library decryption.
  const shared = recipient.computeSecret(senderPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), recipientPublic, senderPublic]);
  const ikm = hkdfSync('sha256', shared, auth, info, 32), salt = bytes.subarray(0, 16);
  const cek = hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const decipher = createDecipheriv('aes-128-gcm', Buffer.from(cek), Buffer.from(nonce));
  decipher.setAuthTag(bytes.subarray(-16));
  const plain = Buffer.concat([decipher.update(bytes.subarray(86, -16)), decipher.final()]);
  let recordEnd = plain.length - 1; while (plain[recordEnd] === 0) recordEnd--;
  assert.equal(plain[recordEnd], 2);
  stage = 'container anonymous payload';
  assert.deepEqual(JSON.parse(plain.subarray(0, recordEnd).toString('utf8')), { v: 1, tag: 'f'.repeat(64) });
  stage = 'container VAPID signature';
  const jwt = /t=([^,\s]+)/.exec(envelope.authorization)?.[1]; assert.ok(jwt);
  const [jwtHeader, jwtBody, signature] = jwt.split('.');
  assert.equal(verify('sha256', Buffer.from(jwtHeader + '.' + jwtBody), { key: pair.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true);
  const claims = JSON.parse(Buffer.from(jwtBody, 'base64url').toString('utf8'));
  stage = 'container VAPID claims';
  assert.equal(claims.aud, 'https://fcm.googleapis.com'); assert.equal(claims.sub, 'https://example.test/contact');
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 86400);
  stage = 'container runtime metadata';
  console.log('Reminder Edge public runtime metadata: ' + JSON.stringify({ deno: envelope.deno, timeZone: envelope.zone }));
  // Supabase reports its own runtime name plus the compatible Deno version.
  assert.ok(typeof envelope.deno === 'string' && envelope.deno.length <= 100 && /^[\x20-\x7E]+$/.test(envelope.deno));
  assert.ok(typeof envelope.zone === 'string' && /^[A-Za-z_+\-/0-9]+$/.test(envelope.zone));
  console.log(`Reminder Edge container encryption/signature independently verified; Deno ${envelope.deno}; actual timezone: ${envelope.zone}`);
  stage = 'disabled';
  const disabled = await request(token); assert.equal(disabled.status, 503); await disabled.body?.cancel();
  touched = true;
  sql(`update daypop_reminders.configuration set enabled=true,public_key='${publicKey}' where singleton;`);
  stage = 'matching runtime';
  const good = await request(token); assert.equal(good.status, 200);
  const result = await good.json(); assert.equal(result.sent, 0); assert.equal(result.unconfirmed, 0);
  assert.ok(!JSON.stringify(result).includes(publicKey));
  assert.equal(sql('select count(*) from daypop_reminders.configuration where last_tick is not null and last_error is null;'), '1');
  stage = 'key rotation';
  sql("update daypop_reminders.configuration set public_key='B" + 'A'.repeat(86) + "' where singleton;");
  assert.equal(sql('select count(*) from daypop_reminders.configuration where last_tick is not null;'), '0');
  const mismatch = await request(token); assert.equal(mismatch.status, 503); await mismatch.body?.cancel();
  assert.equal(sql('select count(*) from daypop_reminders.configuration where last_tick is not null;'), '0');
  assert.equal(sql('select count(*) from daypop_reminders.deliveries;'), '0');
  passed = true;
  console.log(`Reminder Edge cold start: authorization / disabled / live RPC heartbeat / key rotation passed; actual timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
} catch {
  throw Error(`Reminder Edge local integration failed at ${stage} (HTTP ${lastStatus}); runtime logs withheld (may contain local credentials)`);
} finally {
  if (!passed) {
    const logs = spawnSync(docker, ['logs', edgeContainer], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    const runtimeLog = (logs.stdout ?? '') + (logs.stderr ?? '');
    writeFileSync(join(scratch, 'runtime.log'), runtimeLog);
    let cliLog = ''; try { cliLog = readFileSync(join(scratch, 'stderr.log'), 'utf8'); } catch { /* launcher may not have started */ }
    const content = runtimeLog + cliLog;
    const markers = ['boot error', 'TypeError', 'InvalidWorkerResponse', 'worker shutdown', 'CPU time limit', 'wall clock', 'connection closed', 'event loop', 'worker boot error', 'File change detected'];
    console.log('Reminder Edge diagnostics (counts only): ' + markers.map(marker => marker + '=' + (content.split(marker).length - 1)).join(', '));
  }
  let cleanupFailed = false;
  try {
    if (touched) sql('update daypop_reminders.configuration set enabled=false,public_key=null,last_tick=null,last_error=null where singleton;');
  } catch { cleanupFailed = true; }
  if (launcher) {
    const command = `$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${launcher}'; if ($p -and $p.CommandLine.Contains(${psQuote(nativeCli)}) -and $p.CommandLine.Contains('functions')) { Stop-Process -Id ${launcher} -Force }`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: 'ignore' });
    if (result.status !== 0) cleanupFailed = true;
  }
  child?.kill();
  const stopped = spawnSync(docker, ['stop', edgeContainer], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  const removed = spawnSync(docker, ['rm', edgeContainer], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (passed && (stopped.status !== 0 || removed.status !== 0)) cleanupFailed = true;
  for (const file of copied) { try { rmSync(file); } catch { cleanupFailed = true; } }
  if (createdProbe) {
    assert.ok(dirname(probeDirectory) === dirname(destination) && basename(probeDirectory) === 'reminder-runtime-probe');
    try { rmSync(probeDirectory, { recursive: true, force: true }); } catch { cleanupFailed = true; }
  }
  // Check the final absolute deletion target before any recursive operation.
  const checkedScratch = resolve(scratch);
  assert.ok(dirname(checkedScratch) === resolve(tmpdir()) && basename(checkedScratch).startsWith('daypop-reminder-edge-'));
  try {
    if (passed) rmSync(checkedScratch, { recursive: true, force: true });
    else rmSync(environmentFile, { force: true }); // retain local-only failure logs, never the secret env file
  } catch { cleanupFailed = true; }
  if (cleanupFailed) throw Error('Reminder Edge fixture cleanup failed; inspect only this dedicated local stack');
}
