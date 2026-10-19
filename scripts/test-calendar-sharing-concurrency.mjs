// Fixed synthetic local Docker fixtures only. Two devices submit the SAME
// server version while a third connection holds the calendar serialization lock.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const docker=process.env.DAYPOP_DOCKER_BIN || 'docker';
const args=['exec','-i','supabase_db_DayPop','psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'];
const owner='00000000-0000-4000-8000-00000000048f';
const event='10000000-0000-4000-8000-00000000048f';
const prefix=`daypop-sharing-race-${process.pid}`;
function connection(sql,keepOpen=false) {
  const child=spawn(docker,args,{stdio:['pipe','pipe','pipe'],windowsHide:true});let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve({code,stdout:stdout.trim(),stderr}));});
  if(keepOpen)child.stdin.write(sql);else child.stdin.end(sql);
  return {child,done};
}
async function query(sql) {const result=await connection(sql).done;assert.equal(result.code,0,result.stderr);return result.stdout;}
async function until(sql,expected) {
  for(let attempt=0;attempt<60;attempt++) {
    if(await query(sql)===String(expected))return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('Local sharing concurrency barrier timed out');
}
let created=false,coordinator;const workers=[];
try {
  assert.equal(await query(`select count(*) from auth.users where id='${owner}';`),'0','never remove an existing fixture to make room');
  await query(`begin;
    insert into auth.users(id,email,email_confirmed_at) values('${owner}','sharing-race@example.test',now());
    set local role authenticated;select set_config('request.jwt.claim.sub','${owner}',true);
    do $$declare calendar_id uuid;begin
      perform public.family_command('create','{"name":"Sharing race"}');
      select id into calendar_id from public.calendars where owner_id='${owner}' and is_default;
      perform public.set_calendar_group_share(calendar_id,'edit',null);
      insert into public.events(id,owner_id,calendar_id,title,is_all_day,start_date,end_date)
      values('${event}','${owner}',calendar_id,'Before race',true,'2026-10-19','2026-10-19');
    end$$;commit;`);
  created=true;
  const row=JSON.parse(await query(`select json_build_object('calendar',calendar_id,'version',updated_at) from public.events where id='${event}';`));
  assert.match(row.calendar,/^[0-9a-f-]{36}$/);assert.match(row.version,/^[0-9T:.+Z -]+$/);
  coordinator=connection(`set application_name='${prefix}-coordinator';begin;select id from public.calendars where id='${row.calendar}' for update;\n`,true);
  await until(`select count(*) from pg_stat_activity where application_name='${prefix}-coordinator' and state='idle in transaction';`,1);
  for(const name of ['a','b'])workers.push(connection(`set application_name='${prefix}-${name}';set statement_timeout='20s';
    set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);
    select public.write_shared_calendar_item('update_event',jsonb_build_object('id','${event}','values',jsonb_build_object(
      'calendar_id','${row.calendar}','title','Winner ${name}','is_all_day',true,'start_date','2026-10-19','end_date','2026-10-19','sharing_scope','inherit')),
      jsonb_build_object('events',jsonb_build_object('${event}','${row.version}')));`));
  await until(`select count(*) from pg_stat_activity where application_name in ('${prefix}-a','${prefix}-b') and wait_event_type='Lock';`,2);
  coordinator.child.stdin.end('commit;\n\\q\n');await coordinator.done;
  const results=await Promise.all(workers.map(worker=>worker.done));
  assert.equal(results.filter(result=>result.code===0).length,1,'exactly one stale-version competitor may commit');
  assert.equal(results.filter(result=>result.stderr.includes('sharing_conflict')).length,1,'the second writer must recheck the version after waiting');
  assert.match(await query(`select title from public.events where id='${event}';`),/^Winner [ab]$/);
  console.log('Sharing concurrency passed: two locked writers, one commit, one sharing_conflict.');
} finally {
  if(coordinator && !coordinator.child.stdin.destroyed)coordinator.child.stdin.end('rollback;\n\\q\n');
  if(coordinator)await coordinator.done;
  await Promise.all(workers.map(worker=>worker.done));
  if(created) {
    await query(`delete from auth.users where id='${owner}';`);
    assert.equal(await query(`select count(*) from auth.users where id='${owner}';`),'0');
    console.log('Sharing concurrency fixtures removed.');
  }
}
