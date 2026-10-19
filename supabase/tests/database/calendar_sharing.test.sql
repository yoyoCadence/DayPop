-- DP-048: only fixed synthetic identities. The whole test rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public','calendar_group_shares','calendar sharing has its own grant table');
select has_function('public','calendar_sharing_manifest',array[]::text[],'sharing metadata is separate from personal documents');
select has_function('public','set_calendar_group_share',array['uuid','text','timestamp with time zone'],'only a calendar owner can explicitly configure its share');
select has_function('public','write_shared_calendar_item',array['text','jsonb','jsonb'],'shared writes have a controlled version boundary');

insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-4000-8000-000000000481','sharing-owner@example.test',now()),
 ('00000000-0000-4000-8000-000000000482','sharing-member@example.test',now()),
 ('00000000-0000-4000-8000-000000000483','sharing-stranger@example.test',now());
create temporary table sharing_test_context(key text primary key,value jsonb);
grant select,insert,update,delete on sharing_test_context to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000481',true);
insert into sharing_test_context select 'calendar',to_jsonb(id) from public.calendars where owner_id=(select auth.uid()) and is_default;
insert into sharing_test_context values('family',public.family_command('create','{"name":"Sharing fixture"}'));
insert into sharing_test_context values('invite',public.family_command('invite',jsonb_build_object('groupId',(select value #> '{snapshot,group,id}' from sharing_test_context where key='family'),'email','sharing-member@example.test')));
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000482',true);
select public.family_command('accept',jsonb_build_object('token',(select value #> '{invitation,token}' from sharing_test_context where key='invite')));
select is((select count(*)::integer from public.calendars where owner_id='00000000-0000-4000-8000-000000000481'),0,'membership alone does not share a calendar');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000481',true);
select is(public.set_calendar_group_share((select (value #>> '{}')::uuid from sharing_test_context where key='calendar'),'edit',null)->>'permission','edit','owner explicitly enables edit sharing');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000482',true);
select is((select count(*)::integer from public.calendars where owner_id='00000000-0000-4000-8000-000000000481'),1,'RLS now exposes the opted-in calendar');
select throws_ok($q$select public.set_calendar_group_share((select (value #>> '{}')::uuid from sharing_test_context where key='calendar'),'view',null)$q$,'42501',null,'a member cannot alter another calendar owner''s share');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000481',true);
insert into public.events(id,owner_id,calendar_id,title,is_all_day,start_date,end_date,sharing_scope)
select '10000000-0000-4000-8000-000000000481',(select auth.uid()),(value #>> '{}')::uuid,'Visible event',true,'2026-10-19','2026-10-19','inherit'
from sharing_test_context where key='calendar';
insert into public.events(id,owner_id,calendar_id,title,is_all_day,start_date,end_date,sharing_scope)
select '10000000-0000-4000-8000-000000000482',(select auth.uid()),(value #>> '{}')::uuid,'Private event',true,'2026-10-19','2026-10-19','private'
from sharing_test_context where key='calendar';
insert into public.todos(id,owner_id,calendar_id,parent_id,title,sharing_scope)
select '20000000-0000-4000-8000-000000000481',(select auth.uid()),(value #>> '{}')::uuid,null,'Private parent','private'
from sharing_test_context where key='calendar';
insert into public.todos(id,owner_id,calendar_id,parent_id,title,sharing_scope)
select '20000000-0000-4000-8000-000000000482',(select auth.uid()),(value #>> '{}')::uuid,'20000000-0000-4000-8000-000000000481','Inherited child','inherit'
from sharing_test_context where key='calendar';
insert into public.todos(id,owner_id,calendar_id,parent_id,title,sharing_scope)
select '20000000-0000-4000-8000-000000000483',(select auth.uid()),(value #>> '{}')::uuid,null,'Visible parent','inherit'
from sharing_test_context where key='calendar';
insert into public.todos(id,owner_id,calendar_id,parent_id,title,sharing_scope)
select '20000000-0000-4000-8000-000000000484',(select auth.uid()),(value #>> '{}')::uuid,'20000000-0000-4000-8000-000000000483','Hidden child','private'
from sharing_test_context where key='calendar';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000482',true);
select is((select count(*)::integer from public.events where owner_id='00000000-0000-4000-8000-000000000481'),1,'private events are removed by RLS');
select is((select count(*)::integer from public.todos where owner_id='00000000-0000-4000-8000-000000000481'),1,'private todo ancestry hides an inherited descendant');
select throws_ok($q$insert into public.events(owner_id,calendar_id,title,is_all_day,start_date,end_date,sharing_scope)
select '00000000-0000-4000-8000-000000000481',(value #>> '{}')::uuid,'Member private',true,'2026-10-19','2026-10-19','private' from sharing_test_context where key='calendar'$q$,'42501',null,'member cannot create private content in somebody else''s book');
insert into public.events(id,owner_id,calendar_id,title,is_all_day,start_date,end_date,created_by)
select '10000000-0000-4000-8000-000000000483','00000000-0000-4000-8000-000000000481',(value #>> '{}')::uuid,'Member event',true,'2026-10-19','2026-10-19','00000000-0000-4000-8000-000000000481'
from sharing_test_context where key='calendar';
select is((select created_by from public.events where id='10000000-0000-4000-8000-000000000483'),'00000000-0000-4000-8000-000000000482'::uuid,'server records the authenticated author, not the claimed author or data owner');

insert into sharing_test_context select 'version',jsonb_build_object('events',jsonb_build_object(id,updated_at)) from public.events where id='10000000-0000-4000-8000-000000000481';
select throws_ok($q$select public.write_shared_calendar_item('update_event',jsonb_build_object('id','10000000-0000-4000-8000-000000000481','values',jsonb_build_object('calendar_id',(select value from sharing_test_context where key='calendar'),'title','Blind overwrite','is_all_day',true,'start_date','2026-10-19','end_date','2026-10-19','sharing_scope','inherit')),'{}')$q$,'P0001','sharing_conflict','a shared update without a version cannot overwrite');
select is(public.write_shared_calendar_item('update_event',jsonb_build_object('id','10000000-0000-4000-8000-000000000481','values',jsonb_build_object('calendar_id',(select value from sharing_test_context where key='calendar'),'title','Confirmed edit','is_all_day',true,'start_date','2026-10-19','end_date','2026-10-19','sharing_scope','inherit')),(select value from sharing_test_context where key='version'))->>'applied','true','a member can update another author''s visible event with its current version');
select throws_ok($q$select public.write_shared_calendar_item('update_event',jsonb_build_object('id','10000000-0000-4000-8000-000000000481','values',jsonb_build_object('calendar_id',(select value from sharing_test_context where key='calendar'),'title','Stale overwrite','is_all_day',true,'start_date','2026-10-19','end_date','2026-10-19','sharing_scope','inherit')),(select value from sharing_test_context where key='version'))$q$,'P0001','sharing_conflict','the old row version is rejected even inside one transaction');
select is((select title from public.events where id='10000000-0000-4000-8000-000000000481'),'Confirmed edit','stale rejection preserves the confirmed content');
select is(public.write_shared_calendar_item('update_event',jsonb_build_object('id','10000000-0000-4000-8000-000000000481','values',jsonb_build_object('calendar_id',(select value from sharing_test_context where key='calendar'),'title','Confirmed edit','is_all_day',true,'start_date','2026-10-19','end_date','2026-10-19','sharing_scope','inherit')),(select value from sharing_test_context where key='version'))->>'applied','true','an identical update after a lost response is acknowledged without overwriting');

select throws_ok($q$select public.write_shared_calendar_item('delete_todo','{"id":"20000000-0000-4000-8000-000000000483"}',jsonb_build_object('todos',(select jsonb_object_agg(id,updated_at) from public.todos where id='20000000-0000-4000-8000-000000000483')))$q$,'42501','sharing_owner_action_required','a visible parent cannot cascade-delete a hidden private child');
select is((select count(*)::integer from public.todos where id='20000000-0000-4000-8000-000000000483'),1,'refused cascade leaves the visible parent too');

insert into sharing_test_context values('creation_payload',jsonb_build_object('id','10000000-0000-4000-8000-000000000484','values',jsonb_build_object('calendar_id',(select value from sharing_test_context where key='calendar'),'title','Stable creation','is_all_day',true,'start_date','2026-10-19','end_date','2026-10-19','sharing_scope','inherit')));
select is(public.write_shared_calendar_item('create_event',(select value from sharing_test_context where key='creation_payload'),'{}')->>'applied','true','new shared creation is confirmed');
select is(public.write_shared_calendar_item('create_event',(select value from sharing_test_context where key='creation_payload'),'{}')->>'applied','true','an identical retry after a lost response is idempotent');
select is((select count(*)::integer from public.events where id='10000000-0000-4000-8000-000000000484'),1,'creation retry stores only one row');
select throws_ok($q$select public.write_shared_calendar_item('create_event',jsonb_set((select value from sharing_test_context where key='creation_payload'),'{values,title}','"Changed retry"'),'{}')$q$,'P0001','sharing_conflict','a changed creation retry cannot silently discard a new draft or overwrite later edits');

-- The legacy single-occurrence RPCs must not become a blind shared-write path.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000481',true);
reset role;
update public.events set recurrence_rule='FREQ=DAILY' where id='10000000-0000-4000-8000-000000000481';
set local role authenticated;
select throws_ok($q$select public.cancel_event_occurrence('10000000-0000-4000-8000-000000000481','30000000-0000-4000-8000-000000000481','2026-10-20',null)$q$,'P0001','sharing_conflict','even the owner must version-check shared occurrence writes');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000482',true);
insert into sharing_test_context values('series_versions',jsonb_build_object('events',(select jsonb_object_agg(id,updated_at) from public.events where id='10000000-0000-4000-8000-000000000481')));
insert into sharing_test_context values('occurrence_payload',jsonb_build_object('id','10000000-0000-4000-8000-000000000481','exceptionId','30000000-0000-4000-8000-000000000481','occurrenceDate','2026-10-20'));
select is(public.write_shared_calendar_item('cancel_occurrence',(select value from sharing_test_context where key='occurrence_payload'),(select value from sharing_test_context where key='series_versions'))->>'applied','true','a member can cancel one occurrence with the current complete series version');
select is(public.write_shared_calendar_item('cancel_occurrence',(select value from sharing_test_context where key='occurrence_payload'),(select value from sharing_test_context where key='series_versions'))->>'applied','true','an already confirmed cancellation safely acknowledges a lost response');
select throws_ok($q$select public.write_shared_calendar_item('cancel_occurrence',jsonb_set((select value from sharing_test_context where key='occurrence_payload'),'{occurrenceDate}','"2026-10-21"'),(select value from sharing_test_context where key='series_versions'))$q$,'P0001','sharing_conflict','a new occurrence cannot reuse the old series version');

insert into sharing_test_context values('replacement_payload',
  (select value from sharing_test_context where key='occurrence_payload') || jsonb_build_object('values',jsonb_build_object(
    'id','10000000-0000-4000-8000-000000000485','calendar_id',(select value from sharing_test_context where key='calendar'),
    'title','Detached shared occurrence','is_all_day',true,'start_date','2026-10-20','end_date','2026-10-20','sharing_scope','inherit')));
update sharing_test_context set value=jsonb_build_object('events',(select jsonb_object_agg(id,updated_at) from public.events),
  'event_exceptions',coalesce((select jsonb_object_agg(id,updated_at) from public.event_exceptions),'{}')) where key='series_versions';
select is(public.write_shared_calendar_item('replace_occurrence',(select value from sharing_test_context where key='replacement_payload'),(select value from sharing_test_context where key='series_versions'))->>'applied','true','a member can atomically replace a visible shared occurrence');
select is(public.write_shared_calendar_item('replace_occurrence',(select value from sharing_test_context where key='replacement_payload'),(select value from sharing_test_context where key='series_versions'))->>'applied','true','a lost replacement response is acknowledged without another write');
select throws_ok($q$select public.write_shared_calendar_item('replace_occurrence',jsonb_set((select value from sharing_test_context where key='replacement_payload'),'{values,title}','"stale change"'),(select value from sharing_test_context where key='series_versions'))$q$,'P0001','sharing_conflict','changed replacement content cannot overwrite with stale versions');
select is((select count(*)::integer from public.events where id='10000000-0000-4000-8000-000000000485'),1,'replacement retries leave exactly one detached event');
select daypop_family.prepare_write_context(jsonb_build_object('events',(select jsonb_object_agg(id,updated_at) from public.events where id='10000000-0000-4000-8000-000000000485')));
select throws_ok($q$update public.events set created_by='00000000-0000-4000-8000-000000000481' where id='10000000-0000-4000-8000-000000000485'$q$,'42501',null,'created_by cannot be rewritten after the server records it');

-- A member cannot use FK cascades to erase invisible attachment metadata.
reset role;
insert into public.event_attachments(id,owner_id,event_id,object_path,file_name,mime_type,size_bytes) values
 ('40000000-0000-4000-8000-000000000481','00000000-0000-4000-8000-000000000481','10000000-0000-4000-8000-000000000481',
 '00000000-0000-4000-8000-000000000481/10000000-0000-4000-8000-000000000481/40000000-0000-4000-8000-000000000481','private.pdf','application/pdf',1);
set local role authenticated;
update sharing_test_context set value=jsonb_build_object('events',(select jsonb_object_agg(id,updated_at) from public.events),
  'event_exceptions',coalesce((select jsonb_object_agg(id,updated_at) from public.event_exceptions),'{}')) where key='series_versions';
select is((select count(*)::integer from public.event_attachments),0,'members still cannot read attachment metadata');
select throws_ok($q$select public.write_shared_calendar_item('delete_event','{"id":"10000000-0000-4000-8000-000000000481"}',(select value from sharing_test_context where key='series_versions'))$q$,'42501','sharing_owner_action_required','member deletion cannot erase the owner''s invisible attachment');
select is(public.write_shared_calendar_item('cancel_occurrence',(select value from sharing_test_context where key='occurrence_payload'),(select value from sharing_test_context where key='series_versions'))->>'applied','true','cancelling a detached event does not delete or block on its parent''s attachment');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000481',true);
select is((select count(*)::integer from public.event_attachments),1,'the original attachment remains owned and intact');
select throws_ok($q$select public.write_shared_calendar_item('replace_occurrence',
  jsonb_set(jsonb_set(jsonb_set((select value from sharing_test_context where key='replacement_payload'),'{occurrenceDate}','"2026-10-21"'),'{exceptionId}','"30000000-0000-4000-8000-000000000489"'),'{values,id}','"10000000-0000-4000-8000-000000000483"'),
  jsonb_build_object('events',(select jsonb_object_agg(id,updated_at) from public.events),
    'event_exceptions',(select jsonb_object_agg(id,updated_at) from public.event_exceptions)))$q$,
  '23505','proposed replacement id already exists','a proposed detached id cannot overwrite an unrelated existing event');

-- Moving into ANY already-shared book requires the exact confirmed grant.
insert into public.calendars(id,owner_id,name,color,is_default) values
 ('50000000-0000-4000-8000-000000000481',(select auth.uid()),'Move source','#336699',false);
insert into public.events(id,owner_id,calendar_id,title,is_all_day,start_date,end_date) values
 ('10000000-0000-4000-8000-000000000486',(select auth.uid()),'50000000-0000-4000-8000-000000000481','Historical move',true,'2026-10-01','2026-10-01');
insert into sharing_test_context values('move_versions',jsonb_build_object('events',(select jsonb_object_agg(id,updated_at) from public.events where calendar_id='50000000-0000-4000-8000-000000000481')));
select throws_ok($q$select public.delete_calendar_with_reassignment('50000000-0000-4000-8000-000000000481')$q$,'P0001','sharing_conflict','legacy calendar deletion cannot bypass a shared move confirmation');
select throws_ok($q$select public.write_shared_calendar_item('delete_calendar','{"id":"50000000-0000-4000-8000-000000000481"}',(select value from sharing_test_context where key='move_versions'))$q$,'P0001','sharing_confirm_exposure','a version alone does not confirm moving history into a shared book');
select is(public.write_shared_calendar_item('delete_calendar',jsonb_build_object('id','50000000-0000-4000-8000-000000000481',
  'confirmExposure',(select jsonb_object_agg(calendar_id,updated_at) from public.calendar_group_shares)),
  (select value from sharing_test_context where key='move_versions'))->>'applied','true','owner-confirmed migration preserves the existing atomic default-calendar ordering');
select is((select count(*)::integer from public.calendars where is_default),1,'calendar reassignment retains exactly one personal default');
select throws_ok($q$delete from public.calendars where id=(select (value #>> '{}')::uuid from sharing_test_context where key='calendar')$q$,'P0001','sharing_disable_before_import','direct replacement cannot delete a book while it remains shared');

select daypop_family.prepare_write_context(jsonb_build_object('todos',(select jsonb_object_agg(id,updated_at) from public.todos where id='20000000-0000-4000-8000-000000000483')));
with removed as(delete from public.todos where id='20000000-0000-4000-8000-000000000483' returning id)
select is((select count(*)::integer from removed),0,'RLS itself requires every cascaded child version, even for a direct owner DELETE');
select throws_ok($q$insert into pg_temp.daypop_shared_write_context values((select auth.uid()),'events','10000000-0000-4000-8000-000000000481')$q$,'42501',null,'authenticated callers cannot forge the private write context rows');

insert into public.events(id,owner_id,calendar_id,title,is_all_day,start_date,end_date,recurrence_rule,sharing_scope)
select '10000000-0000-4000-8000-000000000487',(select auth.uid()),(value #>> '{}')::uuid,'Mixed legacy series',true,'2026-10-19','2026-10-19','FREQ=DAILY','inherit' from sharing_test_context where key='calendar';
insert into public.events(id,owner_id,calendar_id,title,is_all_day,start_date,end_date,sharing_scope)
select '10000000-0000-4000-8000-000000000488',(select auth.uid()),(value #>> '{}')::uuid,'Private replacement',true,'2026-10-20','2026-10-20','private' from sharing_test_context where key='calendar';
select daypop_family.prepare_write_context(jsonb_build_object('events',(select jsonb_object_agg(id,updated_at) from public.events where id='10000000-0000-4000-8000-000000000487')));
insert into public.event_exceptions(id,owner_id,event_id,occurrence_date,is_cancelled,replacement_event_id) values
 ('30000000-0000-4000-8000-000000000487',(select auth.uid()),'10000000-0000-4000-8000-000000000487','2026-10-20',false,'10000000-0000-4000-8000-000000000488');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000482',true);
select is((select count(*)::integer from public.events where id in ('10000000-0000-4000-8000-000000000487','10000000-0000-4000-8000-000000000488')),0,'a legacy mixed-private series is hidden as a whole');
select is((select count(*)::integer from public.event_exceptions where id='30000000-0000-4000-8000-000000000487'),0,'no missing replacement resurrects an original shared occurrence');
select throws_ok($q$select * from daypop_family.related_events('10000000-0000-4000-8000-000000000487')$q$,'42501',null,'internal graph helpers do not disclose private replacement ids');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000481',true);
select public.write_shared_calendar_item('update_event',jsonb_build_object('id',e.id,'values',
  (to_jsonb(e)-array['id','owner_id','created_by','created_at','updated_at'])||'{"sharing_scope":"private"}'),
  jsonb_build_object('events',(select jsonb_object_agg(id,updated_at) from public.events),
    'event_exceptions',(select jsonb_object_agg(id,updated_at) from public.event_exceptions)))
from public.events e where e.id='10000000-0000-4000-8000-000000000487';
select public.write_shared_calendar_item('update_event',jsonb_build_object('id',e.id,'values',
  (to_jsonb(e)-array['id','owner_id','created_by','created_at','updated_at'])||'{"sharing_scope":"inherit"}'),
  jsonb_build_object('events',(select jsonb_object_agg(id,updated_at) from public.events),
    'event_exceptions',(select jsonb_object_agg(id,updated_at) from public.event_exceptions)))
from public.events e where e.id='10000000-0000-4000-8000-000000000487';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000482',true);
select is((select count(*)::integer from public.events where id in ('10000000-0000-4000-8000-000000000487','10000000-0000-4000-8000-000000000488')),2,'only an explicit owner whole-series change makes the repaired series visible');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000481',true);

select public.set_calendar_group_share((select (value #>> '{}')::uuid from sharing_test_context where key='calendar'),'view',
  (select updated_at from public.calendar_group_shares where calendar_id=(select (value #>> '{}')::uuid from sharing_test_context where key='calendar')));
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000482',true);
select ok(exists(select 1 from public.events where id='10000000-0000-4000-8000-000000000481'),'view members can still read visible rows');
select throws_ok($q$select public.write_shared_calendar_item('update_event',(select value from sharing_test_context where key='creation_payload'),jsonb_build_object('events',(select jsonb_object_agg(id,updated_at) from public.events)))$q$,'42501',null,'view is enforced on the server even if a client sends a complete write payload');
select throws_ok($q$insert into public.events(owner_id,calendar_id,title,is_all_day,start_date,end_date)
select '00000000-0000-4000-8000-000000000481',(value #>> '{}')::uuid,'view insert',true,'2026-10-19','2026-10-19' from sharing_test_context where key='calendar'$q$,'42501',null,'view also rejects direct insert');
select public.family_command('leave',jsonb_build_object('groupId',(select value #> '{snapshot,group,id}' from sharing_test_context where key='family')));
select is((select count(*)::integer from public.events where owner_id='00000000-0000-4000-8000-000000000481'),0,'leaving takes effect without refreshing the JWT');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000481',true);
select is((select count(*)::integer from public.events where id='10000000-0000-4000-8000-000000000483'),1,'a departed member''s original creation stays in the owner''s book');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000483',true);
select is((select count(*)::integer from public.calendars where owner_id='00000000-0000-4000-8000-000000000481'),0,'nonmembers cannot read a shared calendar');
select is((select count(*)::integer from public.events where owner_id='00000000-0000-4000-8000-000000000481'),0,'nonmembers cannot read shared content');

select * from finish();
rollback;
