// DP-049: deliberately weaken ONLY the local Docker transaction, require the
// same matrix to fail, then prove the unchanged baseline still passes. No URL,
// linked project, committed fixtures or remote mutation is accepted here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const docker=process.env.DAYPOP_DOCKER_BIN || 'docker';
assert.equal(process.argv.length,2,'this control accepts no URL, linked-project flag or other arguments');
const context=spawnSync(docker,['context','inspect','--format','{{json .Endpoints.docker.Host}}'],{encoding:'utf8',windowsHide:true});
if(context.error)throw context.error;
assert.equal(context.status,0,'cannot verify the Docker context');
const endpoint=process.env.DOCKER_HOST || JSON.parse(context.stdout);
assert.match(endpoint,/^(unix|npipe):\/\//,'permission control requires a local Unix/npipe Docker endpoint');
const args=['exec','-i','supabase_db_DayPop','psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'];
function sql(input) {
  const result=spawnSync(docker,args,{input,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
  if(result.error)throw result.error;
  assert.equal(result.status,0,result.stderr);
  return result.stdout.trim();
}
const ids=['491','492','493','494','495'].map(suffix=>`'00000000-0000-4000-8000-000000000${suffix}'`).join(',');
function probe() {
  return JSON.parse(sql(`select json_build_object(
    'users',(select count(*) from auth.users where id in (${ids})),
    'policy',(select count(*) from pg_policies where schemaname='public' and policyname='dp049_negative_select'),
    'pgtap',exists(select 1 from pg_extension where extname='pgtap'));`));
}
const before=probe();
assert.equal(before.users,0,'never remove an existing fixture to make room');
assert.equal(before.policy,0,'never replace an existing policy');
const source=readFileSync(new URL('../supabase/tests/database/family_sharing_permissions.test.sql',import.meta.url),'utf8');
assert.equal((source.match(/^begin;\r?$/gm)||[]).length,1,'one explicit transaction');
assert.ok(source.trimEnd().endsWith('rollback;'),'the entire matrix must roll back');
assert.ok(!/^\s*commit\b/im.test(source),'the matrix must not commit fixtures');
const weakened=source.replace(/^begin;\r?$/m,
  'begin;\ncreate policy dp049_negative_select on public.events for select to authenticated using (true);');
function matrix(input) {
  const output=sql(input);
  const plan=output.match(/^1\.\.(\d+)\r?$/m);
  assert.ok(plan,'matrix must reach finish(), not abort before its assertions');
  return {total:Number(plan[1]),failed:(output.match(/^not ok \d+/gm)||[]).length};
}
for(let round=1;round<=2;round++) {
  const red=matrix(weakened);
  assert.ok(red.failed>0,'permissive SELECT must be detected by the matrix');
  const green=matrix(source);
  assert.equal(green.total,red.total,'control and baseline run the same assertions');
  assert.equal(green.failed,0,'baseline must pass after the weakened transaction rolls back');
  assert.deepEqual(probe(),before,'fixed users, policy and extension state must be unchanged');
  console.log(`Permission control ${round}: ${red.failed} expected failures under permissive SELECT; restored baseline ${green.total}/${green.total} passed.`);
}
console.log('Permission control left zero fixed users or policy changes; local Docker only.');
