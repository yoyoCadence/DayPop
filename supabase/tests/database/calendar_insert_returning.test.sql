-- DP-209: execute INSERT/UPSERT with RETURNING as authenticated, rather than
-- seeding as postgres and only checking visibility in a later statement.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-4000-8000-000000000209','calendar-return-owner@example.test',now()),
 ('00000000-0000-4000-8000-00000000020a','calendar-return-other@example.test',now());

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000209',true);
select lives_ok($q$
  insert into public.calendars(id,owner_id,name,color,is_default,sort_order)
  values('10000000-0000-4000-8000-000000000209',(select auth.uid()),'New calendar','#336699',false,1)
  returning id
$q$,'owner can insert and immediately return the new calendar');
select is((select count(*)::integer from public.calendars where id='10000000-0000-4000-8000-000000000209'),1,'the returned calendar is durably readable');
select lives_ok($q$
  insert into public.calendars(id,owner_id,name,color,is_default,sort_order)
  values('10000000-0000-4000-8000-00000000020a',(select auth.uid()),'Upsert new','#336699',false,2)
  on conflict(id) do update set name=excluded.name
  returning id
$q$,'owner upsert RETURNING works on its insert path');
select lives_ok($q$
  insert into public.calendars(id,owner_id,name,color,is_default,sort_order)
  values('10000000-0000-4000-8000-000000000209',(select auth.uid()),'Owner updated','#336699',false,1)
  on conflict(id) do update set name=excluded.name
  returning id
$q$,'owner upsert RETURNING also works on its conflict-update path');
select is((select name from public.calendars where id='10000000-0000-4000-8000-000000000209'),'Owner updated','upsert preserves the confirmed owner edit');
select throws_ok($q$
  insert into public.calendars(id,owner_id,name,color,is_default,sort_order)
  values('10000000-0000-4000-8000-00000000020b','00000000-0000-4000-8000-00000000020a','Spoofed owner','#336699',false,1)
  returning id
$q$,'42501',null,'new-row read permission cannot spoof another owner');
select throws_ok($q$
  update public.calendars set owner_id='00000000-0000-4000-8000-00000000020a'
  where id='10000000-0000-4000-8000-000000000209' returning id
$q$,'42501',null,'the owner cannot reassign calendar ownership');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000020a',true);
select is((select count(*)::integer from public.calendars where owner_id='00000000-0000-4000-8000-000000000209'),0,'an unrelated account cannot read the new calendars');
with removed as (
  delete from public.calendars where id='10000000-0000-4000-8000-000000000209' returning id
) select is((select count(*)::integer from removed),0,'an unrelated account cannot delete or return the owner row');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000209',true);
select is((select count(*)::integer from public.calendars where id in ('10000000-0000-4000-8000-000000000209','10000000-0000-4000-8000-00000000020a')),2,'both new calendars remain owned and readable after rejected operations');
select * from finish();
rollback;
