// Real independent local Postgres connections; fixed disposable identities.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const container = process.env.DAYPOP_REMINDER_DB_CONTAINER || 'supabase_db_DayPop';
assert.ok(['supabase_db_DayPop', 'supabase_db_DayPopReminders'].includes(container), 'Only named local test stacks are allowed');
const docker = process.env.DAYPOP_DOCKER_BIN || 'docker';
const args = ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
const user = '00000000-0000-4000-8000-000000000920', calendar = '50000000-0000-4000-8000-000000000920', device = '60000000-0000-4000-8000-000000000920';
const prefix = `daypop-reminder-race-${process.pid}`;
let created = false, coordinator;
const workers = [];
function connection(statement, keepOpen = false) {
  const child = spawn(docker, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => resolve({ code, stdout: stdout.trim(), stderr })); });
  if (keepOpen) child.stdin.write(statement); else child.stdin.end(statement);
  return { child, done };
}
async function query(statement) { const result = await connection(statement).done; assert.equal(result.code, 0, 'Local concurrency fixture SQL must succeed'); return result.stdout; }
async function until(statement, expected) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await query(statement) === String(expected)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('Reminder concurrency barrier timed out');
}
async function hold(statement) {
  coordinator = connection(`set application_name='${prefix}-coordinator'; begin; ${statement};\n`, true);
  await until(`select count(*) from pg_stat_activity where application_name='${prefix}-coordinator' and state='idle in transaction';`, 1);
}
async function release() { coordinator.child.stdin.end('commit;\n\\q\n'); assert.equal((await coordinator.done).code, 0, 'Coordinator releases lock'); coordinator = null; }
async function blocked(count) { await until(`select count(*) from pg_stat_activity where application_name like '${prefix}-worker-%' and wait_event_type='Lock';`, count); }
function worker(statement) {
  const value = connection(`set application_name='${prefix}-worker-${workers.length}'; set statement_timeout='20s'; ${statement}`);
  workers.push(value); return value;
}
const service = 'set role service_role;';
const contextVersion = `${service} select public.reminder_sender_context('${device}','${calendar}')->>'version';`;
const claim = (version, hash, fireAt) => `${service} select coalesce(public.claim_reminder_delivery('${device}','${calendar}','${version}','${hash}','${fireAt}')->>'leaseId','none');`;
try {
  console.log(`Reminder concurrency timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  assert.equal(await query(`select count(*) from auth.users where id='${user}';`), '0', 'Never replace an existing identity');
  assert.equal(await query('select count(*) from daypop_reminders.configuration where not enabled and public_key is null and last_tick is null;'), '1', 'Never overwrite installed sender configuration');
  await query(`begin;
    insert into auth.users(id,email,email_confirmed_at) values('${user}','reminder-race@example.test',now());
    insert into public.calendars(id,owner_id,name,color) values('${calendar}','${user}','Reminder race','#336699');
    insert into public.calendar_reminder_settings(user_id,calendar_id,minutes_before,timezone) values('${user}','${calendar}',array[0],'UTC');
    alter table public.calendar_reminder_settings disable trigger reminder_settings_timestamp;
    update public.calendar_reminder_settings set updated_at=now()-interval '1 hour' where user_id='${user}';
    alter table public.calendar_reminder_settings enable trigger reminder_settings_timestamp;
    insert into public.reminder_push_devices(id,user_id,endpoint,p256dh,auth_key,public_key,created_at)
    values('${device}','${user}','https://fcm.googleapis.com/fcm/send/reminder-race','B'||repeat('C',86),repeat('D',22),'B'||repeat('A',86),now()-interval '1 hour');
    update daypop_reminders.configuration set enabled=true,public_key='B'||repeat('A',86),last_tick=now(); commit;`);
  created = true;
  let version = await query(contextVersion);
  assert.match(version, /^[a-f0-9]{64}$/);
  const fireAt = await query('select clock_timestamp();');
  assert.match(fireAt, /^[0-9T:.+Z -]+$/);
  const hash = 'a'.repeat(64);
  await hold(`select id from public.reminder_push_devices where id='${device}' for update`);
  const first = worker(claim(version, hash, fireAt)), second = worker(claim(version, hash, fireAt));
  await blocked(2); await release();
  let results = await Promise.all([first.done, second.done]);
  assert.ok(results.every(result => result.code === 0), 'Both contenders complete without deadlock');
  assert.equal(results.filter(result => result.stdout === 'none').length, 1, 'Exactly one sender loses active lease');
  assert.equal(results.filter(result => /^[a-f0-9-]{36}$/.test(result.stdout)).length, 1, 'Exactly one sender obtains delivery capability');
  assert.equal(await query(`select count(*)||':'||max(attempts) from daypop_reminders.deliveries where device_id='${device}';`), '1:1', 'Only one durable first attempt');
  console.log('Reminder concurrency: two blocked senders, one durable lease passed.');

  const expected = await query(`select updated_at from public.calendar_reminder_settings where user_id='${user}';`);
  assert.match(expected, /^[0-9T:.+Z -]+$/);
  await hold(`select pg_advisory_xact_lock(hashtextextended('daypop-reminders:${user}',0))`);
  const writers = ['09:00', '10:00'].map(time => worker(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);
    select public.set_calendar_reminder('${calendar}',array[0],'UTC','${time}',false,'${expected}');`));
  await blocked(2); await release(); results = await Promise.all(writers.map(value => value.done));
  assert.equal(results.filter(result => result.code === 0).length, 1, 'Only one settings writer commits');
  assert.equal(results.filter(result => result.stderr.includes('reminder_conflict')).length, 1, 'Waiting writer rechecks settings CAS');
  console.log('Reminder concurrency: two stale settings writers, one commit and one conflict passed.');

  // Move only this fixture's rule consent back; exercise a lease which expires
  // WHILE its caller is blocked, not just an already-expired input parameter.
  await query(`begin; alter table public.calendar_reminder_settings disable trigger reminder_settings_timestamp;
    update public.calendar_reminder_settings set updated_at=now()-interval '1 hour' where user_id='${user}';
    alter table public.calendar_reminder_settings enable trigger reminder_settings_timestamp; commit;`);
  version = await query(contextVersion);
  const expiring = await query("select clock_timestamp()-interval '5 minutes'+interval '2 seconds';");
  await hold(`select id from public.reminder_push_devices where id='${device}' for update`);
  const late = worker(claim(version, 'b'.repeat(64), expiring));
  await blocked(1); await new Promise(resolve => setTimeout(resolve, 2200)); await release();
  const lateResult = await late.done;
  assert.equal(lateResult.code, 0, 'Expired blocked sender completes');
  assert.equal(lateResult.stdout, 'none', 'Expiry is evaluated after acquiring device lock');
  assert.equal(await query(`select count(*) from daypop_reminders.deliveries where job_hash='${'b'.repeat(64)}';`), '0', 'Expired blocked sender persists no attempt');
  console.log('Reminder concurrency: lock-wait expiry rejects delivery passed.');
} finally {
  if (coordinator && !coordinator.child.stdin.destroyed) coordinator.child.stdin.end('rollback;\n\\q\n');
  if (coordinator) await coordinator.done;
  await Promise.all(workers.map(value => value.done));
  if (created) {
    await query(`begin; delete from auth.users where id='${user}'; update daypop_reminders.configuration set enabled=false,public_key=null,last_tick=null,last_error=null; commit;`);
    assert.equal(await query(`select count(*) from auth.users where id='${user}';`), '0', 'Synthetic concurrency fixture removed');
    console.log('Reminder concurrency fixtures removed.');
  }
}
