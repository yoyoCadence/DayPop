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
const expectedChecks = 11;
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
  const value = { label, id: created.data.user.id, email, password, client: createClient(api.href, config.publicKey, options) };
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
    define: { __APP_VERSION__: JSON.stringify(packageJson.version), __DATA_SCHEMA_VERSION__: '4' } });
  const { SupabaseDayPopRepository } = await vite.ssrLoadModule('/src/data/supabaseRepository.ts');
  const { SupabaseFamilyService, FamilyError } = await vite.ssrLoadModule('/src/family/familyService.ts');
  const a = await actor('A'), b = await actor('B');
  a.repository = new SupabaseDayPopRepository(a.client, a.id);
  b.repository = new SupabaseDayPopRepository(b.client, b.id);
  a.family = new SupabaseFamilyService(a.client, a.id);
  b.family = new SupabaseFamilyService(b.client, b.id);
  // Independent repository snapshots share B's real Auth client, so one
  // rejected operation cannot refresh another stale editor before its RPC.
  const memberSnapshot = async () => {
    const repository = new SupabaseDayPopRepository(b.client, b.id);
    await repository.load();
    return repository;
  };
  const ownerTodos = async ids => {
    const rows = await a.client.from('todos').select('*').in('id', ids).order('id');
    assert.ok(!rows.error && Array.isArray(rows.data), 'Owner must read persisted todo rows');
    return rows.data;
  };
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
  await check('shared todo completion and child fields survive independent reloads', async () => {
    const created = await b.repository.addTodo({ title: 'Member child', parentId: todoId, date: '2026-11-01' });
    const child = created.todos.find(row => row.title === 'Member child');
    assert.ok(child && child.parentId === todoId && child.calendarId === sharedId && child.dueDate === '2026-10-26', 'Child inherits its actual parent calendar and initial date');
    await b.repository.renameTodo(child.id, 'Member child renamed');
    await b.repository.setTodoPriority(child.id, 'high');
    await b.repository.rescheduleTodo(child.id, '2026-10-27');
    await b.repository.toggleTodo(child.id);
    await b.repository.toggleTodo(todoId);
    const stored = await ownerTodos([todoId, child.id]);
    assert.equal(stored.length, 2, 'Both parent and child persist');
    assert.ok(stored.every(row => typeof row.completed_at === 'string'), 'Member completion must reach both persisted rows');
    const storedChild = stored.find(row => row.id === child.id);
    assert.ok(storedChild.parent_id === todoId && storedChild.title === 'Member child renamed' && storedChild.priority === 'high' && storedChild.due_date === '2026-10-27', 'Child edits preserve its hierarchy in the database');
    await a.repository.load();
    await a.repository.toggleTodo(todoId);
    const restored = new SupabaseDayPopRepository(b.client, b.id);
    const reloaded = await restored.load();
    assert.equal(reloaded.todos.find(row => row.id === todoId).completedAt, null, 'Owner can undo a member completion');
    assert.ok(reloaded.todos.some(row => row.id === child.id && row.completedAt !== null && row.parentId === todoId && row.title === storedChild.title && row.priority === 'high' && row.dueDate === storedChild.due_date), 'Independent member repository reload preserves child completion and edits');
    assert.ok(!restored.personalData().todos.some(row => row.id === todoId || row.id === child.id), 'Completed received todos stay outside member cache/export projection');
    assert.equal((await ownerTodos([todoId]))[0].completed_at, null, 'Undo must also persist on the server');
  });
  await check('shared todo subtree deletion checks every child version atomically', async () => {
    const parentData = await b.repository.addTodo({ title: 'Delete tree', calendarId: sharedId, date: '2026-10-26' });
    const parentId = parentData.todos.find(row => row.title === 'Delete tree').id;
    const childData = await b.repository.addTodo({ title: 'Delete child B', parentId, date: '2026-10-26' });
    const firstId = childData.todos.find(row => row.title === 'Delete child B').id;
    await a.repository.load();
    const ownerData = await a.repository.addTodo({ title: 'Delete child A', parentId, date: '2026-10-26' });
    const secondId = ownerData.todos.find(row => row.title === 'Delete child A').id;
    await b.repository.load();
    await a.repository.renameTodo(firstId, 'Owner newest child');
    const ids = [parentId, firstId, secondId];
    const before = await ownerTodos(ids);
    assert.equal(before.length, 3, 'Deletion fixture has a parent and children by different authors');
    assert.ok(before.find(row => row.id === firstId).created_by === b.id && before.find(row => row.id === secondId).created_by === a.id, 'Both actual child authors persist across clients');
    await assert.rejects(b.repository.deleteTodo(parentId), { message: /內容已被修改/ }, 'Stale child version must reject the whole subtree deletion');
    assert.deepEqual(await ownerTodos(ids), before, 'Rejected subtree deletion cannot remove or change any row');
    await b.repository.load();
    await b.repository.deleteTodo(parentId);
    assert.deepEqual(await ownerTodos(ids), [], 'Confirmed member deletion removes the parent and both children');
    assert.ok((await a.repository.load()).todos.some(row => row.id === todoId), 'Subtree deletion preserves unrelated shared todos');
  });
  await check('private todo ancestry and hidden descendants remain owner controlled', async () => {
    const parentData = await a.repository.addTodo({ title: 'Visible parent with private child', calendarId: sharedId, date: '2026-10-26' });
    const parentId = parentData.todos.find(row => row.title === 'Visible parent with private child').id;
    const childData = await a.repository.addTodo({ title: 'Owner hidden child', parentId, sharingScope: 'private', date: '2026-10-26' });
    const childId = childData.todos.find(row => row.title === 'Owner hidden child').id;
    const privateData = await a.repository.addTodo({ title: 'Owner private parent', calendarId: sharedId, sharingScope: 'private', date: '2026-10-26' });
    const privateId = privateData.todos.find(row => row.title === 'Owner private parent').id;
    const inheritedData = await a.repository.addTodo({ title: 'Hidden by private ancestor', parentId: privateId, sharingScope: 'inherit', date: '2026-10-26' });
    const inheritedId = inheritedData.todos.find(row => row.title === 'Hidden by private ancestor').id;
    const received = await b.repository.load();
    assert.ok(received.todos.some(row => row.id === parentId), 'Member can still read the visible parent');
    const hiddenIds = [childId, privateId, inheritedId];
    assert.ok(!received.todos.some(row => hiddenIds.includes(row.id)), 'Private ancestry must be excluded from the repository snapshot');
    const raw = await b.client.from('todos').select('id').in('id', hiddenIds);
    assert.ok(!raw.error && raw.data.length === 0, 'Private todo descendants must also be hidden from direct member HTTP reads');
    const ids = [parentId, ...hiddenIds];
    const before = await ownerTodos(ids);
    assert.equal(before.length, 4, 'Owner retains all private descendant fixtures');
    await assert.rejects(b.repository.deleteTodo(parentId), { message: /私人內容/ }, 'Member cannot cascade-delete an unseen private child');
    assert.deepEqual(await ownerTodos(ids), before, 'Refused private cascade preserves every owner row');
    await a.repository.load();
    await a.repository.deleteTodo(parentId);
    await a.repository.deleteTodo(privateId);
    assert.deepEqual(await ownerTodos(ids), [], 'Owner can explicitly delete both complete subtrees');
  });
  await check('stale shared version rejected across clients', async () => {
    await Promise.all([a.repository.load(), b.repository.load()]);
    await a.repository.updateEvent(eventId, { title: 'A newest' });
    await assert.rejects(b.repository.updateEvent(eventId, { title: 'B stale' }));
    assert.ok((await a.repository.load()).events.some(row => row.id === eventId && row.title === 'A newest'), 'Stale writer cannot overwrite the winner');
  });
  await check('view downgrade enforced on a stale edit client', async () => {
    await b.repository.load();
    const [completer, deleter] = await Promise.all([memberSnapshot(), memberSnapshot()]);
    const before = await ownerTodos([todoId]);
    await a.repository.setCalendarShare(sharedId, 'view');
    await assert.rejects(completer.toggleTodo(todoId));
    await assert.rejects(deleter.deleteTodo(todoId));
    await assert.rejects(b.repository.renameTodo(todoId, 'Forbidden view write'));
    assert.deepEqual(await ownerTodos([todoId]), before, 'Stale view editors cannot complete, delete or change the todo');
    const received = await b.repository.load();
    assert.equal(b.repository.sharingSession().shares.find(row => row.calendarId === sharedId).permission, 'view');
    assert.ok(received.events.some(row => row.id === eventId), 'View still allows reading');
    assert.ok((await a.repository.load()).todos.some(row => row.id === todoId && row.title === 'B shared todo'), 'Rejected write leaves the row unchanged');
  });
  await check('revocation rejected before revalidation and received rows removed', async () => {
    await a.repository.setCalendarShare(sharedId, 'edit');
    await b.repository.load();
    const [completer, deleter] = await Promise.all([memberSnapshot(), memberSnapshot()]);
    const before = await ownerTodos([todoId]);
    await a.repository.setCalendarShare(sharedId, null);
    await assert.rejects(completer.toggleTodo(todoId));
    await assert.rejects(deleter.deleteTodo(todoId));
    await assert.rejects(b.repository.updateEvent(eventId, { title: 'Forbidden revoked write' }));
    assert.deepEqual(await ownerTodos([todoId]), before, 'Revocation preserves the stored todo despite stale completion and deletion attempts');
    assert.ok(!(await b.repository.load()).calendars.some(row => row.id === sharedId), 'Revalidation must remove revoked content');
    assert.ok((await a.repository.load()).events.some(row => row.id === eventId && row.title === 'A newest'), 'Revocation cannot delete owner content');
  });
  await check('real logout and fresh password session preserve personal rows', async () => {
    const signedOut = await b.client.auth.signOut();
    assert.ok(!signedOut.error, 'Local Auth logout must succeed');
    const fresh = createClient(api.href, config.publicKey, options);
    const signed = await fresh.auth.signInWithPassword({ email: b.email, password: b.password });
    assert.ok(!signed.error && signed.data.user?.id === b.id, 'Fresh session must resolve the same account');
    const repository = new SupabaseDayPopRepository(fresh, b.id);
    const restored = await repository.load();
    assert.ok(restored.events.some(row => row.title === 'B personal'), 'B personal data survives logout and new client');
    assert.ok(!restored.calendars.some(row => row.id === sharedId), 'Old received sharing cannot return after login');
    await fresh.auth.signOut();
  });
  assert.equal(checks, expectedChecks, 'Every planned HTTP sharing group must execute');
} catch (cause) {
  console.error(`HTTP sharing failed at: ${stage} (${cause.name})`);
  if (typeof cause.operation === 'string') console.error(`Operation: ${cause.operation}; code: ${cause.cause?.code ?? 'transport'}`);
  // Never dump SDK responses, CLI status, keys, passwords or session objects.
  if (cause instanceof assert.AssertionError) console.error(cause.message.split('\n')[0]);
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
  else console.log(`HTTP sharing cleanup: ${actors.length} synthetic identities removed; ${checks}/${expectedChecks} checks passed.`);
}
