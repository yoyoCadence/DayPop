-- DP-220: synthetic recipients/capabilities only; every object rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create temporary table reminder_test(key text primary key,value jsonb);
grant all on reminder_test to authenticated,service_role;
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-4000-8000-000000000901','reminder-a@example.test',now()),
 ('00000000-0000-4000-8000-000000000902','reminder-b@example.test',now()),
 ('00000000-0000-4000-8000-000000000903','reminder-outsider@example.test',now());
insert into public.calendars(id,owner_id,name,color) values
 ('50000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000901','Source','#336699'),
 ('50000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-000000000901','Destination','#336699');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',true);
insert into reminder_test select 'group',public.family_command('create','{"name":"Reminder fixture"}')#>'{snapshot,group,id}';
insert into reminder_test select 'invitation',public.family_command('invite',jsonb_build_object(
 'groupId',(select value from reminder_test where key='group'),'email','reminder-b@example.test'))#>'{invitation,token}';
select public.set_calendar_group_share('50000000-0000-4000-8000-000000000901','view',null);
select public.set_calendar_group_share('50000000-0000-4000-8000-000000000902','view',null);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000902',true);
select public.family_command('accept',jsonb_build_object('token',(select value from reminder_test where key='invitation')));
reset role;
insert into public.events(id,owner_id,calendar_id,title,is_all_day,start_date,end_date,recurrence_rule,sharing_scope) values
 ('10000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000901','50000000-0000-4000-8000-000000000901','SECRET source',true,'2026-10-31','2026-10-31','FREQ=DAILY','inherit'),
 ('10000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-000000000901','50000000-0000-4000-8000-000000000902','SECRET moved',true,'2026-11-01','2026-11-01',null,'inherit'),
 ('10000000-0000-4000-8000-000000000903','00000000-0000-4000-8000-000000000901','50000000-0000-4000-8000-000000000902','SECRET independent',true,'2026-11-01','2026-11-01',null,'inherit'),
 ('10000000-0000-4000-8000-000000000904','00000000-0000-4000-8000-000000000901','50000000-0000-4000-8000-000000000902','SECRET private',true,'2026-11-01','2026-11-01',null,'private');
insert into public.event_exceptions(id,owner_id,event_id,occurrence_date,is_cancelled,replacement_event_id) values
 ('30000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000901','10000000-0000-4000-8000-000000000901','2026-10-31',false,'10000000-0000-4000-8000-000000000902');
insert into public.todos(id,owner_id,calendar_id,parent_id,title,sharing_scope) values
 ('20000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000901','50000000-0000-4000-8000-000000000902',null,'SECRET private parent','private'),
 ('20000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-000000000901','50000000-0000-4000-8000-000000000902','20000000-0000-4000-8000-000000000901','SECRET child','inherit'),
 ('20000000-0000-4000-8000-000000000903','00000000-0000-4000-8000-000000000901','50000000-0000-4000-8000-000000000902',null,'SECRET visible todo','inherit');

select ok((select bool_and(relrowsecurity) from pg_class where oid in
 ('public.calendar_reminder_settings'::regclass,'public.reminder_push_devices'::regclass,
  'daypop_reminders.configuration'::regclass,'daypop_reminders.deliveries'::regclass)),'all four notification tables enable RLS');
set local role anon;
select throws_ok($$select public.reminder_capabilities()$$,'42501',null,'anon cannot call capabilities');
select throws_ok($$select public.reminder_sender_page()$$,'42501',null,'anon cannot enter sender');
select throws_ok($$select * from public.calendar_reminder_settings$$,'42501',null,'anon cannot read rules');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000902',true);
select is(public.reminder_capabilities()->>'enabled','false','backend is disabled by default');
select throws_ok($$select public.register_reminder_device('https://fcm.googleapis.com/fcm/send/sql',
 'B'||repeat('C',86),repeat('D',22),'B'||repeat('A',86))$$,'55000','reminder_backend_unavailable','disabled backend refuses registration');
insert into reminder_test select 'rule',public.set_calendar_reminder('50000000-0000-4000-8000-000000000902',array[0,15],
 'Asia/Taipei','09:00',true,null);
select is((select count(*) from public.calendar_reminder_settings),1::bigint,'view member may opt into their own rule');
select throws_ok($$select public.set_calendar_reminder('50000000-0000-4000-8000-000000000902',array[0],
 'UTC','09:00',false,null)$$,'P0001','reminder_conflict','stale rule version is rejected');
select throws_ok($$insert into public.calendar_reminder_settings(user_id,calendar_id,timezone)
 values('00000000-0000-4000-8000-000000000901','50000000-0000-4000-8000-000000000901','UTC')$$,'42501',null,'cannot impersonate another recipient');
select throws_ok($$update public.calendar_reminder_settings set minutes_before=array[99]$$,'42501',null,'direct settings writes denied');
select throws_ok($$select public.reminder_sender_context(null,null)$$,'42501',null,'authenticated cannot invoke sender');
select throws_ok($$select * from daypop_reminders.deliveries$$,'42501',null,'private ledger is not client readable');
select throws_ok($$select public.set_calendar_reminder('50000000-0000-4000-8000-000000000901',array[-1],
 'UTC','09:00',false,null)$$,'23514',null,'negative minutes rejected');
select throws_ok($$select public.set_calendar_reminder('50000000-0000-4000-8000-000000000901',array[10081],
 'UTC','09:00',false,null)$$,'23514',null,'unbounded minutes rejected');
select throws_ok($$select public.set_calendar_reminder('50000000-0000-4000-8000-000000000901',array[0],
 'invalid/timezone','09:00',false,null)$$,'22023',null,'unknown timezone rejected');
select throws_ok($$select public.set_calendar_reminder('50000000-0000-4000-8000-000000000901',array[0],
 'UTC','24:00',false,null)$$,'23514',null,'invalid wall time rejected');
select throws_ok($$select public.set_calendar_reminder('50000000-0000-4000-8000-000000000901',array_fill(0,array[11]),
 'UTC','09:00',false,null)$$,'23514',null,'too many offsets rejected');
select throws_ok($$select public.set_calendar_reminder('50000000-0000-4000-8000-000000000901',array[null]::integer[],
 'UTC','09:00',false,null)$$,'23514',null,'NULL offset rejected');
select throws_ok($$select public.set_calendar_reminder('50000000-0000-4000-8000-000000000901',array[[0,1],[2,3]],
 'UTC','09:00',false,null)$$,null,null,'multidimensional offsets rejected');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000903',true);
select is((select count(*) from public.calendar_reminder_settings),0::bigint,'outsider sees no other rules');
select throws_ok($$select public.set_calendar_reminder('50000000-0000-4000-8000-000000000902',array[0],
 'UTC','09:00',false,null)$$,'42501','reminder_calendar_unavailable','outsider cannot subscribe to another calendar');
reset role;
update daypop_reminders.configuration set enabled=true,public_key='B'||repeat('A',86);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000902',true);
select is(public.reminder_capabilities()->>'enabled','false','enabled configuration without heartbeat still reports unavailable');
reset role;
set local role service_role;
select public.reminder_sender_heartbeat();
reset role;
set local role authenticated;
select is(public.reminder_capabilities()->>'enabled','true','live heartbeat permits device opt-in');
select throws_ok($$select public.register_reminder_device('https://evil.example.test/push',
 'B'||repeat('C',86),repeat('D',22),'B'||repeat('A',86))$$,'23514',null,'unapproved destination refused');
select throws_ok($$select public.register_reminder_device('https://fcm.googleapis.com.evil.test/push',
 'B'||repeat('C',86),repeat('D',22),'B'||repeat('A',86))$$,'23514',null,'lookalike host refused');
select throws_ok($$select public.register_reminder_device('https://fcm.googleapis.com/fcm/send/sql',
 'invalid',repeat('D',22),'B'||repeat('A',86))$$,'23514',null,'malformed encryption key refused');
insert into reminder_test select 'device',to_jsonb(public.register_reminder_device('https://fcm.googleapis.com/fcm/send/sql',
 'B'||repeat('C',86),repeat('D',22),'B'||repeat('A',86)));
select is(to_jsonb(public.register_reminder_device('https://fcm.googleapis.com/fcm/send/sql',
 'B'||repeat('C',86),repeat('D',22),'B'||repeat('A',86))),(select value from reminder_test where key='device'),'registration retry is idempotent');
select is((select count(id) from public.reminder_push_devices),1::bigint,'own device metadata is readable');
select throws_ok($$select endpoint from public.reminder_push_devices$$,'42501',null,'even owner cannot SELECT capability URLs');
select throws_ok($$select auth_key from public.reminder_push_devices$$,'42501',null,'even owner cannot SELECT encryption secret');
select throws_ok($$delete from public.reminder_push_devices$$,'42501',null,'device deletion uses guarded RPC');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000903',true);
select is((select count(id) from public.reminder_push_devices),0::bigint,'outsider sees no devices');
select public.unregister_reminder_device((select (value#>>'{}')::uuid from reminder_test where key='device'));
select throws_ok($$select public.register_reminder_device('https://fcm.googleapis.com/fcm/send/sql',
 'B'||repeat('X',86),repeat('Y',22),'B'||repeat('A',86))$$,'42501','reminder_subscription_mismatch','endpoint alone cannot transfer device');
reset role;
-- Backdate only synthetic consent/device boundaries to test due jobs now.
update public.reminder_push_devices set created_at=now()-interval '1 hour';
alter table public.calendar_reminder_settings disable trigger reminder_settings_timestamp;
update public.calendar_reminder_settings set updated_at=now()-interval '1 hour';
alter table public.calendar_reminder_settings enable trigger reminder_settings_timestamp;
set local role service_role;
insert into reminder_test select 'context',public.reminder_sender_context(
 (select (value#>>'{}')::uuid from reminder_test where key='device'),'50000000-0000-4000-8000-000000000902');
select is(jsonb_array_length((select value#>'{snapshot,events}' from reminder_test where key='context')),3,'sender graph includes source on another calendar and omits private event');
select is(jsonb_array_length((select value#>'{snapshot,eventExceptions}' from reminder_test where key='context')),1,'sender retains replacement exception');
select is(jsonb_array_length((select value#>'{snapshot,todos}' from reminder_test where key='context')),1,'private parent and all descendants hidden');
select ok((select value::text not like '%SECRET%' from reminder_test where key='context'),'snapshot strips all private titles');
select is(current_setting('request.jwt.claim.sub'),'00000000-0000-4000-8000-000000000903','sender restores previous recipient context');
select is(jsonb_array_length(public.reminder_sender_page()),1,'only opted-in devices are paged');
select is(public.claim_reminder_delivery((select (value#>>'{}')::uuid from reminder_test where key='device'),
 '50000000-0000-4000-8000-000000000902','wrong-version',repeat('a',64),now()),null::jsonb,'wrong data version cannot claim');
select is(public.claim_reminder_delivery((select (value#>>'{}')::uuid from reminder_test where key='device'),
 '50000000-0000-4000-8000-000000000902',(select value->>'version' from reminder_test where key='context'),repeat('a',64),now()+interval '1 minute'),null::jsonb,'future job cannot claim');
select is(public.claim_reminder_delivery((select (value#>>'{}')::uuid from reminder_test where key='device'),
 '50000000-0000-4000-8000-000000000902',(select value->>'version' from reminder_test where key='context'),repeat('a',64),now()-interval '5 minutes'),null::jsonb,'expired job cannot claim');
insert into reminder_test select 'claim',public.claim_reminder_delivery((select (value#>>'{}')::uuid from reminder_test where key='device'),
 '50000000-0000-4000-8000-000000000902',(select value->>'version' from reminder_test where key='context'),repeat('a',64),now());
select ok((select value->>'leaseId' is not null from reminder_test where key='claim'),'current job obtains one lease');
select is(public.claim_reminder_delivery((select (value#>>'{}')::uuid from reminder_test where key='device'),
 '50000000-0000-4000-8000-000000000902',(select value->>'version' from reminder_test where key='context'),repeat('a',64),now()),null::jsonb,'active lease prevents duplicate sender');
select public.finish_reminder_delivery((select (value#>>'{}')::uuid from reminder_test where key='device'),repeat('a',64),gen_random_uuid(),'sent');
reset role;
select is((select status from daypop_reminders.deliveries),'sending','wrong lease cannot finish');
set local role service_role;
select public.finish_reminder_delivery((select (value#>>'{}')::uuid from reminder_test where key='device'),repeat('a',64),
 (select (value->>'leaseId')::uuid from reminder_test where key='claim'),'sent');
reset role;
update daypop_reminders.deliveries set lease_until=now()-interval '1 second';
set local role service_role;
select is(public.claim_reminder_delivery((select (value#>>'{}')::uuid from reminder_test where key='device'),
 '50000000-0000-4000-8000-000000000902',(select value->>'version' from reminder_test where key='context'),repeat('a',64),now()),null::jsonb,'sent delivery is never resent after lease expiry');
insert into reminder_test select 'retry',public.claim_reminder_delivery((select (value#>>'{}')::uuid from reminder_test where key='device'),
 '50000000-0000-4000-8000-000000000902',(select value->>'version' from reminder_test where key='context'),repeat('b',64),now());
select public.finish_reminder_delivery((select (value#>>'{}')::uuid from reminder_test where key='device'),repeat('b',64),
 (select (value->>'leaseId')::uuid from reminder_test where key='retry'),'retry');
reset role;
update daypop_reminders.deliveries set lease_until=now()-interval '1 second' where job_hash=repeat('b',64);
set local role service_role;
insert into reminder_test select 'retried',public.claim_reminder_delivery((select (value#>>'{}')::uuid from reminder_test where key='device'),
 '50000000-0000-4000-8000-000000000902',(select value->>'version' from reminder_test where key='context'),repeat('b',64),now());
select ok((select value->>'leaseId' is not null from reminder_test where key='retried'),'expired retry can acquire new lease');
select public.finish_reminder_delivery((select (value#>>'{}')::uuid from reminder_test where key='device'),repeat('b',64),
 (select (value->>'leaseId')::uuid from reminder_test where key='retry'),'gone');
reset role;
select is((select count(*) from public.reminder_push_devices),1::bigint,'stale worker cannot remove subscription owned by newer lease');
update daypop_reminders.deliveries set attempts=4,lease_until=now()-interval '1 second' where job_hash=repeat('b',64);
set local role service_role;
select is(public.claim_reminder_delivery((select (value#>>'{}')::uuid from reminder_test where key='device'),
 '50000000-0000-4000-8000-000000000902',(select value->>'version' from reminder_test where key='context'),repeat('b',64),now()),null::jsonb,'retry budget is bounded');
reset role;
update daypop_reminders.configuration set public_key='B'||repeat('Z',86);
set local role service_role;
select is(public.reminder_sender_context((select (value#>>'{}')::uuid from reminder_test where key='device'),
 '50000000-0000-4000-8000-000000000902'),null::jsonb,'key rotation rejects old application subscription');
reset role;
update daypop_reminders.configuration set public_key='B'||repeat('A',86);
update public.events set sharing_scope='private' where id='10000000-0000-4000-8000-000000000902';
set local role service_role;
select is(jsonb_array_length(public.reminder_sender_context((select (value#>>'{}')::uuid from reminder_test where key='device'),
 '50000000-0000-4000-8000-000000000902')#>'{snapshot,events}'),1,'private replacement hides complete cross-calendar graph');
select is(public.claim_reminder_delivery((select (value#>>'{}')::uuid from reminder_test where key='device'),
 '50000000-0000-4000-8000-000000000902',(select value->>'version' from reminder_test where key='context'),repeat('c',64),now()),null::jsonb,'old snapshot cannot send after privacy change');
reset role;
delete from public.family_memberships where user_id='00000000-0000-4000-8000-000000000902';
set local role service_role;
select is(public.reminder_sender_context((select (value#>>'{}')::uuid from reminder_test where key='device'),
 '50000000-0000-4000-8000-000000000902'),null::jsonb,'membership removal revokes sender context');
select is(public.claim_reminder_delivery((select (value#>>'{}')::uuid from reminder_test where key='device'),
 '50000000-0000-4000-8000-000000000902',(select value->>'version' from reminder_test where key='context'),repeat('d',64),now()),null::jsonb,'membership removal rejects in-flight version');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000902',true);
select lives_ok($$select public.set_calendar_reminder('50000000-0000-4000-8000-000000000902','{}','UTC','09:00',false,
 (select updated_at from public.calendar_reminder_settings))$$,'lost-access recipient can still turn off own reminder');
reset role;
set local role service_role;
select public.finish_reminder_delivery((select (value#>>'{}')::uuid from reminder_test where key='device'),repeat('b',64),
 (select (value->>'leaseId')::uuid from reminder_test where key='retried'),'gone');
reset role;
select is((select count(*) from public.reminder_push_devices),0::bigint,'current lease gone result removes expired subscription');
select is((select count(*) from daypop_reminders.deliveries),0::bigint,'gone result cascades delivery history');
set local role authenticated;
update reminder_test set value=to_jsonb(public.register_reminder_device('https://fcm.googleapis.com/fcm/send/sql',
 'B'||repeat('C',86),repeat('D',22),'B'||repeat('A',86))) where key='device';
select public.unregister_reminder_device((select (value#>>'{}')::uuid from reminder_test where key='device'));
reset role;
select is((select count(*) from public.reminder_push_devices),0::bigint,'own unregister removes device');
select is((select count(*) from daypop_reminders.deliveries),0::bigint,'unregister cascades delivery capabilities');
select * from finish();
rollback;
