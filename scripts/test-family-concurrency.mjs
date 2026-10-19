// Local Docker only. No DATABASE_URL, linked project, network endpoint or key.
// Both callers must be waiting on locks before the coordinator opens the gate:
// with the group lock one waits on the group, without it both have already
// passed the capacity check. Removing that lock makes this test reserve seat 7.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const docker = process.env.DAYPOP_DOCKER_BIN || 'docker';
const args = ['exec', '-i', 'supabase_db_DayPop', 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
const owner = '00000000-0000-4000-8000-00000000047f';
const prefix = `daypop-family-race-${process.pid}`;
const functionName = `family_race_pause_${process.pid}`;
const gate = 1400000000 + process.pid;
function connection(sql, keepOpen = false) {
  const child = spawn(docker, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => resolve({ code, stdout: stdout.trim(), stderr }));
  });
  if (keepOpen) child.stdin.write(sql); else child.stdin.end(sql);
  return { child, done };
}
async function query(sql) {
  const result = await connection(sql).done;
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
}
async function until(sql, expected) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await query(sql) === String(expected)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('Local family concurrency barrier timed out');
}
let created = false;
let coordinator;
const workers = [];
try {
  // Existing fixtures are never deleted to make room for this test.
  assert.equal(await query(`select count(*) from auth.users where id='${owner}';`), '0', 'fixed local race identity must not already exist');
  await query(`begin;
    insert into auth.users(id,email,email_confirmed_at) values('${owner}','family-race@example.test',now());
    set local role authenticated;
    select set_config('request.jwt.claim.sub','${owner}',true);
    do $$begin
      perform public.family_command('create','{"name":"Race fixture"}');
      for i in 1..4 loop
        perform public.family_command('invite',jsonb_build_object('groupId',public.family_snapshot() #> '{group,id}','email','seed-'||i||'@example.test'));
      end loop;
    end$$;
    reset role;
    create function public.${functionName}() returns trigger language plpgsql set search_path='' as $$begin
      if new.invited_by='${owner}' and new.email like 'race-%@example.test' then perform pg_advisory_xact_lock(${gate}::bigint); end if;
      return new;
    end$$;
    create trigger ${functionName} before insert on public.family_invitations for each row execute function public.${functionName}();
    commit;`);
  created = true;
  coordinator = connection(`set application_name='${prefix}-coordinator'; select pg_advisory_lock(${gate}::bigint);\n`, true);
  await until(`select count(*) from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='${prefix}-coordinator' and l.locktype='advisory' and l.granted;`, 1);
  for (const name of ['a', 'b']) workers.push(connection(`
    set application_name='${prefix}-${name}';
    set statement_timeout='20s';
    set role authenticated;
    select set_config('request.jwt.claim.sub','${owner}',false);
    do $$begin perform public.family_command('invite',jsonb_build_object('groupId',public.family_snapshot() #> '{group,id}','email','race-${name}@example.test')); end$$;`));
  await until(`select count(*) from pg_stat_activity where application_name in ('${prefix}-a','${prefix}-b') and wait_event_type='Lock';`, 2);
  coordinator.child.stdin.end(`select pg_advisory_unlock(${gate}::bigint);\n\\q\n`);
  await coordinator.done;
  const results = await Promise.all(workers.map(worker => worker.done));
  assert.equal(results.filter(result => result.code === 0).length, 1, 'exactly one caller may reserve the final seat');
  assert.equal(results.filter(result => result.stderr.includes('family_full')).length, 1, 'the other caller must recheck capacity after the lock');
  assert.equal(await query(`select (select count(*) from public.family_memberships where user_id='${owner}')+(select count(*) from public.family_invitations where invited_by='${owner}' and status='pending' and expires_at>clock_timestamp());`), '6', 'two connections cannot reserve a seventh seat');
  console.log('Family concurrency passed: two locked callers, one final seat, one family_full, six total reservations.');
} finally {
  if (coordinator && !coordinator.child.stdin.destroyed) coordinator.child.stdin.end('\\q\n');
  if (coordinator) await coordinator.done;
  await Promise.all(workers.map(worker => worker.done));
  if (created) {
    await query(`begin; drop trigger ${functionName} on public.family_invitations; drop function public.${functionName}(); delete from auth.users where id='${owner}'; commit;`);
    assert.equal(await query(`select count(*) from auth.users where id='${owner}';`), '0', 'no synthetic identity remains');
    console.log('Family concurrency fixtures and trigger removed.');
  }
}
