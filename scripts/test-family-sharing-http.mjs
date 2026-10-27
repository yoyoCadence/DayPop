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
const expectedChecks = 17;
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
  const { resolveEventOccurrences } = await vite.ssrLoadModule('/src/domain/recurrence.ts');
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
  let sharedId, eventId, todoId, reverseId;
  const seriesFixtures = [];
  const comparableOccurrence = reference => reference?.kind === 'timed'
    ? { kind: 'timed', startsAt: new Date(reference.startsAt).toISOString() } : reference;
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
    const groupId = created.snapshot.group.id;
    let invitation = await a.family.command({ kind: 'invite', groupId, email: b.email });
    await assert.rejects(a.family.preview(invitation.invitation.token), cause => cause instanceof FamilyError && cause.message.includes('收到邀請的 Email'));
    await b.family.preview(invitation.invitation.token);
    const original = invitation.invitation;
    invitation = await a.family.command({ kind: 'resend', groupId, invitationId: original.id });
    assert.ok(invitation.invitation.id === original.id && invitation.invitation.token !== original.token && invitation.snapshot.invitations.length === 1, 'Resend rotates the same reserved invitation without adding a seat');
    await assert.rejects(b.family.preview(original.token), FamilyError, 'Resend invalidates the original token');
    await a.family.command({ kind: 'revoke', groupId, invitationId: original.id });
    await assert.rejects(b.family.command({ kind: 'accept', token: invitation.invitation.token }), FamilyError, 'Revoked invitation cannot create membership');
    assert.equal((await b.family.load()).group, null, 'Revocation leaves the recipient outside the family');
    invitation = await a.family.command({ kind: 'invite', groupId, email: b.email });
    await b.family.command({ kind: 'decline', token: invitation.invitation.token });
    await assert.rejects(b.family.preview(invitation.invitation.token), FamilyError, 'Declined invitation is terminal');
    invitation = await a.family.command({ kind: 'invite', groupId, email: b.email });
    await b.family.preview(invitation.invitation.token);
    assert.equal((await b.family.load()).group, null, 'Preview cannot silently accept');
    await b.family.command({ kind: 'accept', token: invitation.invitation.token });
    assert.equal((await a.family.load()).members.length, 2, 'Acceptance must persist across clients');
    await assert.rejects(b.family.preview(invitation.invitation.token), FamilyError, 'An accepted token cannot be reused');
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
  await check('reciprocal sharing preserves both owners and the family owner cannot escalate', async () => {
    const created = await b.repository.addCalendar({ name: 'HTTP reverse', color: '#663399' });
    reverseId = created.calendars.find(row => row.name === 'HTTP reverse').id;
    await b.repository.addEvent(event('B shared original', reverseId));
    await b.repository.addEvent(event('B owner private', reverseId, 'private'));
    await b.repository.setCalendarShare(reverseId, 'edit');
    const received = await a.repository.load();
    assert.ok(received.events.some(row => row.title === 'B shared original') && !received.events.some(row => row.title === 'B owner private'), 'Family owner receives only B explicitly shared non-private items');
    assert.ok(received.calendars.filter(calendar => calendar.isDefault).length === 1 && !received.calendars.find(calendar => calendar.id === reverseId).isDefault, 'Receiving B calendar cannot replace A personal default');
    await a.repository.addEvent(event('A authored in B calendar', reverseId));
    const owner = await b.repository.load();
    const authored = owner.events.find(row => row.title === 'A authored in B calendar');
    const row = await b.client.from('events').select('owner_id,created_by').eq('id', authored.id).single();
    assert.ok(!row.error && row.data.owner_id === b.id && row.data.created_by === a.id, 'Reverse shared creation belongs to B with A as actual author');
    await assert.rejects(a.repository.setCalendarShare(reverseId, 'view'));
    const grant = b.repository.sharingSession().shares.find(share => share.calendarId === reverseId);
    const denied = await a.client.rpc('set_calendar_group_share', { p_calendar_id: reverseId, p_permission: 'view', p_expected_updated_at: grant.updatedAt });
    assert.equal(denied.error?.message, 'sharing_calendar_owner_required', 'Family ownership cannot change another calendar owner grant through direct HTTP');
    assert.equal((await b.repository.load()).calendars.filter(calendar => calendar.isDefault).length, 1);
    assert.equal(b.repository.sharingSession().shares.find(share => share.calendarId === reverseId).permission, 'edit');
    assert.ok(!a.repository.personalData().calendars.some(calendar => calendar.id === reverseId) && !b.repository.personalData().calendars.some(calendar => calendar.id === sharedId), 'Neither received calendar enters personal cache/export projection');
    const hidden = await a.client.from('events').select('id').eq('calendar_id', reverseId).eq('sharing_scope', 'private');
    assert.ok(!hidden.error && hidden.data.length === 0, 'Family owner direct HTTP cannot read B private events');
  });
  await check('bidirectional recurring replacements and cancellations persist without duplicating a series', async () => {
    for (const [owner, editor, calendarId, allDay] of [[a, b, sharedId, true], [b, a, reverseId, true], [a, b, sharedId, false], [b, a, reverseId, false]]) {
      await owner.repository.load();
      const shape = allDay ? 'all-day' : 'timed';
      const title = `${owner.label} ${shape} recurring shared`;
      const occurrence = date => allDay ? { kind: 'all-day', date } : { kind: 'timed', startsAt: `${date}T13:00:00.000Z` };
      const created = await owner.repository.addEvent({ ...event(title, calendarId), allDay, timezone: 'America/New_York', recurrenceRule: 'FREQ=DAILY;COUNT=4' });
      const series = created.events.find(row => row.title === title);
      if (!allDay) assert.equal(Date.parse(series.startsAt), Date.parse('2026-10-26T13:00:00.000Z'), 'Timed fixture is 09:00 in New York, not the default viewer timezone');
      await editor.repository.load();
      const replacementTitle = `${editor.label} ${shape} single replacement`;
      await editor.repository.replaceEventOccurrence(series.id, occurrence('2026-10-27'), { title: replacementTitle });
      await editor.repository.cancelEventOccurrence(series.id, occurrence('2026-10-28'));
      const stored = await owner.repository.load();
      const storedSeries = stored.events.find(row => row.id === series.id);
      assert.deepEqual({ ...storedSeries, updatedAt: series.updatedAt }, series, 'Single-occurrence edits preserve series content while advancing its version');
      assert.notEqual(storedSeries.updatedAt, series.updatedAt, 'Occurrence writes advance the shared series CAS version');
      const replacement = stored.events.find(row => row.title === replacementTitle);
      assert.ok(replacement && replacement.recurrence === null && (allDay ? replacement.startDate === '2026-10-27' : Date.parse(replacement.startsAt) === Date.parse('2026-10-27T13:00:00.000Z') && replacement.timezone === 'America/New_York'), 'A separate non-recurring replacement preserves its date or instant and timezone');
      const exceptions = stored.eventExceptions.filter(row => row.eventId === series.id);
      assert.equal(exceptions.length, 2, 'Both occurrence exceptions survive an independent owner reload');
      assert.deepEqual(comparableOccurrence(exceptions.find(row => !row.isCancelled)?.occurrence), occurrence('2026-10-27'));
      assert.equal(exceptions.find(row => !row.isCancelled)?.replacementEventId, replacement.id);
      assert.deepEqual(comparableOccurrence(exceptions.find(row => row.isCancelled)?.occurrence), occurrence('2026-10-28'));
      assert.equal(exceptions.find(row => row.isCancelled)?.replacementEventId, null);
      const raw = await owner.client.from('events').select('owner_id,created_by').eq('id', replacement.id).single();
      assert.ok(!raw.error && raw.data.owner_id === owner.id && raw.data.created_by === editor.id, 'Replacement preserves calendar ownership and records its actual editor');
      const resolved = resolveEventOccurrences(stored, { startDate: '2026-10-26', endDate: '2026-10-29' }).filter(row => row.sourceEventId === series.id);
      assert.deepEqual(resolved.map(row => comparableOccurrence(row.occurrence)).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))), ['2026-10-26', '2026-10-27', '2026-10-29'].map(occurrence), 'Cancelled occurrence stays absent and replacement is rendered once');
      assert.ok(resolved.some(row => row.event.title === replacementTitle && row.replacementEventId === replacement.id));
      seriesFixtures.push({ owner, editor, seriesId: series.id, replacementId: replacement.id, occurrence });
    }
    assert.equal(seriesFixtures.length, 4, 'Both sharing directions cover all-day and timed series');
  });
  await check('recurring stale edits and private graphs are enforced in both directions', async () => {
    for (const { owner, editor, seriesId, replacementId, occurrence } of seriesFixtures) {
      const stale = new SupabaseDayPopRepository(editor.client, editor.id);
      await stale.load();
      await owner.repository.load();
      await owner.repository.updateEvent(seriesId, { title: `${owner.label} newest series` });
      const graphRows = async () => {
        const rows = await Promise.all([
          owner.client.from('events').select('*').in('id', [seriesId, replacementId]).order('id'),
          owner.client.from('event_exceptions').select('*').eq('event_id', seriesId).order('id'),
        ]);
        assert.ok(rows.every(result => !result.error && Array.isArray(result.data)), 'Owner reads the complete persisted recurrence graph');
        return rows.map(result => result.data);
      };
      const before = await graphRows();
      await assert.rejects(stale.replaceEventOccurrence(seriesId, occurrence('2026-10-29'), { title: 'Forbidden stale replacement' }), { message: /內容已被修改/ });
      assert.deepEqual(await graphRows(), before, 'Stale occurrence write leaves the series, replacement and all exceptions untouched');
      await owner.repository.updateEvent(seriesId, { sharingScope: 'private' });
      const hidden = await editor.repository.load();
      assert.ok(!hidden.events.some(row => row.id === seriesId || row.id === replacementId) && !hidden.eventExceptions.some(row => row.eventId === seriesId), 'Private root hides the complete recurrence graph from either receiver');
      const raw = await Promise.all([
        editor.client.from('events').select('id').in('id', [seriesId, replacementId]),
        editor.client.from('event_exceptions').select('id').eq('event_id', seriesId),
      ]);
      assert.ok(raw.every(result => !result.error && result.data.length === 0), 'Private recurrence graph is absent even from direct receiver HTTP');
      await owner.repository.updateEvent(seriesId, { sharingScope: 'inherit' });
      const restored = await editor.repository.load();
      const resolved = resolveEventOccurrences(restored, { startDate: '2026-10-26', endDate: '2026-10-29' }).filter(row => row.sourceEventId === seriesId);
      assert.deepEqual(resolved.map(row => comparableOccurrence(row.occurrence)).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))), ['2026-10-26', '2026-10-27', '2026-10-29'].map(occurrence), 'Owner re-sharing preserves the replacement and cancellation without resurrecting an occurrence');
    }
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
  for (const kind of ['leave', 'remove', 'dissolve']) {
    await check(`family ${kind} revokes stale editors without deleting owned data`, async () => {
      const signed = await b.client.auth.signInWithPassword({ email: b.email, password: b.password });
      assert.ok(!signed.error && signed.data.user?.id === b.id, 'Membership checks use B actual password session');
      const groupId = (await a.family.load()).group.id;
      if ((await b.family.load()).group === null) {
        const invitation = await a.family.command({ kind: 'invite', groupId, email: b.email });
        await b.family.preview(invitation.invitation.token);
        assert.equal((await b.family.load()).group, null, 'A new preview cannot silently restore membership');
        assert.ok(!(await b.repository.load()).calendars.some(row => row.id === sharedId), 'Pending re-invitation cannot restore the existing calendar share');
        await b.family.command({ kind: 'accept', token: invitation.invitation.token });
      } else {
        // Restore the explicit share disabled by the earlier revocation group.
        await a.repository.setCalendarShare(sharedId, 'edit');
      }
      const received = await b.repository.load();
      assert.ok(received.events.some(row => row.id === eventId) && received.todos.some(row => row.id === todoId), 'Accepted membership can read the owner explicitly shared items');
      assert.equal(b.repository.sharingSession().shares.find(row => row.calendarId === sharedId).permission, 'edit');
      const personalBefore = b.repository.personalData();
      const [completer, deleter] = await Promise.all([memberSnapshot(), memberSnapshot()]);
      const ownedRows = async () => {
        const results = await Promise.all(['calendars', 'events', 'todos'].map(table => a.client.from(table).select('*').eq('owner_id', a.id).order('id')));
        assert.ok(results.every(result => !result.error && Array.isArray(result.data)), 'Owner must read persisted personal and shared rows');
        return results.map(result => result.data);
      };
      const ownerBefore = await ownedRows();
      assert.ok(ownerBefore[2].some(row => row.id === todoId && row.owner_id === a.id && row.created_by === b.id), 'Fixture includes the departed member authored todo owned by A');
      const caller = kind === 'leave' ? b.family : a.family;
      await caller.command(kind === 'remove' ? { kind, groupId, memberId: b.id } : { kind, groupId });
      assert.equal((await b.family.load()).group, null, 'Independent member family read confirms membership removal');
      const ownerFamily = await a.family.load();
      if (kind === 'dissolve') {
        assert.equal(ownerFamily.group, null, 'Dissolution removes the group for its owner too');
      } else {
        assert.ok(ownerFamily.group?.id === groupId && ownerFamily.members.length === 1 && ownerFamily.members[0].userId === a.id, 'Owner family persists with only its owner');
      }
      // Each editor still has its own pre-removal edit/version snapshot.
      await assert.rejects(completer.toggleTodo(todoId));
      await assert.rejects(deleter.deleteTodo(todoId));
      await assert.rejects(b.repository.updateEvent(eventId, { title: 'Forbidden departed member write' }));
      assert.deepEqual(await ownedRows(), ownerBefore, 'Membership removal and rejected writes preserve every owner calendar, event and todo row');
      const hidden = await Promise.all([
        b.client.from('calendars').select('id').eq('id', sharedId),
        b.client.from('events').select('id').eq('calendar_id', sharedId),
        b.client.from('todos').select('id').eq('calendar_id', sharedId),
      ]);
      assert.ok(hidden.every(result => !result.error && result.data.length === 0), 'Departed member direct HTTP cannot read the shared calendar or its items');
      const reloaded = await b.repository.load();
      assert.ok(!reloaded.calendars.some(row => row.id === sharedId), 'Reload removes the received calendar');
      assert.deepEqual(b.repository.personalData(), personalBefore, 'Departed member personal data remains unchanged');
      const remaining = await a.repository.load();
      assert.ok(!remaining.calendars.some(row => row.id === reverseId), 'Departed member outgoing share disappears and is not restored by rejoining');
      if (kind === 'dissolve') assert.ok(!a.repository.sharingSession().shares.some(row => row.calendarId === sharedId), 'Dissolution removes the share without deleting its calendar');
    });
  }
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
