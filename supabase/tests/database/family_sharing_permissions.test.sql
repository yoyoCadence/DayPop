-- DP-049. Five fixed synthetic identities; every row and temporary helper
-- rolls back. A owns the family; B owns the books; C/E are members; D is out.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temporary table family_permissions_context(key text primary key,value jsonb);
grant select,insert,update,delete on family_permissions_context to authenticated;
-- Fixture builders only: no privileged reads or authorization in these helpers.
create function pg_temp.event_command(p_id uuid,p_calendar uuid,p_title text,p_scope text default 'inherit')
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',p_id,'values',jsonb_build_object('calendar_id',p_calendar,'title',p_title,
   'is_all_day',true,'start_date','2026-10-20','end_date','2026-10-20','sharing_scope',p_scope,
   'reminder_minutes','[]'::jsonb));
$$;
create function pg_temp.todo_command(p_id uuid,p_calendar uuid,p_title text,p_parent uuid default null)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',p_id,'values',jsonb_build_object('calendar_id',p_calendar,'title',p_title,
   'parent_id',p_parent,'due_date','2026-10-20','priority','none','completed_at',null,'sort_order',0,'sharing_scope','inherit'));
$$;
create function pg_temp.item_versions(p_events uuid[] default '{}',p_todos uuid[] default '{}',p_exceptions uuid[] default '{}')
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
   'events',coalesce((select jsonb_object_agg(id,updated_at) from public.events where id=any(p_events)),'{}'::jsonb),
   'todos',coalesce((select jsonb_object_agg(id,updated_at) from public.todos where id=any(p_todos)),'{}'::jsonb),
   'event_exceptions',coalesce((select jsonb_object_agg(id,updated_at) from public.event_exceptions where id=any(p_exceptions)),'{}'::jsonb));
$$;

insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('00000000-0000-4000-8000-000000000491','matrix-a@example.test',now(),'{}'),
 ('00000000-0000-4000-8000-000000000492','matrix-b@example.test',now(),'{}'),
 ('00000000-0000-4000-8000-000000000493','matrix-c@example.test',now(),'{"role":"owner"}'),
 ('00000000-0000-4000-8000-000000000494','matrix-d@example.test',now(),'{}'),
 ('00000000-0000-4000-8000-000000000495','matrix-e@example.test',now(),'{}');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000491',true);
insert into family_permissions_context select 'group',public.family_command('create','{"name":"DP049 matrix"}')#>'{snapshot,group,id}';
insert into family_permissions_context select 'invite-b',public.family_command('invite',jsonb_build_object('groupId',(select value from family_permissions_context where key='group'),'email','matrix-b@example.test'))#>'{invitation,token}';
insert into family_permissions_context select 'invite-c',public.family_command('invite',jsonb_build_object('groupId',(select value from family_permissions_context where key='group'),'email','matrix-c@example.test'))#>'{invitation,token}';
insert into family_permissions_context select 'invite-e',public.family_command('invite',jsonb_build_object('groupId',(select value from family_permissions_context where key='group'),'email','matrix-e@example.test'))#>'{invitation,token}';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000492',true);
select public.family_command('accept',jsonb_build_object('token',(select value from family_permissions_context where key='invite-b')));
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000493',true);
select public.family_command('accept',jsonb_build_object('token',(select value from family_permissions_context where key='invite-c')));
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000495',true);
select public.family_command('accept',jsonb_build_object('token',(select value from family_permissions_context where key='invite-e')));

-- B creates three explicit books and both visible/private hierarchies.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000492',true);
insert into public.calendars(id,owner_id,name,color) values
 ('50000000-0000-4000-8000-000000000491',(select auth.uid()),'B edit','#336699'),
 ('50000000-0000-4000-8000-000000000492',(select auth.uid()),'B view','#336699'),
 ('50000000-0000-4000-8000-000000000493',(select auth.uid()),'B unshared','#336699');
insert into public.events(id,owner_id,calendar_id,title,is_all_day,start_date,end_date,sharing_scope) values
 ('10000000-0000-4000-8000-000000000491',(select auth.uid()),'50000000-0000-4000-8000-000000000491','B visible with metadata',true,'2026-10-20','2026-10-20','inherit'),
 ('10000000-0000-4000-8000-000000000492',(select auth.uid()),'50000000-0000-4000-8000-000000000491','B private',true,'2026-10-20','2026-10-20','private'),
 ('10000000-0000-4000-8000-000000000493',(select auth.uid()),'50000000-0000-4000-8000-000000000492','B read only',true,'2026-10-20','2026-10-20','inherit'),
 ('10000000-0000-4000-8000-000000000494',(select auth.uid()),'50000000-0000-4000-8000-000000000493','B unshared event',true,'2026-10-20','2026-10-20','inherit'),
 ('10000000-0000-4000-8000-00000000049a',(select auth.uid()),'50000000-0000-4000-8000-000000000491','Mixed permission root',true,'2026-10-20','2026-10-20','inherit'),
 ('10000000-0000-4000-8000-00000000049b',(select auth.uid()),'50000000-0000-4000-8000-000000000492','View replacement',true,'2026-10-21','2026-10-21','inherit');
update public.events set recurrence_rule='FREQ=DAILY;COUNT=3' where id='10000000-0000-4000-8000-00000000049a';
insert into public.event_exceptions(id,owner_id,event_id,occurrence_date,is_cancelled,replacement_event_id) values
 ('30000000-0000-4000-8000-00000000049a',(select auth.uid()),'10000000-0000-4000-8000-00000000049a','2026-10-21',false,'10000000-0000-4000-8000-00000000049b');
insert into public.todos(id,owner_id,calendar_id,parent_id,title,sharing_scope) values
 ('20000000-0000-4000-8000-000000000491',(select auth.uid()),'50000000-0000-4000-8000-000000000491',null,'Visible parent with hidden child','inherit'),
 ('20000000-0000-4000-8000-000000000492',(select auth.uid()),'50000000-0000-4000-8000-000000000491',null,'Private parent','private'),
 ('20000000-0000-4000-8000-000000000493',(select auth.uid()),'50000000-0000-4000-8000-000000000491','20000000-0000-4000-8000-000000000492','Inherited hidden child','inherit'),
 ('20000000-0000-4000-8000-000000000494',(select auth.uid()),'50000000-0000-4000-8000-000000000491','20000000-0000-4000-8000-000000000491','Private child','private'),
 ('20000000-0000-4000-8000-000000000495',(select auth.uid()),'50000000-0000-4000-8000-000000000491',null,'Deletable parent','inherit'),
 ('20000000-0000-4000-8000-000000000496',(select auth.uid()),'50000000-0000-4000-8000-000000000491','20000000-0000-4000-8000-000000000495','Deletable child','inherit');
-- Only metadata, no uploaded object or contact outside these fixed fixtures.
reset role;
insert into public.event_attachments(id,owner_id,event_id,object_path,file_name,mime_type,size_bytes) values
 ('40000000-0000-4000-8000-000000000491','00000000-0000-4000-8000-000000000492','10000000-0000-4000-8000-000000000491',
 '00000000-0000-4000-8000-000000000492/10000000-0000-4000-8000-000000000491/40000000-0000-4000-8000-000000000491','matrix.pdf','application/pdf',1);
insert into storage.objects(id,bucket_id,name,owner_id) values
 ('40000000-0000-4000-8000-000000000492','event-attachments',
 '00000000-0000-4000-8000-000000000492/10000000-0000-4000-8000-000000000491/40000000-0000-4000-8000-000000000491','00000000-0000-4000-8000-000000000492');
insert into public.event_attendees(id,owner_id,event_id,email) values
 ('40000000-0000-4000-8000-000000000493','00000000-0000-4000-8000-000000000492','10000000-0000-4000-8000-000000000491','fixture-contact@example.test');
insert into public.stickers(id,owner_id,calendar_id,sticker_date,glyph) values
 ('40000000-0000-4000-8000-000000000494','00000000-0000-4000-8000-000000000492','50000000-0000-4000-8000-000000000491','2026-10-20','*');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000492',true);
select public.set_calendar_group_share('50000000-0000-4000-8000-000000000491','edit',null);
select public.set_calendar_group_share('50000000-0000-4000-8000-000000000492','view',null);

-- D is authenticated but outside the family. No frontend filter is involved.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000494',true);
select is(jsonb_array_length(public.calendar_sharing_manifest()),0,'an authenticated outsider receives no share manifest');
select is((select count(*)::integer from public.calendars where owner_id='00000000-0000-4000-8000-000000000492'),0,'outsider cannot select B calendars');
select is((select count(*)::integer from public.events where owner_id='00000000-0000-4000-8000-000000000492'),0,'outsider cannot select B events even by known owner');
select is((select count(*)::integer from public.todos where owner_id='00000000-0000-4000-8000-000000000492'),0,'outsider cannot select B todos');
select throws_ok($q$select public.write_shared_calendar_item('create_event',pg_temp.event_command('10000000-0000-4000-8000-00000000049f','50000000-0000-4000-8000-000000000491','Intrusion'))$q$,'42501',null,'outsider cannot create through RPC');
select throws_ok($q$insert into public.events(owner_id,calendar_id,title,is_all_day,start_date,end_date) values('00000000-0000-4000-8000-000000000492','50000000-0000-4000-8000-000000000491','Intrusion',true,'2026-10-20','2026-10-20')$q$,'42501',null,'outsider cannot bypass RPC with direct insert');
select is((select count(*)::integer from public.profiles where id=(select auth.uid())),1,'outsider still reads their own profile');

-- A owns the group, not B's private data or sharing settings.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000491',true);
select is((select count(*)::integer from public.events where id='10000000-0000-4000-8000-000000000491'),1,'group owner can read B explicitly shared content');
select is((select count(*)::integer from public.events where id='10000000-0000-4000-8000-000000000492'),0,'group owner cannot read B private event');
select is((select count(*)::integer from public.events where id='10000000-0000-4000-8000-000000000494'),0,'group owner cannot read B unshared book');
select throws_ok($q$select public.set_calendar_group_share('50000000-0000-4000-8000-000000000492','edit',null)$q$,'42501',null,'group owner cannot upgrade another owner share');
with changed as(update public.calendar_group_shares set permission='edit' where calendar_id='50000000-0000-4000-8000-000000000492' returning 1)
select is(count(*)::integer,0,'group owner cannot bypass share ownership through SQL') from changed;

-- C's user-editable role claim is never a family authorization source.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000493',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000493","role":"authenticated","user_metadata":{"role":"owner"}}',true);
select throws_ok($q$select public.family_command('rename',jsonb_build_object('groupId',(select value from family_permissions_context where key='group'),'name','Forged owner'))$q$,'P0001','family_owner_required','user metadata cannot grant family owner');
select throws_ok($q$update public.family_memberships set role='owner' where user_id=(select auth.uid())$q$,'42501',null,'membership role cannot be promoted through direct DML');
select throws_ok($q$select public.write_shared_calendar_item('delete_calendar','{"id":"50000000-0000-4000-8000-000000000491"}')$q$,'42501',null,'member cannot delete another owner whole calendar');
with changed as(update public.calendars set name='Stolen' where id='50000000-0000-4000-8000-000000000491' returning 1)
select is(count(*)::integer,0,'member cannot rename a received calendar') from changed;
select is((select count(*)::integer from public.profiles where id='00000000-0000-4000-8000-000000000492'),0,'sharing does not open full profiles');
select is((select count(*)::integer from public.user_preferences where user_id='00000000-0000-4000-8000-000000000492'),0,'sharing does not open preferences');
select is((select count(*)::integer from public.event_attachments where owner_id='00000000-0000-4000-8000-000000000492'),0,'edit grant does not expose attachment metadata');
select is((select count(*)::integer from public.event_attendees where owner_id='00000000-0000-4000-8000-000000000492'),0,'edit grant does not expose contact metadata');
select is((select count(*)::integer from public.stickers where owner_id='00000000-0000-4000-8000-000000000492'),0,'edit grant does not expose stickers');
select is((select count(*)::integer from storage.objects where id='40000000-0000-4000-8000-000000000492'),0,'edit grant does not expose the attachment object');
select is((select count(*)::integer from public.todos where id in ('20000000-0000-4000-8000-000000000492','20000000-0000-4000-8000-000000000493','20000000-0000-4000-8000-000000000494')),0,'private parents and children are hidden in direct SQL');
select throws_ok($q$select daypop_family.related_events('10000000-0000-4000-8000-000000000492')$q$,'42501',null,'internal graph cannot be used to enumerate private ids');

-- A client-owned shadow table must be rejected BEFORE any definer DML.
create temporary table daypop_shared_write_context(actor uuid,collection text,id uuid);
insert into daypop_shared_write_context values((select auth.uid()),'events','10000000-0000-4000-8000-000000000491');
select ok(not daypop_family.has_write_context('events','10000000-0000-4000-8000-000000000491'),'a forged temp context has no authority');
select throws_ok($q$select daypop_family.prepare_write_context('{}')$q$,'42501','sharing_untrusted_context','definer refuses a client-owned shadow context before touching it');
drop table daypop_shared_write_context;
select set_config('daypop.shared_write_context','forged',true);
with changed as(update public.events set title='Blind write' where id='10000000-0000-4000-8000-000000000491' returning 1)
select is(count(*)::integer,0,'a forged GUC cannot bypass versioned shared writes') from changed;

-- View is read-only through direct SQL as well as the public RPC.
select is((select count(*)::integer from public.events where id='10000000-0000-4000-8000-000000000493'),1,'member can read a view book');
select throws_ok($q$select public.write_shared_calendar_item('update_event',pg_temp.event_command('10000000-0000-4000-8000-000000000493','50000000-0000-4000-8000-000000000492','View overwrite'),pg_temp.item_versions(array['10000000-0000-4000-8000-000000000493']::uuid[]))$q$,'42501',null,'view rejects a versioned RPC update');
select throws_ok($q$insert into public.events(owner_id,calendar_id,title,is_all_day,start_date,end_date) values('00000000-0000-4000-8000-000000000492','50000000-0000-4000-8000-000000000492','View insert',true,'2026-10-20','2026-10-20')$q$,'42501',null,'view rejects direct insert');
with changed as(update public.events set title='View overwrite' where id='10000000-0000-4000-8000-000000000493' returning 1)
select is(count(*)::integer,0,'view rejects direct update') from changed;
with changed as(delete from public.events where id='10000000-0000-4000-8000-000000000493' returning 1)
select is(count(*)::integer,0,'view rejects direct delete') from changed;

-- Mixed view/edit recurrence graphs are readable together, never partly editable.
select is((select count(*)::integer from public.events where id in ('10000000-0000-4000-8000-00000000049a','10000000-0000-4000-8000-00000000049b')),2,'mixed-permission series is read with its replacement');
select throws_ok($q$select public.write_shared_calendar_item('update_event',pg_temp.event_command('10000000-0000-4000-8000-00000000049a','50000000-0000-4000-8000-000000000491','Mixed overwrite'),pg_temp.item_versions(array['10000000-0000-4000-8000-00000000049a','10000000-0000-4000-8000-00000000049b']::uuid[],'{}',array['30000000-0000-4000-8000-00000000049a']::uuid[]))$q$,'42501',null,'edit on root cannot override a view replacement');

-- Edit permits actual shared CRUD, with server-owned ownership and authorship.
select is(public.write_shared_calendar_item('create_event',pg_temp.event_command('10000000-0000-4000-8000-00000000049c','50000000-0000-4000-8000-000000000491','Created by C'))->>'applied','true','edit member creates an event');
select is((select owner_id::text from public.events where id='10000000-0000-4000-8000-00000000049c'),'00000000-0000-4000-8000-000000000492','new event belongs to the calendar owner');
select is((select created_by::text from public.events where id='10000000-0000-4000-8000-00000000049c'),'00000000-0000-4000-8000-000000000493','server records the member author');
select throws_ok($q$select public.write_shared_calendar_item('update_event',pg_temp.event_command('10000000-0000-4000-8000-00000000049c','50000000-0000-4000-8000-000000000491','Forged')||jsonb_build_object('owner_id',(select auth.uid())))$q$,'22023',null,'RPC rejects a forged ownership field');
select daypop_family.prepare_write_context(pg_temp.item_versions(array['10000000-0000-4000-8000-00000000049c']::uuid[]));
select throws_ok($q$update public.events set owner_id=(select auth.uid()) where id='10000000-0000-4000-8000-00000000049c'$q$,'42501',null,'member cannot reassign ownership even with current versions');
select throws_ok($q$update public.events set created_by='00000000-0000-4000-8000-000000000492' where id='10000000-0000-4000-8000-00000000049c'$q$,'42501',null,'member cannot rewrite the author');
select throws_ok($q$update public.events set sharing_scope='private' where id='10000000-0000-4000-8000-00000000049c'$q$,'42501',null,'author cannot privately hide another owner content');
select throws_ok($q$insert into pg_temp.daypop_shared_write_context values((select auth.uid()),'events','10000000-0000-4000-8000-000000000492')$q$,'42501',null,'client cannot add entries to the trusted write context');
insert into family_permissions_context select 'event-version',pg_temp.item_versions(array['10000000-0000-4000-8000-00000000049c']::uuid[]);
select is(public.write_shared_calendar_item('update_event',pg_temp.event_command('10000000-0000-4000-8000-00000000049c','50000000-0000-4000-8000-000000000491','Edited by C'),(select value from family_permissions_context where key='event-version'))->>'applied','true','member updates a shared event');
select throws_ok($q$select public.write_shared_calendar_item('update_event',pg_temp.event_command('10000000-0000-4000-8000-00000000049c','50000000-0000-4000-8000-000000000491','Stale change'),(select value from family_permissions_context where key='event-version'))$q$,'P0001','sharing_conflict','an old version cannot overwrite the confirmed edit');
select is(public.write_shared_calendar_item('delete_event','{"id":"10000000-0000-4000-8000-00000000049c"}',pg_temp.item_versions(array['10000000-0000-4000-8000-00000000049c']::uuid[]))->>'applied','true','member deletes a visible shared event');
select is((select count(*)::integer from public.events where id='10000000-0000-4000-8000-00000000049c'),0,'confirmed event deletion removes the row');
select throws_ok($q$select public.write_shared_calendar_item('delete_event','{"id":"10000000-0000-4000-8000-000000000491"}',pg_temp.item_versions(array['10000000-0000-4000-8000-000000000491']::uuid[]))$q$,'42501','sharing_owner_action_required','member cannot cascade through hidden metadata');

select is(public.write_shared_calendar_item('create_todo',pg_temp.todo_command('20000000-0000-4000-8000-00000000049c','50000000-0000-4000-8000-000000000491','C todo'))->>'applied','true','member creates a shared todo');
select is((select owner_id::text||':'||created_by::text from public.todos where id='20000000-0000-4000-8000-00000000049c'),'00000000-0000-4000-8000-000000000492:00000000-0000-4000-8000-000000000493','todo owner and author are distinct server facts');
select is(public.write_shared_calendar_item('update_todo',jsonb_set(pg_temp.todo_command('20000000-0000-4000-8000-00000000049c','50000000-0000-4000-8000-000000000491','Completed by C'),'{values,completed_at}',to_jsonb(now())),pg_temp.item_versions('{}',array['20000000-0000-4000-8000-00000000049c']::uuid[]))->>'applied','true','member completes a shared todo');
select ok((select completed_at is not null from public.todos where id='20000000-0000-4000-8000-00000000049c'),'completion is stored on the server');
select is(public.write_shared_calendar_item('delete_todo','{"id":"20000000-0000-4000-8000-000000000495"}',pg_temp.item_versions('{}',array['20000000-0000-4000-8000-000000000495','20000000-0000-4000-8000-000000000496']::uuid[]))->>'applied','true','member can delete another author visible subtree with complete versions');
select is((select count(*)::integer from public.todos where id in ('20000000-0000-4000-8000-000000000495','20000000-0000-4000-8000-000000000496')),0,'shared subtree deletion is complete');
select throws_ok($q$select public.write_shared_calendar_item('create_todo',pg_temp.todo_command('20000000-0000-4000-8000-00000000049d','50000000-0000-4000-8000-000000000491','Hidden parent intrusion','20000000-0000-4000-8000-000000000492'))$q$,'42501',null,'known private parent id does not authorize a child insert');

-- Creating a row never grants private access, even after the author is deleted.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000495',true);
select public.write_shared_calendar_item('create_event',pg_temp.event_command('10000000-0000-4000-8000-00000000049e','50000000-0000-4000-8000-000000000491','E contribution'));
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000492',true);
select public.write_shared_calendar_item('update_event',pg_temp.event_command('10000000-0000-4000-8000-00000000049e','50000000-0000-4000-8000-000000000491','E contribution','private'),pg_temp.item_versions(array['10000000-0000-4000-8000-00000000049e']::uuid[]));
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000495',true);
select is((select count(*)::integer from public.events where id='10000000-0000-4000-8000-00000000049e'),0,'original author cannot read a now-private contribution');
select ok(not daypop_family.has_write_context('events','10000000-0000-4000-8000-00000000049e'),'trusted context cannot be reused after actor changes');
reset role;
delete from auth.users where id='00000000-0000-4000-8000-000000000495';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000492',true);
select is((select created_by::text from public.events where id='10000000-0000-4000-8000-00000000049e'),'00000000-0000-4000-8000-000000000495','deleting an author account retains the other owner row and original author id');

-- Permission changes are checked from current DB state, without a JWT refresh.
select public.set_calendar_group_share('50000000-0000-4000-8000-000000000491','view',(select updated_at from public.calendar_group_shares where calendar_id='50000000-0000-4000-8000-000000000491'));
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000493',true);
select is((select count(*)::integer from public.events where id='10000000-0000-4000-8000-000000000491'),1,'downgrade retains read permission');
select throws_ok($q$select public.write_shared_calendar_item('update_event',pg_temp.event_command('10000000-0000-4000-8000-000000000491','50000000-0000-4000-8000-000000000491','After downgrade'),pg_temp.item_versions(array['10000000-0000-4000-8000-000000000491']::uuid[]))$q$,'42501',null,'downgrade immediately refuses a write with the same actor');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000492',true);
select public.set_calendar_group_share('50000000-0000-4000-8000-000000000491',null,(select updated_at from public.calendar_group_shares where calendar_id='50000000-0000-4000-8000-000000000491'));
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000493',true);
select is((select count(*)::integer from public.events where owner_id='00000000-0000-4000-8000-000000000492' and calendar_id='50000000-0000-4000-8000-000000000491'),0,'turning sharing off immediately removes reads');
select throws_ok($q$select public.write_shared_calendar_item('update_todo',pg_temp.todo_command('20000000-0000-4000-8000-00000000049c','50000000-0000-4000-8000-000000000491','After revoke'))$q$,'42501',null,'turning sharing off refuses queued commands');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000492',true);
select public.set_calendar_group_share('50000000-0000-4000-8000-000000000491','edit',null);

-- C leaves and rejoins. Its own outgoing grant is not resurrected.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000493',true);
insert into public.calendars(id,owner_id,name,color) values('50000000-0000-4000-8000-000000000494',(select auth.uid()),'C outgoing','#336699');
select public.set_calendar_group_share('50000000-0000-4000-8000-000000000494','edit',null);
select public.family_command('leave',jsonb_build_object('groupId',(select value from family_permissions_context where key='group')));
select is((select count(*)::integer from public.events where owner_id='00000000-0000-4000-8000-000000000492'),0,'leaving removes received reads without refreshing the JWT');
select is((select count(*)::integer from public.calendar_group_shares where calendar_id='50000000-0000-4000-8000-000000000494'),0,'leaving deletes the owner outgoing share');
select is((select count(*)::integer from public.calendars where id='50000000-0000-4000-8000-000000000494'),1,'leaving retains the owner calendar');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000491',true);
insert into family_permissions_context select 'reinvite-c',public.family_command('invite',jsonb_build_object('groupId',(select value from family_permissions_context where key='group'),'email','matrix-c@example.test'))#>'{invitation,token}';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000493',true);
select public.family_command('accept',jsonb_build_object('token',(select value from family_permissions_context where key='reinvite-c')));
select is((select count(*)::integer from public.calendar_group_shares where calendar_id='50000000-0000-4000-8000-000000000494'),0,'rejoining does not restore old outgoing sharing');
select is((select count(*)::integer from public.events where id='10000000-0000-4000-8000-000000000491'),1,'a new membership receives B currently enabled grant');

-- Removing calendar owner B revokes all of B's grants, without deleting data.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000491',true);
select public.family_command('remove',jsonb_build_object('groupId',(select value from family_permissions_context where key='group'),'memberId','00000000-0000-4000-8000-000000000492'));
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000493',true);
select is((select count(*)::integer from public.events where owner_id='00000000-0000-4000-8000-000000000492'),0,'removing the sharing owner immediately hides their content');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000492',true);
select is((select count(*)::integer from public.todos where id='20000000-0000-4000-8000-00000000049c'),1,'departed member contributions remain with B');
select is((select count(*)::integer from public.calendars where owner_id=(select auth.uid())),4,'removal retains all B calendars');
select is((select count(*)::integer from public.event_attachments where id='40000000-0000-4000-8000-000000000491'),1,'removal retains private attachment metadata');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000491',true);
insert into family_permissions_context select 'reinvite-b',public.family_command('invite',jsonb_build_object('groupId',(select value from family_permissions_context where key='group'),'email','matrix-b@example.test'))#>'{invitation,token}';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000492',true);
select public.family_command('accept',jsonb_build_object('token',(select value from family_permissions_context where key='reinvite-b')));
select is((select count(*)::integer from public.calendar_group_shares where owner_id=(select auth.uid())),0,'returning calendar owner must explicitly share again');
select public.set_calendar_group_share('50000000-0000-4000-8000-000000000491','edit',null);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000491',true);
select public.family_command('dissolve',jsonb_build_object('groupId',(select value from family_permissions_context where key='group')));
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000493',true);
select is((select count(*)::integer from public.events where owner_id='00000000-0000-4000-8000-000000000492'),0,'dissolution removes cross-account reads with the old JWT');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000492',true);
select is((select count(*)::integer from public.events where id='10000000-0000-4000-8000-00000000049e'),1,'dissolution retains the private contribution');
select is((select count(*)::integer from storage.objects where id='40000000-0000-4000-8000-000000000492'),1,'dissolution retains the owner attachment object metadata');

select * from finish();
rollback;
