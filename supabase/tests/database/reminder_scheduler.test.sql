begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(exists(select 1 from pg_extension where extname='pg_cron'),'scheduler extension installed by migrations');
select ok(exists(select 1 from pg_extension where extname='pg_net'),'database HTTP extension installed by migrations');
select is((select enabled from daypop_reminders.configuration),false,'installing prerequisites does not enable reminders');
select is((select count(*) from cron.job where jobname='daypop-reminder-minute-v1'),0::bigint,'migration does not create a reminder job');
select is((select count(*) from net.http_request_queue),0::bigint,'migration does not enqueue HTTP');

select ok(not has_schema_privilege(actor,schema_name,'usage'),actor||' cannot access '||schema_name)
  from (values('anon'),('authenticated')) roles(actor) cross join (values('cron')) schemas(schema_name);

set local role anon;
select throws_ok($$select cron.schedule('daypop-scheduler-anon-test','* * * * *','select 1')$$,'42501',null,'anon cannot schedule');
reset role;
set local role authenticated;
select throws_ok($$select cron.schedule('daypop-scheduler-user-test','* * * * *','select 1')$$,'42501',null,'authenticated cannot schedule');
reset role;

select ok(has_function_privilege('postgres','cron.schedule(text,text,text)','execute'),'administrator retains scheduler access');
select ok(has_schema_privilege('postgres','net','usage'),'administrator retains database HTTP access');
-- All job work stays in this rollback transaction, never visible to cron.
create temp table daypop_scheduler_test_job as
  select cron.schedule('daypop-scheduler-preserve-test','0 0 1 1 *','select 1') as id;
select cron.alter_job((select id from daypop_scheduler_test_job),active:=false);
select is((select count(*) from cron.job j join daypop_scheduler_test_job t on j.jobid=t.id
  where j.jobname='daypop-scheduler-preserve-test' and not j.active and j.command='select 1'),1::bigint,'administrator can keep an inactive job without running it');
select is((select count(*) from net.http_request_queue),0::bigint,'permission and job checks leave no HTTP request');

select * from finish();
rollback;
