// Execute the actual reviewed operation only in disposable local rollback transactions.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { localSupabaseHttpConfig } from './local-supabase-http.mjs';
const workdir = process.env.DAYPOP_HTTP_WORKDIR;
const status = spawnSync(process.execPath,[resolve('node_modules/supabase/dist/supabase.js'),'status','--output','json',...(workdir?['--workdir',workdir]:[])],
  {encoding:'utf8',windowsHide:true,timeout:30000});
assert.equal(status.status,0,'Start the local HTTP stack first');
const config = localSupabaseHttpConfig(status.stdout);
const container = process.env.DAYPOP_REMINDER_DB_CONTAINER || 'supabase_db_DayPop';
assert.ok(['supabase_db_DayPop','supabase_db_DayPopReminders'].includes(container),'Only disposable local stacks');
assert.equal(config.url.port,container==='supabase_db_DayPopReminders'?'56321':'54321','Local API and SQL stack must match');
const source = readFileSync('supabase/operations/reminder-scheduler.sql','utf8');
const prerequisite = readFileSync('supabase/migrations/20261103000000_reminder_scheduler_extensions.sql','utf8');
assert.ok(!/\b(?:commit|rollback)\s*;/i.test(source+prerequisite),'Fixture sources must not end the enclosing rollback transaction');
const project = '00000000000000000000', token = 'A'.repeat(43), key = 'B'+'A'.repeat(86);
const render = action => source.replaceAll('__DAYPOP_PROJECT_REF__',project).replaceAll('__DAYPOP_REMINDER_ACTION__',action);
const sql = statement => spawnSync(process.env.DAYPOP_DOCKER_BIN || 'docker',
  ['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],
  {input:statement,encoding:'utf8',windowsHide:true,timeout:30000});
const initial = sql("select count(*) from daypop_reminders.configuration where singleton and not enabled and public_key is null and last_tick is null;");
assert.equal(initial.status,0,'Local schema required'); assert.equal(initial.stdout.trim(),'1','Never overwrite installed sender configuration');
const clean = sql("select count(*) from vault.secrets where name in ('daypop_reminder_token','daypop_reminder_vapid_public_key');");
assert.equal(clean.status,0); assert.equal(clean.stdout.trim(),'0','Never overwrite existing scheduler secrets');
function seed({withToken=true,withKey=true,tokenValue=token,keyValue=key}={}) {
  const quote = value => "'"+value.replaceAll("'","''")+"'";
  return `do $fixture$ begin ${withToken?`perform vault.create_secret(${quote(tokenValue)},'daypop_reminder_token');`:''}
    ${withKey?`perform vault.create_secret(${quote(keyValue)},'daypop_reminder_vapid_public_key');`:''} end $fixture$;`;
}
let checks = 0;
function check(name,statement,expectedError) {
  const result = sql('begin;\n'+statement+'\nrollback;');
  if(expectedError) { assert.notEqual(result.status,0,name); assert.ok(result.stderr.includes(expectedError),name+' must fail at its intended guard'); }
  else { assert.equal(result.status,0,name+' failed (SQL output withheld)'); assert.equal(result.stdout.trim(),'t',name); }
  checks++; console.log('Reminder scheduler: '+name+' passed');
}
console.log('Reminder scheduler actual timezone:',Intl.DateTimeFormat().resolvedOptions().timeZone);
check('actual enable, idempotent repeat and disable preserve key and never send HTTP',seed()+render('enable')+`
  create temp table scheduler_before as select jobid from cron.job where jobname='daypop-reminder-minute-v1';
  update daypop_reminders.configuration set last_tick=now() where singleton;
  create temp table health_before as select last_tick from daypop_reminders.configuration;
  `+prerequisite+render('enable')+`
  do $assert$ begin
    if (select count(*) from cron.job where jobname='daypop-reminder-minute-v1' and active and schedule='* * * * *')<>1
      or not exists(select 1 from cron.job j join scheduler_before b using(jobid))
      or (select last_tick from daypop_reminders.configuration) is distinct from (select last_tick from health_before)
      or exists(select 1 from cron.job where jobname='daypop-reminder-minute-v1' and position('${token}' in command)>0)
      then raise exception 'scheduler_idempotency_failed'; end if;
  end $assert$;
  `+render('disable')+render('disable')+`
  select not c.enabled and c.public_key='${key}' and c.last_tick is null
    and not exists(select 1 from cron.job where jobname='daypop-reminder-minute-v1')
    and not exists(select 1 from net.http_request_queue) from daypop_reminders.configuration c where singleton;`);
check('missing token',seed({withToken:false})+render('enable'),'daypop_reminder_scheduler_secrets_required');
check('invalid token',seed({tokenValue:'invalid'})+render('enable'),'daypop_reminder_scheduler_secrets_required');
check('invalid public key',seed({keyValue:'invalid'})+render('enable'),'daypop_reminder_scheduler_secrets_required');
check('missing public key',seed({withKey:false})+render('enable'),'daypop_reminder_scheduler_secrets_required');
check('short token',seed({tokenValue:'A'.repeat(42)})+render('enable'),'daypop_reminder_scheduler_secrets_required');
check('long token',seed({tokenValue:'A'.repeat(257)})+render('enable'),'daypop_reminder_scheduler_secrets_required');
check('non-url-safe token',seed({tokenValue:'A'.repeat(42)+'+'})+render('enable'),'daypop_reminder_scheduler_secrets_required');
check('maximum token length',seed({tokenValue:'A'.repeat(256)})+render('enable')+`select enabled from daypop_reminders.configuration where singleton;`);
check('unbound enabled configuration recovery',seed()+`update daypop_reminders.configuration set enabled=true;`+render('enable')
  +`select enabled and public_key='${key}' and last_tick is null from daypop_reminders.configuration where singleton;`);
const lfOperation = render('enable').replaceAll('\r\n','\n');
check('LF and CRLF keep the same job identity',seed()+lfOperation+lfOperation.replaceAll('\n','\r\n')+render('disable')
  +`select not enabled and not exists(select 1 from cron.job where jobname='daypop-reminder-minute-v1') from daypop_reminders.configuration where singleton;`);
check('application role denied',seed()+`set local role authenticated;`+render('enable'),'daypop_reminder_scheduler_owner_required');
check('unrendered operation',source,'daypop_reminder_scheduler_project_required');
check('unknown action',render('other'),'daypop_reminder_scheduler_action_required');
check('implicit key rotation',seed()+`update daypop_reminders.configuration set public_key='B'||repeat('C',86);`+render('enable'),'daypop_reminder_scheduler_key_rotation_requires_review');
const collision = `select cron.schedule('daypop-reminder-minute-v1','0 0 1 1 *','select 1');`;
check('reserved job collision',seed()+collision+render('enable'),'daypop_reminder_scheduler_job_name_conflict');
// No real job is ever committed, so even a failed assertion cannot cause a cron HTTP request.
check('disable without secrets preserves another command',`do $fixture$ begin perform cron.schedule('daypop-reminder-minute-v1','0 0 1 1 *','select 1'); end $fixture$;`
  +render('disable')+`select not c.enabled and exists(select 1 from cron.job where jobname='daypop-reminder-minute-v1' and command='select 1') from daypop_reminders.configuration c where singleton;`);
const after = sql("select not enabled and public_key is null and last_tick is null and not exists(select 1 from cron.job where jobname='daypop-reminder-minute-v1') and not exists(select 1 from net.http_request_queue) and not exists(select 1 from vault.secrets where name in ('daypop_reminder_token','daypop_reminder_vapid_public_key')) from daypop_reminders.configuration where singleton;");
assert.equal(after.status,0); assert.equal(after.stdout.trim(),'t','Rollback restores configuration, Vault and jobs');
console.log(`Reminder scheduler: ${checks}/${checks}; all fake secrets/jobs rolled back; no queued HTTP.`);
