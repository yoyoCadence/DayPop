// Actual local GoTrue + PostgREST + migrated RLS, with the production services.
// No linked project, external URL, env credential, fake client or browser bundle.
// The CLI's local admin key is confined to Node fixture setup/cleanup; every
// product operation uses its account's separately signed-in public client.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createServer } from 'vite';
import { localSupabaseHttpConfig, localSupabaseFetch } from './local-supabase-http.mjs';
const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));

const workdir = process.env.DAYPOP_HTTP_WORKDIR;
const status = spawnSync(process.execPath, [resolve('node_modules/supabase/dist/supabase.js'), 'status', '--output', 'json', ...(workdir ? ['--workdir', workdir] : [])], {
  encoding: 'utf8', windowsHide: true, timeout: 30_000,
});
assert.equal(status.status, 0, 'Start the local Supabase HTTP services before this test');
const config = localSupabaseHttpConfig(status.stdout);
const api = config.url;
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: localSupabaseFetch(api) },
};
const admin = createClient(api.href, config.adminKey, options);
const actors = [];
let vite;
let stage = 'setup';
let checks = 0;
const expectedChecks = 9;
async function check(name, operation) {
  stage = name;
  await operation();
  checks += 1;
  console.log(`HTTP pets: ${name} passed`);
}
async function actor(label) {
  const email = `daypop-http-${randomUUID()}@example.test`;
  const password = randomUUID() + randomUUID();
  // Confirmed local fixtures bypass email delivery only. Password sign-in,
  // Auth JWT issuance, RPCs and row access below all cross the real HTTP API.
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ok(!created.error && created.data.user, 'Create a fresh local synthetic identity');
  const value = { label, id: created.data.user.id, email, password, client: createClient(api.href, config.publicKey, options) };
  actors.push(value); // Track immediately so even a failed sign-in is cleaned.
  const signed = await value.client.auth.signInWithPassword({ email, password });
  assert.ok(!signed.error && signed.data.session && signed.data.user?.id === value.id, 'Password sign-in must issue this account a real session');
  return value;
}
try {
  console.log(`HTTP pets environment: ${api.origin}; timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  vite = await createServer({ configFile: false, envFile: false, logLevel: 'error', server: { middlewareMode: true, watch: null },
    ssr: { noExternal: ['rrule'] }, define: { __APP_VERSION__: JSON.stringify(packageJson.version), __DATA_SCHEMA_VERSION__: '5' } });
  const { SupabaseDayPopRepository } = await vite.ssrLoadModule('/src/data/supabaseRepository.ts');
  const { buildJsonBackup, planJsonImport } = await vite.ssrLoadModule('/src/domain/dataTransfer.ts');
  const mapping = await vite.ssrLoadModule('/src/domain/databaseMapping.ts');
  const a = await actor('A'), b = await actor('B');
  a.repository = new SupabaseDayPopRepository(a.client, a.id);
  b.repository = new SupabaseDayPopRepository(b.client, b.id);
  const fresh = async () => new SupabaseDayPopRepository(a.client, a.id).load();
  const without = (row, key) => Object.fromEntries(Object.entries(row).filter(([name]) => name !== key));
  // The existing replace RPC recreates row timestamps. Compare all restored
  // content/ids/preferences; rejected operations below still compare exact data.
  const portable = value => Array.isArray(value) ? value.map(portable)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['createdAt', 'updatedAt'].includes(key)).map(([key, item]) => [key, portable(item)])) : value;
  let baseline, backup, wire;
  await check('bootstrap and real authenticated load', async () => {
    const own = await a.repository.load(), other = await b.repository.load();
    assert.equal(own.preferences.petKind, 'moon_cat'); assert.equal(other.preferences.petKind, 'moon_cat');
    await a.repository.addEvent({ title: 'Local fixture', date: '2026-11-04', allDay: true, start: '09:00', end: '10:00' });
    await a.repository.addTodo({ title: 'Local task', date: '2026-11-04' });
    baseline = await fresh();
  });
  await check('all five choices persist through real repository and independent reload', async () => {
    for (const petKind of ['moon_cat','orbit_ufo','marshmallow_cat','honey_bear','peach_bunny']) {
      await a.repository.updatePreferences({ petKind });
      const actual = await fresh();
      assert.equal(actual.preferences.petKind, petKind);
      assert.deepEqual({ ...actual, preferences: { ...actual.preferences, petKind: 'moon_cat' } }, baseline);
    }
  });
  await check('database rejects invalid and null keys without changing preferences', async () => {
    const before = await fresh();
    for (const pet_kind of ['unknown', null]) {
      const result = await a.client.from('user_preferences').update({ pet_kind }).eq('user_id', a.id);
      assert.equal(result.error?.code, pet_kind === null ? '23502' : '23514');
      assert.deepEqual(await fresh(), before);
    }
  });
  await check('other account cannot read or change the owner choice', async () => {
    const before = await fresh();
    const read = await b.client.from('user_preferences').select('*').eq('user_id', a.id);
    const write = await b.client.from('user_preferences').update({ pet_kind: 'honey_bear' }).eq('user_id', a.id).select('*');
    assert.ok(!read.error && read.data.length === 0); assert.ok(!write.error && write.data.length === 0);
    assert.deepEqual(await fresh(), before);
    assert.equal((await b.repository.load()).preferences.petKind, 'moon_cat');
  });
  await check('anonymous requests cannot select private preferences', async () => {
    const anonymous = createClient(api.href, config.publicKey, options);
    const result = await anonymous.from('user_preferences').select('*').eq('user_id', a.id);
    assert.equal(result.error?.code, '42501');
  });
  await check('an old client preference upsert preserves the selected partner', async () => {
    const before = await fresh();
    const oldWire = without(mapping.preferencesToInsert(before.preferences, a.id), 'pet_kind');
    const result = await a.client.from('user_preferences').upsert(oldWire).select('*').single();
    assert.ok(!result.error);
    assert.equal(result.data.pet_kind, before.preferences.petKind);
    assert.deepEqual(await fresh(), before);
  });
  await check('v2 backup restores the selected choice through the atomic RPC', async () => {
    await a.repository.updatePreferences({ petKind: 'honey_bear' });
    backup = await fresh();
    await a.repository.updatePreferences({ petKind: 'peach_bunny' });
    const plan = planJsonImport(JSON.stringify(buildJsonBackup(backup)), await a.repository.load());
    await a.repository.importData(plan.command);
    assert.deepEqual(portable(await fresh()), portable(backup));
  });
  await check('old clients may omit the optional wire key while retaining current choice', async () => {
    const data = await fresh();
    const owned = (rows, map) => rows.map(row => without(map(row, a.id), 'owner_id'));
    wire = { calendars: owned(data.calendars, mapping.calendarToInsert),
      events: owned(data.events, mapping.eventToInsert), event_exceptions: owned(data.eventExceptions, mapping.eventExceptionToInsert),
      todos: owned(data.todos, mapping.todoToInsert), stickers: owned(data.stickers, mapping.stickerToInsert),
      preferences: without(without(mapping.preferencesToInsert(data.preferences, a.id), 'user_id'), 'pet_kind') };
    const result = await a.client.rpc('replace_daypop_data', { p_payload: wire });
    assert.ok(!result.error, 'Old import wire must remain compatible');
    assert.deepEqual(portable(await fresh()), portable(data));
  });
  await check('invalid import choice rolls back all rows and preferences', async () => {
    const before = await fresh();
    for (const pet_kind of ['unknown', null]) {
      const result = await a.client.rpc('replace_daypop_data', { p_payload: { ...wire, preferences: { ...wire.preferences, pet_kind } } });
      assert.equal(result.error?.code, '22023');
      assert.deepEqual(await fresh(), before);
    }
  });
  assert.equal(checks, expectedChecks, 'Every planned HTTP pets group must execute');
} catch (cause) {
  console.error(`HTTP pets failed at: ${stage} (${cause.name})`);
  if (typeof cause.operation === 'string') console.error(`Operation: ${cause.operation}; code: ${cause.cause?.code ?? 'transport'}`);
  // Never dump SDK responses, CLI status, keys, passwords or session objects.
  if (cause instanceof assert.AssertionError) console.error(cause.message.split('\n')[0]);
  if (cause instanceof assert.AssertionError && cause.actual && cause.expected) {
    const changed = (actual, expected, path = '') => {
      if (Object.is(actual, expected)) return [];
      if (actual && expected && typeof actual === 'object' && typeof expected === 'object')
        return [...new Set([...Object.keys(actual), ...Object.keys(expected)])].flatMap(key => changed(actual[key], expected[key], `${path}.${key}`));
      return [path];
    };
    console.error('Changed field paths only:', changed(cause.actual, cause.expected).slice(0, 16).join(', '));
  }
  process.exitCode = 1;
} finally {
  let cleanupFailed = false;
  for (const value of actors) {
    try {
      const removed = await admin.auth.admin.deleteUser(value.id);
      const gone = await admin.auth.admin.getUserById(value.id);
      if (removed.error || gone.data.user !== null) cleanupFailed = true;
    } catch { cleanupFailed = true; }
  }
  if (vite) await vite.close();
  if (cleanupFailed) { console.error('Local HTTP fixture cleanup failed'); process.exitCode = 1; }
  else console.log(`HTTP pets cleanup: ${actors.length} synthetic identities removed; ${checks}/${expectedChecks} checks passed.`);
}
