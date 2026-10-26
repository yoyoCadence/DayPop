// Actual local GoTrue + PostgREST + migrated RLS, with the production services.
// No linked project, external URL, env credential, fake client or browser bundle.
// The CLI's local admin key is confined to Node fixture setup/cleanup; every
// product operation uses its account's separately signed-in public client.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createServer } from 'vite';

const workdir = process.env.DAYPOP_HTTP_WORKDIR;
const status = spawnSync(process.execPath, [resolve('node_modules/supabase/dist/supabase.js'), 'status', '--output', 'json', ...(workdir ? ['--workdir', workdir] : [])], {
  encoding: 'utf8', windowsHide: true, timeout: 30_000,
});
assert.equal(status.status, 0, 'Start the local Supabase HTTP services before this test');
let config;
try { config = JSON.parse(status.stdout); } catch { throw Error('Local CLI status must return JSON'); }
const api = new URL(config.API_URL);
assert.equal(api.protocol, 'http:', 'Only the local HTTP test stack is allowed');
assert.equal(api.hostname, '127.0.0.1', 'Remote/linked Supabase is forbidden');
assert.ok(api.username + api.password + api.search + api.hash === '', 'No credential or query is allowed in the API URL');
assert.equal(api.pathname, '/', 'Use the local API root');
assert.ok(config.ANON_KEY && config.SERVICE_ROLE_KEY, 'Local test keys must come from CLI status, never the environment');
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch(input, init) {
    const target = new URL(input instanceof Request ? input.url : input);
    assert.equal(target.origin, api.origin, 'Test requests must stay on this local origin');
    return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  } },
};
const admin = createClient(api.href, config.SERVICE_ROLE_KEY, options);
const actors = [];
let vite;
let stage = 'setup';
let checks = 0;
async function check(name, operation) {
  stage = name;
  await operation();
  checks += 1;
  console.log(`HTTP sharing: ${name} passed`);
}
async function actor(label) {
  const email = `daypop-http-${randomUUID()}@example.test`;
  const password = randomUUID() + randomUUID();
  // Confirmed local fixtures bypass email delivery only. Password sign-in,
  // Auth JWT issuance, RPCs and row access below all cross the real HTTP API.
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ok(!created.error && created.data.user, 'Create a fresh local synthetic identity');
  const value = { label, id: created.data.user.id, email, password, client: createClient(api.href, config.ANON_KEY, options) };
  actors.push(value); // Track immediately so even a failed sign-in is cleaned.
  const signed = await value.client.auth.signInWithPassword({ email, password });
  assert.ok(!signed.error && signed.data.session && signed.data.user?.id === value.id, 'Password sign-in must issue this account a real session');
  return value;
}
try {
  console.log(`HTTP sharing environment: ${api.origin}; timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  // Transform the production TS modules without a listening dev server or
  // loading .env. No alternate copy of the repository or family logic.
  vite = await createServer({ configFile: false, envFile: false, logLevel: 'error', server: { middlewareMode: true, watch: null },
    ssr: { noExternal: ['rrule'] },
    define: { __APP_VERSION__: JSON.stringify('http-test'), __DATA_SCHEMA_VERSION__: '4' } });
  const { SupabaseDayPopRepository } = await vite.ssrLoadModule('/src/data/supabaseRepository.ts');
  const { SupabaseFamilyService, FamilyError } = await vite.ssrLoadModule('/src/family/familyService.ts');
  const a = await actor('A'), b = await actor('B');
  a.repository = new SupabaseDayPopRepository(a.client, a.id);
  b.repository = new SupabaseDayPopRepository(b.client, b.id);
  a.family = new SupabaseFamilyService(a.client, a.id);
  b.family = new SupabaseFamilyService(b.client, b.id);
  let sharedId, eventId, todoId;
  const event = (title, calendarId, sharingScope = 'inherit') => ({ title, calendarId, sharingScope, date: '2026-10-26', allDay: true, start: '09:00', end: '10:00' });
  await check('independent bootstrap and personal rows', async () => {
    const [ownA, ownB] = await Promise.all([a.repository.load(), b.repository.load()]);
    assert.ok(ownA.calendars[0].id !== ownB.calendars[0].id, 'Auth bootstrap must produce independent calendars');
    await a.repository.addEvent(event('A personal', ownA.calendars[0].id));
    await b.repository.addEvent(event('B personal', ownB.calendars[0].id));
    assert.ok((await a.repository.load()).events.every(row => row.title !== 'B personal'), 'A must not read B personal rows');
    assert.ok((await b.repository.load()).events.every(row => row.title !== 'A personal'), 'B must not read A personal rows');
    const snapshot = await a.repository.addCalendar({ name: 'HTTP shared', color: '#336699' });
    sharedId = snapshot.calendars.find(row => row.name === 'HTTP shared').id;
    const withEvent = await a.repository.addEvent(event('Shared original', sharedId));
    eventId = withEvent.events.find(row => row.title === 'Shared original').id;
    await a.repository.addEvent(event('Owner private', sharedId, 'private'));
  });
  await check('recipient-bound invitation and explicit acceptance', async () => {
    const created = await a.family.command({ kind: 'create', name: 'HTTP family' });
    const invitation = await a.family.command({ kind: 'invite', groupId: created.snapshot.group.id, email: b.email });
    await assert.rejects(a.family.preview(invitation.invitation.token), cause => cause instanceof FamilyError && cause.message.includes('收到邀請的 Email'));
    await b.family.preview(invitation.invitation.token);
    assert.equal((await b.family.load()).group, null, 'Preview cannot silently accept');
    await b.family.command({ kind: 'accept', token: invitation.invitation.token });
    assert.equal((await a.family.load()).members.length, 2, 'Acceptance must persist across clients');
    assert.ok(!(await b.repository.load()).calendars.some(row => row.id === sharedId), 'Membership alone cannot share a calendar');
  });
  await check('explicit edit sharing and private row filtering', async () => {
    await a.repository.setCalendarShare(sharedId, 'edit');
    const received = await b.repository.load();
    assert.ok(received.events.some(row => row.id === eventId), 'B must receive the existing shared event');
    assert.ok(!received.events.some(row => row.title === 'Owner private'), 'RLS must exclude owner-private rows');
    assert.ok(!received.calendars.find(row => row.id === sharedId).isDefault, 'A received calendar cannot replace B default');
    assert.ok(!b.repository.personalData().calendars.some(row => row.id === sharedId), 'Received rows cannot enter personal export/cache projection');
    const raw = await b.client.from('events').select('id').eq('calendar_id', sharedId).eq('sharing_scope', 'private');
    assert.ok(!raw.error && raw.data.length === 0, 'Private filtering must also hold below the frontend repository');
  });
  await check('member edits, authorship and owner readback', async () => {
    await b.repository.updateEvent(eventId, { title: 'B edited' });
    const created = await b.repository.addTodo({ title: 'B shared todo', calendarId: sharedId, date: '2026-10-26' });
    todoId = created.todos.find(row => row.title === 'B shared todo').id;
    const owner = await a.repository.load();
    assert.ok(owner.events.some(row => row.id === eventId && row.title === 'B edited'), 'A must read B event update');
    assert.ok(owner.todos.some(row => row.id === todoId), 'A must read B newly created shared todo');
    const authorship = await a.client.from('todos').select('owner_id,created_by').eq('id', todoId).single();
    assert.ok(!authorship.error && authorship.data.owner_id === a.id && authorship.data.created_by === b.id, 'Server assigns calendar ownership and actual caller authorship');
  });
  await check('stale shared version rejected across clients', async () => {
    await Promise.all([a.repository.load(), b.repository.load()]);
    await a.repository.updateEvent(eventId, { title: 'A newest' });
    await assert.rejects(b.repository.updateEvent(eventId, { title: 'B stale' }));
    assert.ok((await a.repository.load()).events.some(row => row.id === eventId && row.title === 'A newest'), 'Stale writer cannot overwrite the winner');
  });
  await check('view downgrade enforced on a stale edit client', async () => {
    await b.repository.load();
    await a.repository.setCalendarShare(sharedId, 'view');
    await assert.rejects(b.repository.renameTodo(todoId, 'Forbidden view write'));
    const received = await b.repository.load();
    assert.equal(b.repository.sharingSession().shares.find(row => row.calendarId === sharedId).permission, 'view');
    assert.ok(received.events.some(row => row.id === eventId), 'View still allows reading');
    assert.ok((await a.repository.load()).todos.some(row => row.id === todoId && row.title === 'B shared todo'), 'Rejected write leaves the row unchanged');
  });
  await check('revocation rejected before revalidation and received rows removed', async () => {
    await a.repository.setCalendarShare(sharedId, 'edit');
    await b.repository.load();
    await a.repository.setCalendarShare(sharedId, null);
    await assert.rejects(b.repository.updateEvent(eventId, { title: 'Forbidden revoked write' }));
    assert.ok(!(await b.repository.load()).calendars.some(row => row.id === sharedId), 'Revalidation must remove revoked content');
    assert.ok((await a.repository.load()).events.some(row => row.id === eventId && row.title === 'A newest'), 'Revocation cannot delete owner content');
  });
  await check('real logout and fresh password session preserve personal rows', async () => {
    const signedOut = await b.client.auth.signOut();
    assert.ok(!signedOut.error, 'Local Auth logout must succeed');
    const fresh = createClient(api.href, config.ANON_KEY, options);
    const signed = await fresh.auth.signInWithPassword({ email: b.email, password: b.password });
    assert.ok(!signed.error && signed.data.user?.id === b.id, 'Fresh session must resolve the same account');
    const repository = new SupabaseDayPopRepository(fresh, b.id);
    const restored = await repository.load();
    assert.ok(restored.events.some(row => row.title === 'B personal'), 'B personal data survives logout and new client');
    assert.ok(!restored.calendars.some(row => row.id === sharedId), 'Old received sharing cannot return after login');
    await fresh.auth.signOut();
  });
} catch (cause) {
  console.error(`HTTP sharing failed at: ${stage} (${cause.name})`);
  if (typeof cause.operation === 'string') console.error(`Operation: ${cause.operation}; code: ${cause.cause?.code ?? 'transport'}`);
  // Never dump SDK responses, CLI status, keys, passwords or session objects.
  if (cause instanceof assert.AssertionError) console.error(cause.message.split('\n')[0]);
  process.exitCode = 1;
} finally {
  let cleanupFailed = false;
  for (const value of actors) {
    const removed = await admin.auth.admin.deleteUser(value.id);
    const gone = await admin.auth.admin.getUserById(value.id);
    if (removed.error || gone.data.user !== null) cleanupFailed = true;
  }
  if (vite) await vite.close();
  if (cleanupFailed) { console.error('Local HTTP fixture cleanup failed'); process.exitCode = 1; }
  else console.log(`HTTP sharing cleanup: ${actors.length} synthetic identities removed; ${checks}/8 checks passed.`);
}
