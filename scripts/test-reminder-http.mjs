// Real local Auth/PostgREST + production repositories/planner, never push HTTP.
// Synthetic subscriptions are intentionally not valid delivery destinations.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createServer } from 'vite';
import { localSupabaseHttpConfig, localSupabaseFetch } from './local-supabase-http.mjs';

const workdir = process.env.DAYPOP_HTTP_WORKDIR;
const status = spawnSync(process.execPath, [resolve('node_modules/supabase/dist/supabase.js'), 'status', '--output', 'json',
  ...(workdir ? ['--workdir', workdir] : [])], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
assert.equal(status.status, 0, 'Start the local HTTP stack first');
const config = localSupabaseHttpConfig(status.stdout);
const container = process.env.DAYPOP_REMINDER_DB_CONTAINER || 'supabase_db_DayPop';
assert.ok(['supabase_db_DayPop', 'supabase_db_DayPopReminders'].includes(container), 'Only named local test stacks are allowed');
assert.equal(config.url.port, container === 'supabase_db_DayPopReminders' ? '56321' : '54321', 'HTTP API and fixture database must identify the same local stack');
function sql(statement) {
  const result = spawnSync(process.env.DAYPOP_DOCKER_BIN || 'docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: statement, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(result.status, 0, 'Local fixture SQL must succeed (details withheld)');
  return result.stdout.trim();
}
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: localSupabaseFetch(config.url) } };
const admin = createClient(config.url.href, config.adminKey, options);
const anonymous = createClient(config.url.href, config.publicKey, options);
const actors = [];
let vite, touchedConfig = false, checks = 0, stage = 'setup';
const expectedChecks = 11;
async function rpc(client, name, args = {}) {
  const response = await client.rpc(name, args);
  assert.ok(!response.error, `${name} must succeed`);
  return response.data;
}
async function check(name, operation) { stage = name; await operation(); checks++; console.log(`Reminder HTTP: ${name} passed`); }
async function actor() {
  const email = `daypop-reminder-${randomUUID()}@example.test`, password = randomUUID() + randomUUID();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ok(!created.error && created.data.user, 'Create fresh local synthetic account');
  const value = { id: created.data.user.id, email, client: createClient(config.url.href, config.publicKey, options) };
  actors.push(value);
  const signed = await value.client.auth.signInWithPassword({ email, password });
  assert.ok(!signed.error && signed.data.session, 'Real password sign-in must issue session');
  return value;
}
const publicKey = 'B' + 'A'.repeat(86), encryptionKey = 'B' + 'C'.repeat(86), authKey = 'D'.repeat(22);
const endpoint = 'https://fcm.googleapis.com/fcm/send/daypop-test-' + randomUUID();
const subscription = { p_endpoint: endpoint, p_p256dh: encryptionKey, p_auth: authKey, p_public_key: publicKey };
try {
  console.log(`Reminder HTTP environment: ${config.url.origin}; timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  assert.equal(sql("select count(*) from daypop_reminders.configuration where singleton and not enabled and public_key is null and last_tick is null;"), '1', 'Never overwrite an installed sender configuration');
  vite = await createServer({ configFile: false, envFile: false, logLevel: 'error', server: { middlewareMode: true, watch: null },
    ssr: { noExternal: ['rrule'] }, define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version), __DATA_SCHEMA_VERSION__: '4' } });
  const { SupabaseDayPopRepository } = await vite.ssrLoadModule('/src/data/supabaseRepository.ts');
  const { SupabaseFamilyService } = await vite.ssrLoadModule('/src/family/familyService.ts');
  const { planReminders } = await vite.ssrLoadModule('/src/reminders/schedule.ts');
  const a = await actor(), b = await actor();
  const repository = new SupabaseDayPopRepository(a.client, a.id);
  const familyA = new SupabaseFamilyService(a.client, a.id), familyB = new SupabaseFamilyService(b.client, b.id);
  let source, destination, series, replacement, independent, visibleTodo, device, group, rule;
  // Use one complete UTC alarm date/time, including the UTC-midnight boundary.
  const alarmInstant = new Date(Date.now() - 60_000).toISOString();
  const date = alarmInstant.slice(0, 10), alarm = alarmInstant.slice(11, 16);
  const event = (title, calendarId, extra = {}) => ({ title, calendarId, date, allDay: true, start: '09:00', end: '10:00', ...extra });
  const context = () => rpc(admin, 'reminder_sender_context', { p_device_id: device, p_calendar_id: destination });
  const claim = (version, hash, fireAt) => rpc(admin, 'claim_reminder_delivery', { p_device_id: device, p_calendar_id: destination, p_version: version, p_job_hash: hash, p_fire_at: fireAt });
  const hash = job => createHash('sha256').update(job.key).digest('hex');
  let now, planned, initial;

  await check('disabled defaults and unshared recipient rejection', async () => {
    assert.equal((await rpc(b.client, 'reminder_capabilities')).enabled, false, 'Backend starts unavailable');
    assert.ok((await b.client.rpc('register_reminder_device', subscription)).error, 'Disabled registration must fail');
    assert.ok((await anonymous.rpc('reminder_sender_page')).error, 'Anonymous sender invocation must fail');
    await repository.load();
    source = (await repository.addCalendar({ name: 'Reminder source', color: '#336699' })).calendars.find(row => row.name === 'Reminder source').id;
    destination = (await repository.addCalendar({ name: 'Reminder destination', color: '#336699' })).calendars.find(row => row.name === 'Reminder destination').id;
    assert.ok((await b.client.rpc('set_calendar_reminder', { p_calendar_id: destination, p_minutes_before: [0], p_timezone: 'UTC', p_date_time: '09:00', p_include_todos: true })).error, 'Unshared calendar cannot be enabled by recipient');
  });
  await check('real invitation acceptance and calendar view opt-in', async () => {
    series = (await repository.addEvent(event('SECRET series', source, { recurrenceRule: 'FREQ=DAILY' }))).events.find(row => row.title === 'SECRET series').id;
    let data = await repository.replaceEventOccurrence(series, { kind: 'all-day', date }, { calendarId: destination });
    replacement = data.eventExceptions.find(row => row.eventId === series).replacementEventId;
    independent = (await repository.addEvent(event('SECRET independent', destination))).events.find(row => row.title === 'SECRET independent').id;
    await repository.addEvent(event('SECRET private', destination, { sharingScope: 'private' }));
    visibleTodo = (await repository.addTodo({ title: 'SECRET visible todo', calendarId: destination, date })).todos.find(row => row.title === 'SECRET visible todo').id;
    data = await repository.addTodo({ title: 'SECRET hidden parent', calendarId: destination, date, sharingScope: 'private' });
    await repository.addTodo({ title: 'SECRET hidden child', parentId: data.todos.find(row => row.title === 'SECRET hidden parent').id, calendarId: destination, date });
    group = (await familyA.command({ kind: 'create', name: 'Reminder HTTP family' })).snapshot.group.id;
    const invited = await familyA.command({ kind: 'invite', groupId: group, email: b.email });
    await familyB.command({ kind: 'accept', token: invited.invitation.token });
    await repository.setCalendarShare(source, 'view');
    await repository.setCalendarShare(destination, 'view');
    rule = await rpc(b.client, 'set_calendar_reminder', { p_calendar_id: destination, p_minutes_before: [0], p_timezone: 'UTC', p_date_time: alarm, p_include_todos: true });
  });
  await check('HTTP owner isolation, CAS and client sender denial', async () => {
    const [own, other] = await Promise.all([b.client.from('calendar_reminder_settings').select('*'), a.client.from('calendar_reminder_settings').select('*')]);
    assert.ok(!own.error && own.data.length === 1 && !other.error && other.data.length === 0, 'Each account reads only its own reminder rules');
    assert.ok((await b.client.rpc('set_calendar_reminder', { p_calendar_id: destination, p_minutes_before: [0], p_timezone: 'UTC', p_date_time: '09:00', p_include_todos: false })).error, 'Stale settings are rejected');
    assert.ok((await b.client.from('calendar_reminder_settings').update({ user_id: a.id }).eq('calendar_id', destination)).error, 'Direct ownership update is forbidden');
    assert.ok((await b.client.rpc('reminder_sender_context', { p_device_id: randomUUID(), p_calendar_id: destination })).error, 'Signed-in user cannot invoke sender');
    assert.ok((await b.client.rpc('reminder_sender_heartbeat')).error, 'Signed-in user cannot spoof heartbeat');
  });
  await check('fresh heartbeat, idempotent devices and secret column denial', async () => {
    sql(`update daypop_reminders.configuration set enabled=true,public_key='${publicKey}';`); touchedConfig = true;
    assert.equal((await rpc(b.client, 'reminder_capabilities')).enabled, false, 'Configuration alone cannot claim readiness');
    await rpc(admin, 'reminder_sender_heartbeat');
    assert.equal((await rpc(b.client, 'reminder_capabilities')).enabled, true, 'Heartbeat confirms local readiness');
    assert.ok((await b.client.rpc('register_reminder_device', { ...subscription, p_endpoint: 'https://fcm.googleapis.com.evil.test/push' })).error, 'Unapproved push host is rejected');
    device = await rpc(b.client, 'register_reminder_device', subscription);
    assert.equal(await rpc(b.client, 'register_reminder_device', subscription), device, 'Registration retry reuses same device');
    await rpc(a.client, 'register_reminder_device', { ...subscription, p_endpoint: endpoint + '-a' });
    assert.ok((await b.client.from('reminder_push_devices').select('endpoint,p256dh,auth_key')).error, 'Capabilities cannot be read by owner');
    const owned = await b.client.from('reminder_push_devices').select('id,user_id');
    assert.ok(!owned.error && owned.data.length === 1 && owned.data[0].user_id === b.id, 'Device metadata is isolated by real JWT');
  });
  await check('authorized cross-calendar graph feeds the actual planner', async () => {
    // Local fixture time travel only: represent previously created items and
    // explicit consent. Production still uses server-owned insertion times.
    sql(`begin;
      alter table public.events disable trigger events_set_updated_at;
      update public.events set created_at=now()-interval '1 hour' where owner_id='${a.id}';
      alter table public.events enable trigger events_set_updated_at;
      alter table public.todos disable trigger todos_set_updated_at;
      update public.todos set created_at=now()-interval '1 hour' where owner_id='${a.id}';
      alter table public.todos enable trigger todos_set_updated_at;
      alter table public.calendar_reminder_settings disable trigger reminder_settings_timestamp;
      update public.calendar_reminder_settings set updated_at=now()-interval '1 hour' where user_id='${b.id}';
      alter table public.calendar_reminder_settings enable trigger reminder_settings_timestamp;
      update public.reminder_push_devices set created_at=now()-interval '1 hour' where user_id='${b.id}'; commit;`);
    initial = await context(); now = new Date().toISOString();
    assert.ok(initial && initial.snapshot.events.some(row => row.id === series), 'Destination includes the original source from the other calendar');
    assert.equal(initial.snapshot.events.length, 3, 'Private event omitted from complete graph');
    assert.equal(initial.snapshot.todos.length, 1, 'Private parent and child omitted');
    assert.ok(!JSON.stringify(initial).includes('SECRET'), 'Context contains no private text');
    planned = planReminders(initial.snapshot, [initial.rule], now);
    assert.equal(planned.issues.length, 0, 'Authorized HTTP graph must be accepted by canonical resolver');
    assert.equal(planned.jobs.length, 3, 'Moved occurrence, independent event and visible todo all remain due');
    assert.ok(planned.jobs.some(job => job.sourceId === series && job.effectiveEventId === replacement), 'Moved event retains original identity');
    const page = await rpc(admin, 'reminder_sender_page');
    assert.equal(page.length, 1, 'A device without explicit rules is not scheduled');
    assert.equal(page[0].deviceId, device, 'Only recipient opted-in device is scheduled');
  });
  await check('real HTTP claim deduplicates and sent jobs remain terminal', async () => {
    const job = planned.jobs.find(row => row.sourceId === series), jobHash = hash(job);
    assert.equal(await claim('stale', jobHash, job.fireAt), null, 'Stale context cannot obtain secrets');
    const lease = await claim(initial.version, jobHash, job.fireAt);
    assert.ok(lease?.leaseId, 'A due job receives one lease');
    assert.equal(await claim(initial.version, jobHash, job.fireAt), null, 'Concurrent retry cannot receive an active lease');
    await rpc(admin, 'finish_reminder_delivery', { p_device_id: device, p_job_hash: jobHash, p_lease_id: lease.leaseId, p_result: 'sent' });
    assert.equal(await claim(initial.version, jobHash, job.fireAt), null, 'Finished delivery cannot be repeated');
  });
  await check('real title edits and todo completion invalidate old versions', async () => {
    await repository.load(); await repository.updateEvent(independent, { title: 'SECRET renamed' });
    const renamed = await context();
    assert.notEqual(renamed.version, initial.version, 'Event version changes even when text is stripped');
    assert.deepEqual(planReminders(renamed.snapshot, [renamed.rule], now).jobs.map(row => row.key), planned.jobs.map(row => row.key), 'Title edit keeps stable logical job identities');
    const todoJob = planned.jobs.find(row => row.sourceKind === 'todo');
    assert.equal(await claim(initial.version, hash(todoJob), todoJob.fireAt), null, 'Old event snapshot is rejected');
    await repository.toggleTodo(visibleTodo);
    const completed = await context();
    assert.equal(planReminders(completed.snapshot, [completed.rule], now).jobs.length, 2, 'Completed todo no longer planned');
    assert.equal(await claim(renamed.version, hash(todoJob), todoJob.fireAt), null, 'Completed todo cannot use older snapshot');
  });
  await check('private replacement and revoked source share hide complete graph', async () => {
    await repository.updateEvent(replacement, { sharingScope: 'private' });
    const hidden = await context();
    assert.equal(hidden.snapshot.events.length, 1, 'Private replacement hides source as well');
    const job = planned.jobs.find(row => row.sourceId === series);
    assert.equal(await claim(initial.version, hash(job), job.fireAt), null, 'Private graph rejects original version');
    await repository.updateEvent(replacement, { sharingScope: 'inherit' });
    assert.equal((await context()).snapshot.events.length, 3, 'Owner may restore entire graph');
    await repository.setCalendarShare(source, null);
    assert.equal((await context()).snapshot.events.length, 1, 'Unshared source suppresses entire moved graph');
  });
  await check('account switch requires proven capability and removes old deliveries', async () => {
    const oldDevice = device;
    assert.ok((await a.client.rpc('register_reminder_device', { ...subscription, p_auth: 'X'.repeat(22) })).error, 'Endpoint alone cannot transfer subscription');
    const transferred = await rpc(a.client, 'register_reminder_device', subscription);
    assert.notEqual(transferred, oldDevice, 'Account transfer establishes new registration boundary');
    assert.equal(await context(), null, 'Old device context disappears after transfer');
    assert.equal(sql(`select count(*) from daypop_reminders.deliveries where device_id='${oldDevice}';`), '0', 'Transfer cascades old delivery ledger');
    await rpc(b.client, 'unregister_reminder_device', { p_device_id: transferred });
    assert.equal((await a.client.from('reminder_push_devices').select('id').eq('id', transferred)).data.length, 1, 'Previous user cannot unregister new account device');
    device = await rpc(b.client, 'register_reminder_device', subscription);
    const fresh = await context(), job = planned.jobs[0];
    assert.equal(await claim(fresh.version, hash(job), job.fireAt), null, 'New registration never backfills old due jobs');
  });
  await check('membership revocation removes sender authorization', async () => {
    await familyB.command({ kind: 'leave', groupId: group });
    assert.equal(await context(), null, 'Departed member cannot get sender context');
    const job = planned.jobs[0];
    assert.equal(await claim(initial.version, hash(job), job.fireAt), null, 'Old version cannot survive membership removal');
    const ownRule = await b.client.from('calendar_reminder_settings').select('updated_at').single();
    rule = await rpc(b.client, 'set_calendar_reminder', { p_calendar_id: destination, p_minutes_before: [], p_timezone: 'UTC', p_date_time: '09:00', p_include_todos: false, p_expected_updated_at: ownRule.data.updated_at });
    assert.equal(rule.updatedAt, null, 'Lost-access recipient can explicitly disable own rule');
  });
  await check('unregister and heartbeat failure stay fail closed', async () => {
    await rpc(b.client, 'unregister_reminder_device', { p_device_id: device });
    assert.equal(await context(), null, 'Unregistered device has no sender context');
    sql("update daypop_reminders.configuration set last_tick=now()-interval '6 minutes';");
    assert.equal((await rpc(a.client, 'reminder_capabilities')).enabled, false, 'Stopped backend cannot advertise readiness');
    assert.ok((await b.client.rpc('register_reminder_device', subscription)).error, 'Stale heartbeat refuses new registration');
  });
  assert.equal(checks, expectedChecks, 'All HTTP groups must execute');
} catch (cause) {
  console.error(`Reminder HTTP failed at: ${stage} (${cause.name})`);
  if (cause instanceof assert.AssertionError) console.error(cause.message.split('\n')[0]);
  process.exitCode = 1;
} finally {
  let failed = false;
  for (const value of actors) {
    try {
      const removed = await admin.auth.admin.deleteUser(value.id);
      const gone = await admin.auth.admin.getUserById(value.id);
      if (removed.error || gone.data.user !== null) failed = true;
    } catch { failed = true; }
  }
  try { if (touchedConfig) sql('update daypop_reminders.configuration set enabled=false,public_key=null,last_tick=null,last_error=null;'); } catch { failed = true; }
  if (vite) await vite.close();
  if (failed) { console.error('Reminder HTTP cleanup failed'); process.exitCode = 1; }
  else console.log(`Reminder HTTP cleanup: ${actors.length} synthetic accounts removed; ${checks}/${expectedChecks} groups passed.`);
}
