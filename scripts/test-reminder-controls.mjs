// Mutate only the disposable local DB function, never remote or source files.
// Run the real HTTP fixture; finally restore and compare the exact definition.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const container = process.env.DAYPOP_REMINDER_DB_CONTAINER || 'supabase_db_DayPop';
assert.ok(['supabase_db_DayPop', 'supabase_db_DayPopReminders'].includes(container), 'Only named local test stacks are allowed');
const docker = process.env.DAYPOP_DOCKER_BIN || 'docker';
function query(statement) {
  const result = spawnSync(docker, ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: statement, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(result.status, 0, 'Local negative-control SQL must succeed');
  return result.stdout.trim();
}
const controls = [
  { name: 'data version', signature: 'public.claim_reminder_delivery(text,uuid,uuid,text,text,timestamptz)',
    before: "context->>'version' is distinct from p_version", after: 'false', expected: 'Reminder HTTP failed at: real HTTP claim deduplicates and sent jobs remain terminal' },
  { name: 'current calendar permission', signature: 'daypop_reminders.calendar_context(uuid,uuid)',
    before: 'if daypop_family.calendar_access(p_calendar_id) is null then', after: 'if false then', expected: 'Reminder HTTP failed at: membership revocation removes sender authorization' },
  { name: 'runtime key at claim', signature: 'public.claim_reminder_delivery(text,uuid,uuid,text,text,timestamptz)',
    before: 'device.public_key is distinct from p_public_key', after: 'false', expected: 'Reminder HTTP failed at: overlapping old runtime cannot consume a rotated-key delivery' },
];
for (const control of controls) {
  const read = `select pg_get_functiondef('${control.signature}'::regprocedure);`;
  const original = query(read);
  assert.equal(original.split(control.before).length, 2, 'Mutation target must occur exactly once');
  try {
    query(original.replace(control.before, control.after));
    const result = spawnSync(process.execPath, ['scripts/test-reminder-http.mjs'], { encoding: 'utf8', windowsHide: true, timeout: 90_000 });
    assert.equal(result.status, 1, 'Disabling a notification boundary must fail the real HTTP fixture');
    assert.ok(result.stderr.includes(control.expected), 'Negative control must fail at the intended independent assertion');
    assert.ok(result.stdout.includes('synthetic accounts removed;'), 'Even negative control must clean up both accounts');
    console.log(`Reminder negative control: removed ${control.name} detected.`);
  } finally {
    query(original);
    assert.equal(query(read), original, 'Original database function restored byte for byte');
    console.log(`Reminder restored function SHA256: ${createHash('sha256').update(original).digest('hex')}`);
  }
}
