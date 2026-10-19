-- DP-047: fixed synthetic identities only; every fixture and assertion rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'family_groups', 'family groups exist');
select has_table('public', 'family_memberships', 'family memberships exist');
select has_table('public', 'family_invitations', 'family invitations exist');
select has_function('public', 'family_command', array['text','jsonb'], 'controlled family mutation boundary exists');
select has_function('public', 'family_snapshot', array[]::text[], 'safe family projection exists');
select has_function('public', 'family_invitation_preview', array['text'], 'authenticated invitation preview exists');

insert into auth.users (id,email,email_confirmed_at) values
('00000000-0000-4000-8000-000000000471','family-owner-a@example.test',now()),
('00000000-0000-4000-8000-000000000472','family-owner-b@example.test',now()),
('00000000-0000-4000-8000-000000000473','family-member@example.test',now()),
('00000000-0000-4000-8000-000000000474','family-stranger@example.test',now()),
('00000000-0000-4000-8000-000000000475','family-unverified@example.test',null),
('00000000-0000-4000-8000-000000000476','family-slot-1@example.test',now());

create temporary table family_test_context (key text primary key, value jsonb);
grant select,insert,update,delete on family_test_context to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000471',true);
insert into family_test_context values ('create',public.family_command('create','{"name":"家庭 A"}'));
insert into family_test_context select 'group',value #> '{snapshot,group,id}' from family_test_context where key='create';
select is((select value #>> '{snapshot,group,name}' from family_test_context where key='create'),'家庭 A','create persists the requested name');
select is((select jsonb_array_length(value #> '{snapshot,members}') from family_test_context where key='create'),1,'owner membership is created in the same transaction');
select is((select value #>> '{snapshot,members,0,role}' from family_test_context where key='create'),'owner','creator has the owner role');
select is(public.family_command('create','{"name":"家庭 A"}') #>> '{snapshot,group,id}',(select value #>> '{}' from family_test_context where key='group'),'retry after a lost create response does not create a second group');
select is((select count(*)::integer from public.family_groups),1,'create retry leaves exactly one group');

select is(public.family_command('rename',jsonb_build_object('groupId',(select value from family_test_context where key='group'),'name','新的家庭')) #>> '{snapshot,group,name}','新的家庭','owner can rename their group');
select throws_ok($q$select public.family_command('rename','{"groupId":"00000000-0000-4000-8000-000000000499","name":"Wrong"}')$q$,'P0001','family_group_changed','stale group ids cannot target another group');
select throws_ok($q$insert into public.family_groups(owner_id,name) values ('00000000-0000-4000-8000-000000000471','Bypass')$q$,'42501',null,'direct group creation is not a second authorization path');
select throws_ok($q$insert into public.family_memberships(group_id,user_id,role) select (value #>> '{}')::uuid,'00000000-0000-4000-8000-000000000474','owner' from family_test_context where key='group'$q$,'42501',null,'clients cannot forge owner memberships');
select throws_ok($q$select public.family_command('invite',jsonb_build_object('groupId',(select value from family_test_context where key='group'),'email','a@example.test','role','owner'))$q$,'P0001','family_invalid_command','unknown ownership or role fields are rejected');

insert into family_test_context values ('invite',public.family_command('invite',jsonb_build_object('groupId',(select value from family_test_context where key='group'),'email',' FAMILY-MEMBER@example.test ')));
insert into family_test_context select 'token',value #> '{invitation,token}' from family_test_context where key='invite';
insert into family_test_context select 'invitation',value #> '{invitation,id}' from family_test_context where key='invite';
select ok((select value #>> '{}' ~ '^[0-9a-f]{64}$' from family_test_context where key='token'),'invitation tokens contain 256 random bits');
select is(public.family_snapshot() #>> '{invitations,0,email}','family-member@example.test','email is trimmed and lowercased');
select throws_ok('select token_hash from public.family_invitations','42501',null,'raw hash column is not exposed through the Data API grants');
select throws_ok($q$select public.family_command('leave',jsonb_build_object('groupId',(select value from family_test_context where key='group')))$q$,'P0001','family_owner_must_dissolve','owner cannot leave without dissolving');

reset role;
select is((select token_hash from public.family_invitations where id=(select (value #>> '{}')::uuid from family_test_context where key='invitation')),
encode(extensions.digest((select value #>> '{}' from family_test_context where key='token'),'sha256'),'hex'),'database stores a hash of the token');
select isnt((select token_hash from public.family_invitations where id=(select (value #>> '{}')::uuid from family_test_context where key='invitation')),
(select value #>> '{}' from family_test_context where key='token'),'database never stores the raw invitation token');
select ok((select expires_at > created_at + interval '6 days 23 hours' and expires_at <= created_at + interval '7 days 1 minute' from public.family_invitations where id=(select (value #>> '{}')::uuid from family_test_context where key='invitation')),'invitations expire after seven days');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.family_groups'::regclass,'public.family_memberships'::regclass,'public.family_invitations'::regclass)),'all new public tables enable RLS');
select ok(not has_function_privilege('anon','public.family_command(text,jsonb)','execute'),'anonymous callers cannot execute family commands');
select ok(not has_function_privilege('anon','public.family_snapshot()','execute'),'anonymous callers cannot inspect families');
select ok(not has_function_privilege('anon','public.family_invitation_preview(text)','execute'),'anonymous callers cannot preview invitations');
select ok((select bool_and(not prosecdef and proconfig = array['search_path=""']) from pg_proc where oid in ('public.family_command(text,jsonb)'::regprocedure,'public.family_snapshot()'::regprocedure,'public.family_invitation_preview(text)'::regprocedure)),'exposed RPCs are invokers with an empty search path');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000474',true);
select set_config('request.jwt.claims','{"email":"family-member@example.test","user_metadata":{"role":"owner"}}',true);
select is((select count(*)::integer from public.family_groups),0,'a stranger cannot select another family');
select is((select count(*)::integer from public.family_memberships),0,'a stranger cannot enumerate memberships');
select is((select count(*)::integer from public.family_invitations),0,'a stranger cannot enumerate invitations');
select throws_ok($q$select public.family_invitation_preview((select value #>> '{}' from family_test_context where key='token'))$q$,'P0001','family_email_mismatch','a forged JWT email does not replace the current verified Auth email');
select throws_ok($q$select public.family_command('accept',jsonb_build_object('token',(select value from family_test_context where key='token')))$q$,'P0001','family_email_mismatch','a forwarded link cannot join another email account');
select is(public.family_snapshot()->'group','null'::jsonb,'failed acceptance creates no membership');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000475',true);
select throws_ok($q$select public.family_command('accept',jsonb_build_object('token',(select value from family_test_context where key='token')))$q$,'P0001','family_email_unverified','an unverified account cannot accept an invitation');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000473',true);
select is(public.family_invitation_preview((select value #>> '{}' from family_test_context where key='token'))->>'groupName','新的家庭','matching verified account can preview the family');
select is(public.family_snapshot()->'group','null'::jsonb,'preview does not automatically accept');
select is(public.family_command('accept',jsonb_build_object('token',(select value from family_test_context where key='token'))) #>> '{snapshot,group,name}','新的家庭','matching verified account can join');
select is(public.family_command('accept',jsonb_build_object('token',(select value from family_test_context where key='token'))) #>> '{snapshot,group,name}','新的家庭','retrying a confirmed accept returns the same membership');
select is((select count(*)::integer from public.family_memberships),2,'accepted token cannot duplicate membership');
select is(jsonb_array_length(public.family_snapshot()->'invitations'),0,'members do not receive recipient emails');
select throws_ok($q$select public.family_command('create','{"name":"Second family"}')$q$,'P0001','family_already_member','one account cannot create a second active group');
select throws_ok($q$select public.family_command('rename',jsonb_build_object('groupId',(select value from family_test_context where key='group'),'name','Escalated'))$q$,'P0001','family_owner_required','member cannot rename the group');
select throws_ok($q$select public.family_command('invite',jsonb_build_object('groupId',(select value from family_test_context where key='group'),'email','stranger@example.test'))$q$,'P0001','family_owner_required','member cannot invite');
select throws_ok($q$select public.family_command('dissolve',jsonb_build_object('groupId',(select value from family_test_context where key='group')))$q$,'P0001','family_owner_required','member cannot dissolve');
select throws_ok($q$update public.family_memberships set role='owner' where user_id='00000000-0000-4000-8000-000000000473'$q$,'42501',null,'member cannot promote themselves through direct REST updates');
select is((select count(*)::integer from public.calendars where owner_id='00000000-0000-4000-8000-000000000471'),0,'joining does not share calendars yet');
select is((select count(*)::integer from public.profiles where id='00000000-0000-4000-8000-000000000471'),0,'roster does not open raw profiles');
select is((select count(*)::integer from public.user_preferences where user_id='00000000-0000-4000-8000-000000000471'),0,'roster does not open preferences');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000471',true);
insert into family_test_context values ('stranger_invite',public.family_command('invite',jsonb_build_object('groupId',(select value from family_test_context where key='group'),'email','family-stranger@example.test')));
insert into family_test_context values ('resent',public.family_command('resend',jsonb_build_object('groupId',(select value from family_test_context where key='group'),'invitationId',(select value #> '{invitation,id}' from family_test_context where key='stranger_invite'))));
select isnt((select value #>> '{invitation,token}' from family_test_context where key='resent'),(select value #>> '{invitation,token}' from family_test_context where key='stranger_invite'),'resend rotates the raw token');
select is((select value #>> '{invitation,id}' from family_test_context where key='resent'),(select value #>> '{invitation,id}' from family_test_context where key='stranger_invite'),'resend does not reserve another seat');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000474',true);
select throws_ok($q$select public.family_invitation_preview((select value #>> '{invitation,token}' from family_test_context where key='stranger_invite'))$q$,'P0001','family_invitation_unavailable','old link stops working after resend');
select is(public.family_invitation_preview((select value #>> '{invitation,token}' from family_test_context where key='resent'))->>'groupName','新的家庭','new link works');
select is(public.family_command('decline',jsonb_build_object('token',(select value #> '{invitation,token}' from family_test_context where key='resent'))) #> '{snapshot,group}','null'::jsonb,'decline does not create membership');
select throws_ok($q$select public.family_command('accept',jsonb_build_object('token',(select value #> '{invitation,token}' from family_test_context where key='resent')))$q$,'P0001','family_invitation_unavailable','declined invitation cannot later be accepted');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000471',true);
select throws_ok($q$select public.family_command('resend',jsonb_build_object('groupId',(select value from family_test_context where key='group'),'invitationId',(select value #> '{invitation,id}' from family_test_context where key='resent')))$q$,'P0001','family_invitation_unavailable','decline requires a new invitation');

insert into family_test_context values ('revoked',public.family_command('invite',jsonb_build_object('groupId',(select value from family_test_context where key='group'),'email','family-stranger@example.test')));
select is(public.family_command('revoke',jsonb_build_object('groupId',(select value from family_test_context where key='group'),'invitationId',(select value #> '{invitation,id}' from family_test_context where key='revoked'))) #> '{snapshot,group,id}',(select value from family_test_context where key='group'),'owner can revoke without changing the group');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000474',true);
select throws_ok($q$select public.family_invitation_preview((select value #>> '{invitation,token}' from family_test_context where key='revoked'))$q$,'P0001','family_invitation_unavailable','revocation invalidates the link');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000471',true);
insert into family_test_context values ('expired',public.family_command('invite',jsonb_build_object('groupId',(select value from family_test_context where key='group'),'email','family-stranger@example.test')));
reset role;
update public.family_invitations set expires_at=clock_timestamp()-interval '1 second' where id=(select (value #>> '{invitation,id}')::uuid from family_test_context where key='expired');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000474',true);
select throws_ok($q$select public.family_command('accept',jsonb_build_object('token',(select value #> '{invitation,token}' from family_test_context where key='expired')))$q$,'P0001','family_invitation_unavailable','expired invitation cannot be accepted');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000471',true);
do $$begin
  for i in 1..4 loop
    insert into family_test_context values ('seat-'||i,public.family_command('invite',jsonb_build_object('groupId',(select value from family_test_context where key='group'),'email','family-slot-'||i||'@example.test')));
  end loop;
end$$;
select throws_ok($q$select public.family_command('invite',jsonb_build_object('groupId',(select value from family_test_context where key='group'),'email','overflow@example.test'))$q$,'P0001','family_full','two members plus four invitations reserve all six seats');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000476',true);
select is(public.family_command('accept',jsonb_build_object('token',(select value #> '{invitation,token}' from family_test_context where key='seat-1'))) #>> '{snapshot,group,name}','新的家庭','acceptance converts the reserved seat into membership');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000471',true);
select throws_ok($q$select public.family_command('invite',jsonb_build_object('groupId',(select value from family_test_context where key='group'),'email','overflow@example.test'))$q$,'P0001','family_full','acceptance does not accidentally free its reservation');

select is(public.family_command('remove',jsonb_build_object('groupId',(select value from family_test_context where key='group'),'memberId','00000000-0000-4000-8000-000000000476')) #>> '{snapshot,group,name}','新的家庭','owner may remove a member');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000476',true);
select is(public.family_snapshot()->'group','null'::jsonb,'removed member loses family access immediately');
select throws_ok($q$select public.family_command('accept',jsonb_build_object('token',(select value #> '{invitation,token}' from family_test_context where key='seat-1')))$q$,'P0001','family_invitation_unavailable','removed member cannot reuse the old accepted invitation');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000473',true);
select is(public.family_command('leave',jsonb_build_object('groupId',(select value from family_test_context where key='group'))) #> '{snapshot,group}','null'::jsonb,'member may leave');
select is((select count(*)::integer from public.family_memberships),0,'leaving immediately revokes roster reads');
select throws_ok($q$select public.family_command('accept',jsonb_build_object('token',(select value from family_test_context where key='token')))$q$,'P0001','family_invitation_unavailable','leaving does not reactivate the original link');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000472',true);
insert into family_test_context values ('other',public.family_command('create','{"name":"另一個家庭"}'));
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000471',true);
select is(public.family_command('dissolve',jsonb_build_object('groupId',(select value from family_test_context where key='group'))) #> '{snapshot,group}','null'::jsonb,'owner can dissolve their own group');
reset role;
select is((select count(*)::integer from public.family_memberships where group_id=(select (value #>> '{}')::uuid from family_test_context where key='group')),0,'dissolve deletes group memberships');
select is((select count(*)::integer from public.family_invitations where group_id=(select (value #>> '{}')::uuid from family_test_context where key='group')),0,'dissolve invalidates every invitation');
select is((select count(*)::integer from public.calendars where owner_id in ('00000000-0000-4000-8000-000000000471','00000000-0000-4000-8000-000000000473','00000000-0000-4000-8000-000000000476')),3,'group lifecycle preserves everyone''s personal calendars');
select is((select count(*)::integer from public.family_groups where owner_id='00000000-0000-4000-8000-000000000472'),1,'dissolve does not affect another family');

select * from finish();
rollback;
