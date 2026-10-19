-- DP-048 / ADR §9. Apply with the owner's CLI before frontend deployment.
-- Sharing metadata stays outside the versioned personal document. Existing
-- authors remain unknown (NULL); new authors come only from auth.uid().
create table public.calendar_group_shares (
  calendar_id uuid not null,
  group_id uuid not null,
  owner_id uuid not null,
  permission text not null check (permission in ('view','edit')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(calendar_id,group_id),
  unique(calendar_id),
  foreign key(calendar_id,owner_id) references public.calendars(id,owner_id) on delete cascade,
  foreign key(group_id,owner_id) references public.family_memberships(group_id,user_id) on delete cascade
);
-- UNIQUE(calendar_id) already narrows the calendar/owner FK lookup to one row.
create index calendar_group_shares_group_owner_idx on public.calendar_group_shares(group_id,owner_id);
create trigger calendar_group_shares_insert_time before insert on public.calendar_group_shares for each row execute function public.set_updated_at();
create trigger calendar_group_shares_update_time before update on public.calendar_group_shares for each row execute function public.set_updated_at();
alter table public.calendar_group_shares enable row level security;
revoke all on public.calendar_group_shares from public,anon,authenticated;
grant select,insert,update,delete on public.calendar_group_shares to authenticated;

alter table public.events add column created_by uuid;
alter table public.todos add column created_by uuid;
-- An opaque historical actor id is deliberately not an Auth FK: leaving or
-- deleting an account must not mutate content retained in somebody else's book.
create function daypop_family.record_item_author()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' and current_setting('role',true)='authenticated' then
    new.created_by := (select auth.uid());
  elsif tg_op='UPDATE' and current_setting('role',true)='authenticated'
    and (new.created_by is distinct from old.created_by or new.owner_id is distinct from old.owner_id) then
    raise exception using errcode='42501',message='sharing_immutable_identity';
  end if;
  return new;
end;
$$;
revoke all on function daypop_family.record_item_author() from public,anon,authenticated;
create trigger events_author before insert or update on public.events for each row execute function daypop_family.record_item_author();
create trigger todos_author before insert or update on public.todos for each row execute function daypop_family.record_item_author();

-- Narrow authorization predicates bypass RLS only to avoid policy recursion.
-- They derive the caller themselves, return no row contents, and never use an
-- author id as permission. The actual public mutations remain INVOKER + RLS.
create function daypop_family.calendar_access(p_calendar uuid)
returns text language sql stable security definer set search_path='' as $$
  select case when c.owner_id=(select auth.uid()) then 'owner' else (
    select s.permission from public.calendar_group_shares s
    join public.family_memberships m on m.group_id=s.group_id and m.user_id=(select auth.uid())
    where s.calendar_id=c.id and s.owner_id=c.owner_id
  ) end from public.calendars c where c.id=p_calendar and (select auth.uid()) is not null;
$$;

create function daypop_family.related_events(p_event uuid)
returns table(id uuid) language sql stable security definer set search_path='' as $$
  -- This internal graph is used only by guarded predicates below. Do not grant
  -- it to clients: even a private replacement's id must not be disclosed.
  with recursive edges(source,target) as (
    select event_id,replacement_event_id from public.event_exceptions where replacement_event_id is not null
    union all
    select replacement_event_id,event_id from public.event_exceptions where replacement_event_id is not null
  ), related(id) as (
    select p_event
    union
    select e.target from related r join edges e on e.source=r.id
  ) select related.id from related;
$$;
revoke all on function daypop_family.related_events(uuid) from public,anon,authenticated;

create function daypop_family.event_access(p_id uuid,p_owner uuid,p_calendar uuid,p_scope text,p_write boolean default false)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor uuid := (select auth.uid()); access text;
begin
  if actor is null then return false; end if;
  if actor=p_owner then return true; end if;
  access := daypop_family.calendar_access(p_calendar);
  if p_scope<>'inherit' or access is null or (p_write and access<>'edit') then return false; end if;
  -- All replacements and their exception must be visible together. Hiding the
  -- whole mixed/private series prevents an omitted exception resurrecting it.
  return not exists (
    select 1 from daypop_family.related_events(p_id) r join public.events e on e.id=r.id
    where e.sharing_scope<>'inherit' or daypop_family.calendar_access(e.calendar_id) is null
      or (p_write and daypop_family.calendar_access(e.calendar_id) not in ('edit','owner'))
  );
end;
$$;

create function daypop_family.todo_access(p_id uuid,p_parent uuid,p_owner uuid,p_calendar uuid,p_scope text,p_write boolean default false)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor uuid := (select auth.uid()); access text;
begin
  if actor is null then return false; end if;
  if actor=p_owner then return true; end if;
  access := daypop_family.calendar_access(p_calendar);
  if p_scope<>'inherit' or access is null or (p_write and access<>'edit') then return false; end if;
  return not exists (
    with recursive ancestors(id,parent_id,sharing_scope) as (
      select id,parent_id,sharing_scope from public.todos where id=p_parent
      union
      select t.id,t.parent_id,t.sharing_scope from ancestors a join public.todos t on t.id=a.parent_id
    ) select 1 from ancestors where sharing_scope<>'inherit'
  );
end;
$$;

create function daypop_family.shared_calendar(p_calendar uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and exists(
    select 1 from public.calendar_group_shares s where s.calendar_id=p_calendar
      and daypop_family.calendar_access(p_calendar) is not null
  );
$$;

create function daypop_family.has_write_context(p_collection text,p_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or to_regclass('pg_temp.daypop_shared_write_context') is null then return false; end if;
  if not exists(select 1 from pg_class where oid=to_regclass('pg_temp.daypop_shared_write_context') and relowner=current_user::regrole) then return false; end if;
  return exists(select 1 from pg_temp.daypop_shared_write_context where actor=(select auth.uid()) and collection=p_collection and id=p_id);
end;
$$;

create function daypop_family.event_writable(p_id uuid,p_owner uuid,p_calendar uuid,p_scope text)
returns boolean language sql stable security definer set search_path='' as $$
  select daypop_family.event_access(p_id,p_owner,p_calendar,p_scope,true)
    and (not daypop_family.shared_calendar(p_calendar) or daypop_family.has_write_context('events',p_id));
$$;
create function daypop_family.todo_writable(p_id uuid,p_parent uuid,p_owner uuid,p_calendar uuid,p_scope text)
returns boolean language sql stable security definer set search_path='' as $$
  select daypop_family.todo_access(p_id,p_parent,p_owner,p_calendar,p_scope,true)
    and (not daypop_family.shared_calendar(p_calendar) or daypop_family.has_write_context('todos',p_id));
$$;
create function daypop_family.exception_access(p_event uuid,p_replacement uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.events e where e.id=p_event
    and daypop_family.event_access(e.id,e.owner_id,e.calendar_id,e.sharing_scope,p_write))
    and (p_replacement is null or exists(select 1 from public.events e where e.id=p_replacement
      and daypop_family.event_access(e.id,e.owner_id,e.calendar_id,e.sharing_scope,p_write)))
    and (not p_write or not exists(select 1 from public.events e where e.id=p_event and daypop_family.shared_calendar(e.calendar_id))
      or daypop_family.has_write_context('events',p_event));
$$;

revoke all on function daypop_family.calendar_access(uuid),daypop_family.event_access(uuid,uuid,uuid,text,boolean),
  daypop_family.todo_access(uuid,uuid,uuid,uuid,text,boolean),daypop_family.shared_calendar(uuid),
  daypop_family.has_write_context(text,uuid),daypop_family.event_writable(uuid,uuid,uuid,text),
  daypop_family.todo_writable(uuid,uuid,uuid,uuid,text),daypop_family.exception_access(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function daypop_family.calendar_access(uuid),daypop_family.event_access(uuid,uuid,uuid,text,boolean),
  daypop_family.todo_access(uuid,uuid,uuid,uuid,text,boolean),daypop_family.shared_calendar(uuid),
  daypop_family.has_write_context(text,uuid),daypop_family.event_writable(uuid,uuid,uuid,text),
  daypop_family.todo_writable(uuid,uuid,uuid,uuid,text),daypop_family.exception_access(uuid,uuid,boolean) to authenticated;

create policy calendar_group_shares_read on public.calendar_group_shares for select to authenticated
using(owner_id=(select auth.uid()) or daypop_family.is_member(group_id));
create policy calendar_group_shares_insert on public.calendar_group_shares for insert to authenticated
with check(owner_id=(select auth.uid()) and daypop_family.is_member(group_id));
create policy calendar_group_shares_update on public.calendar_group_shares for update to authenticated
using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()) and daypop_family.is_member(group_id));
create policy calendar_group_shares_delete on public.calendar_group_shares for delete to authenticated
using(owner_id=(select auth.uid()));

drop policy calendars_select_own on public.calendars;
create policy calendars_read_authorized on public.calendars for select to authenticated
using(daypop_family.calendar_access(id) is not null);
drop policy events_select_own on public.events;
drop policy events_insert_own on public.events;
drop policy events_update_own on public.events;
drop policy events_delete_own on public.events;
create policy events_read_authorized on public.events for select to authenticated
using(daypop_family.event_access(id,owner_id,calendar_id,sharing_scope));
create policy events_insert_authorized on public.events for insert to authenticated
with check(owner_id=(select auth.uid()) or (sharing_scope='inherit'
  and daypop_family.calendar_access(calendar_id) in ('owner','edit')));
create policy events_update_authorized on public.events for update to authenticated
using(daypop_family.event_writable(id,owner_id,calendar_id,sharing_scope))
with check(daypop_family.event_writable(id,owner_id,calendar_id,sharing_scope));
create policy events_delete_authorized on public.events for delete to authenticated
using(daypop_family.event_writable(id,owner_id,calendar_id,sharing_scope));
drop policy todos_select_own on public.todos;
drop policy todos_insert_own on public.todos;
drop policy todos_update_own on public.todos;
drop policy todos_delete_own on public.todos;
create policy todos_read_authorized on public.todos for select to authenticated
using(daypop_family.todo_access(id,parent_id,owner_id,calendar_id,sharing_scope));
create policy todos_insert_authorized on public.todos for insert to authenticated
with check((owner_id=(select auth.uid()) or sharing_scope='inherit')
  and daypop_family.todo_access(id,parent_id,owner_id,calendar_id,sharing_scope,true));
create policy todos_update_authorized on public.todos for update to authenticated
using(daypop_family.todo_writable(id,parent_id,owner_id,calendar_id,sharing_scope))
with check(daypop_family.todo_writable(id,parent_id,owner_id,calendar_id,sharing_scope));
create policy todos_delete_authorized on public.todos for delete to authenticated
using(daypop_family.todo_writable(id,parent_id,owner_id,calendar_id,sharing_scope));
drop policy event_exceptions_select_own on public.event_exceptions;
drop policy event_exceptions_insert_own on public.event_exceptions;
drop policy event_exceptions_update_own on public.event_exceptions;
drop policy event_exceptions_delete_own on public.event_exceptions;
create policy exceptions_read_authorized on public.event_exceptions for select to authenticated
using(daypop_family.exception_access(event_id,replacement_event_id));
create policy exceptions_insert_authorized on public.event_exceptions for insert to authenticated
with check(daypop_family.exception_access(event_id,replacement_event_id,true));
create policy exceptions_update_authorized on public.event_exceptions for update to authenticated
using(daypop_family.exception_access(event_id,replacement_event_id,true))
with check(daypop_family.exception_access(event_id,replacement_event_id,true));
create policy exceptions_delete_authorized on public.event_exceptions for delete to authenticated
using(daypop_family.exception_access(event_id,replacement_event_id,true));

create function daypop_family.member_name(p_user uuid)
returns text language sql stable security definer set search_path='' as $$
  select coalesce(nullif(btrim(p.display_name),''),'家庭成員') from public.profiles p
  where p.id=p_user and ((select auth.uid())=p_user or exists(
    select 1 from public.family_memberships a join public.family_memberships b on b.group_id=a.group_id
    where a.user_id=(select auth.uid()) and b.user_id=p_user));
$$;
revoke all on function daypop_family.member_name(uuid) from public,anon,authenticated;
grant execute on function daypop_family.member_name(uuid) to authenticated;

create function public.calendar_sharing_manifest()
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('calendarId',s.calendar_id,'ownerId',s.owner_id,
    'ownerName',daypop_family.member_name(s.owner_id),'permission',s.permission,'groupId',s.group_id,
    'updatedAt',s.updated_at) order by s.calendar_id),'[]'::jsonb)
  from public.calendar_group_shares s;
$$;

create function public.set_calendar_group_share(p_calendar_id uuid,p_permission text,p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid := (select auth.uid()); group_id_value uuid; previous public.calendar_group_shares; stored public.calendar_group_shares;
begin
  if actor is null then raise exception using errcode='42501',message='sharing_sign_in_required'; end if;
  perform 1 from public.calendars where id=p_calendar_id and owner_id=actor for update;
  if not found then raise exception using errcode='42501',message='sharing_calendar_owner_required'; end if;
  if p_permission is not null and p_permission not in ('view','edit') then raise exception using errcode='22023',message='sharing_invalid_permission'; end if;
  select * into previous from public.calendar_group_shares where calendar_id=p_calendar_id;
  if previous.updated_at is distinct from p_expected_updated_at then raise exception using errcode='P0001',message='sharing_conflict'; end if;
  if p_permission is null then
    delete from public.calendar_group_shares where calendar_id=p_calendar_id and owner_id=actor;
    return jsonb_build_object('calendarId',p_calendar_id,'permission',null,'updatedAt',null);
  end if;
  select group_id into group_id_value from public.family_memberships where user_id=actor;
  if not found then raise exception using errcode='42501',message='sharing_membership_required'; end if;
  insert into public.calendar_group_shares(calendar_id,group_id,owner_id,permission)
  values(p_calendar_id,group_id_value,actor,p_permission)
  on conflict(calendar_id) do update set permission=excluded.permission
  returning * into stored;
  return jsonb_build_object('calendarId',stored.calendar_id,'permission',stored.permission,'updatedAt',stored.updated_at);
end;
$$;
revoke all on function public.calendar_sharing_manifest(),public.set_calendar_group_share(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.calendar_sharing_manifest(),public.set_calendar_group_share(uuid,text,timestamptz) to authenticated;

create function daypop_family.visible_related_events(p_event uuid)
returns table(id uuid) language sql stable security definer set search_path='' as $$
  select r.id from daypop_family.related_events(p_event) r join public.events e on e.id=r.id
  where exists(select 1 from public.events source where source.id=p_event
    and daypop_family.event_access(source.id,source.owner_id,source.calendar_id,source.sharing_scope))
    and daypop_family.event_access(e.id,e.owner_id,e.calendar_id,e.sharing_scope);
$$;
revoke all on function daypop_family.visible_related_events(uuid) from public,anon,authenticated;
grant execute on function daypop_family.visible_related_events(uuid) to authenticated;

create function daypop_family.can_delete_event(p_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare item public.events; actor uuid := (select auth.uid());
begin
  select * into item from public.events where id=p_id;
  if not found or actor is null then return false; end if;
  if item.owner_id=actor then return true; end if;
  return daypop_family.event_access(item.id,item.owner_id,item.calendar_id,item.sharing_scope,true)
    and not exists(with recursive descendants(id) as (
      select p_id union select x.replacement_event_id from descendants d
      join public.event_exceptions x on x.event_id=d.id where x.replacement_event_id is not null
    ) select 1 from descendants r
      where exists(select 1 from public.event_attachments a where a.event_id=r.id)
        or exists(select 1 from public.event_attendees a where a.event_id=r.id));
end;
$$;
create function daypop_family.can_delete_todo(p_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare item public.todos; actor uuid := (select auth.uid());
begin
  select * into item from public.todos where id=p_id;
  if not found or actor is null then return false; end if;
  if item.owner_id=actor then return true; end if;
  return daypop_family.todo_access(item.id,item.parent_id,item.owner_id,item.calendar_id,item.sharing_scope,true)
    and not exists(
      with recursive subtree(id) as (
        select p_id union select t.id from subtree parent join public.todos t on t.parent_id=parent.id
      ) select 1 from subtree s join public.todos t on t.id=s.id
        where not daypop_family.todo_access(t.id,t.parent_id,t.owner_id,t.calendar_id,t.sharing_scope,true)
    );
end;
$$;
revoke all on function daypop_family.can_delete_event(uuid),daypop_family.can_delete_todo(uuid) from public,anon,authenticated;
grant execute on function daypop_family.can_delete_event(uuid),daypop_family.can_delete_todo(uuid) to authenticated;

create function daypop_family.event_deletable(p_id uuid,p_owner uuid,p_calendar uuid,p_scope text)
returns boolean language sql stable security definer set search_path='' as $$
  select daypop_family.event_writable(p_id,p_owner,p_calendar,p_scope)
    and (not daypop_family.shared_calendar(p_calendar) or not exists(
      with recursive descendants(id) as (
        select p_id union select x.replacement_event_id from descendants d join public.event_exceptions x on x.event_id=d.id
        where x.replacement_event_id is not null
      ) select 1 from descendants d where not daypop_family.has_write_context('events',d.id)
        or exists(select 1 from public.event_exceptions x where (x.event_id=d.id or x.replacement_event_id=d.id)
          and not daypop_family.has_write_context('event_exceptions',x.id))
    ));
$$;
create function daypop_family.todo_deletable(p_id uuid,p_parent uuid,p_owner uuid,p_calendar uuid,p_scope text)
returns boolean language sql stable security definer set search_path='' as $$
  select daypop_family.todo_writable(p_id,p_parent,p_owner,p_calendar,p_scope)
    and (not daypop_family.shared_calendar(p_calendar) or not exists(
      with recursive descendants(id) as (
        select p_id union select t.id from descendants d join public.todos t on t.parent_id=d.id
      ) select 1 from descendants where not daypop_family.has_write_context('todos',id)
    ));
$$;
revoke all on function daypop_family.event_deletable(uuid,uuid,uuid,text),daypop_family.todo_deletable(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function daypop_family.event_deletable(uuid,uuid,uuid,text),daypop_family.todo_deletable(uuid,uuid,uuid,uuid,text) to authenticated;
alter policy events_delete_authorized on public.events using(daypop_family.event_deletable(id,owner_id,calendar_id,sharing_scope));
alter policy todos_delete_authorized on public.todos using(daypop_family.todo_deletable(id,parent_id,owner_id,calendar_id,sharing_scope));

create function daypop_family.guard_hidden_cascade()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if current_setting('role',true)='authenticated' and (select auth.uid()) is not null and old.owner_id<>(select auth.uid()) then
    if (tg_table_name='events' and not daypop_family.can_delete_event(old.id))
      or (tg_table_name='todos' and not daypop_family.can_delete_todo(old.id)) then
      raise exception using errcode='42501',message='sharing_owner_action_required';
    end if;
  end if;
  return old;
end;
$$;
revoke all on function daypop_family.guard_hidden_cascade() from public,anon,authenticated;
create trigger events_guard_hidden_cascade before delete on public.events for each row execute function daypop_family.guard_hidden_cascade();
create trigger todos_guard_hidden_cascade before delete on public.todos for each row execute function daypop_family.guard_hidden_cascade();

create function daypop_family.exception_content_access(p_event uuid,p_replacement uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.events e where e.id=p_event
    and daypop_family.event_access(e.id,e.owner_id,e.calendar_id,e.sharing_scope,true))
    and (p_replacement is null or exists(select 1 from public.events e where e.id=p_replacement
      and daypop_family.event_access(e.id,e.owner_id,e.calendar_id,e.sharing_scope,true)));
$$;
revoke all on function daypop_family.exception_content_access(uuid,uuid) from public,anon,authenticated;

create function daypop_family.prepare_write_context(p_versions jsonb,p_calendars uuid[] default '{}',p_exposure jsonb default '{}')
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid := (select auth.uid()); collection_entry record; version_entry record;
  item_id uuid; actual_time timestamptz; expected_time timestamptz; calendar_ids uuid[] := p_calendars;
  item_calendar uuid; can_edit boolean;
begin
  if actor is null then raise exception using errcode='42501',message='sharing_sign_in_required'; end if;
  if jsonb_typeof(p_versions) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_versions) k where k not in ('events','todos','event_exceptions')) then
    raise exception using errcode='22023',message='sharing_invalid_versions';
  end if;
  if jsonb_typeof(p_exposure) is distinct from 'object' then
    raise exception using errcode='22023',message='sharing_invalid_confirmation';
  end if;
  if to_regclass('pg_temp.daypop_shared_write_context') is not null and not exists(
    select 1 from pg_class where oid=to_regclass('pg_temp.daypop_shared_write_context') and relowner=current_user::regrole
  ) then raise exception using errcode='42501',message='sharing_untrusted_context'; end if;
  create temporary table if not exists pg_temp.daypop_shared_write_context(
    actor uuid not null,collection text not null,id uuid not null,primary key(actor,collection,id)
  ) on commit drop;
  truncate pg_temp.daypop_shared_write_context;
  for version_entry in select key,value from jsonb_each_text(p_exposure) loop
    calendar_ids := array_append(calendar_ids,version_entry.key::uuid);
  end loop;
  -- Calendar locks precede item locks, matching delete-calendar's lock order.
  -- The private helper returns no rows or versions to the caller.
  for collection_entry in select key,value from jsonb_each(p_versions) order by key loop
    if jsonb_typeof(collection_entry.value) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(collection_entry.value))>100000 then
      raise exception using errcode='22023',message='sharing_invalid_versions';
    end if;
    for version_entry in select key,value from jsonb_each_text(collection_entry.value) order by key loop
      item_id := version_entry.key::uuid;
      item_calendar := null;
      if collection_entry.key='events' then
        select calendar_id into item_calendar from public.events e where e.id=item_id
          and daypop_family.event_access(e.id,e.owner_id,e.calendar_id,e.sharing_scope,true);
      elsif collection_entry.key='todos' then
        select calendar_id into item_calendar from public.todos t where t.id=item_id
          and daypop_family.todo_access(t.id,t.parent_id,t.owner_id,t.calendar_id,t.sharing_scope,true);
      else
        select e.calendar_id into item_calendar from public.event_exceptions x join public.events e on e.id=x.event_id
        where x.id=item_id and daypop_family.exception_content_access(x.event_id,x.replacement_event_id);
      end if;
      if item_calendar is null then raise exception using errcode='42501',message='sharing_access_changed'; end if;
      calendar_ids := array_append(calendar_ids,item_calendar);
    end loop;
  end loop;
  if exists(select 1 from unnest(calendar_ids) c where daypop_family.calendar_access(c) is null
    or daypop_family.calendar_access(c) not in ('owner','edit')) then
    raise exception using errcode='42501',message='sharing_access_changed';
  end if;
  perform 1 from public.calendars where id=any(calendar_ids) order by id for update;
  for version_entry in select key,value from jsonb_each_text(p_exposure) loop
    select updated_at into actual_time from public.calendar_group_shares
    where calendar_id=version_entry.key::uuid and owner_id=actor;
    if not found or actual_time is distinct from version_entry.value::timestamptz then
      raise exception using errcode='P0001',message='sharing_conflict';
    end if;
    insert into pg_temp.daypop_shared_write_context values(actor,'exposure',version_entry.key::uuid);
  end loop;
  for collection_entry in select key,value from jsonb_each(p_versions) order by key loop
    for version_entry in select key,value from jsonb_each_text(collection_entry.value) order by key loop
      item_id := version_entry.key::uuid;
      expected_time := version_entry.value::timestamptz;
      actual_time := null; can_edit := false;
      if collection_entry.key='events' then
        select updated_at,daypop_family.event_access(e.id,e.owner_id,e.calendar_id,e.sharing_scope,true)
        into actual_time,can_edit from public.events e where e.id=item_id for update;
      elsif collection_entry.key='todos' then
        select updated_at,daypop_family.todo_access(t.id,t.parent_id,t.owner_id,t.calendar_id,t.sharing_scope,true)
        into actual_time,can_edit from public.todos t where t.id=item_id for update;
      else
        select updated_at,daypop_family.exception_content_access(x.event_id,x.replacement_event_id)
        into actual_time,can_edit from public.event_exceptions x where x.id=item_id for update;
      end if;
      if not coalesce(can_edit,false) then raise exception using errcode='42501',message='sharing_access_changed'; end if;
      if actual_time is distinct from expected_time then raise exception using errcode='P0001',message='sharing_conflict'; end if;
      insert into pg_temp.daypop_shared_write_context values(actor,collection_entry.key,item_id);
    end loop;
  end loop;
end;
$$;
revoke all on function daypop_family.prepare_write_context(jsonb,uuid[],jsonb) from public,anon,authenticated;
grant execute on function daypop_family.prepare_write_context(jsonb,uuid[],jsonb) to authenticated;

create function daypop_family.guard_item_move()
returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid := (select auth.uid()); target_share public.calendar_group_shares;
begin
  if current_setting('role',true)<>'authenticated' then return new; end if;
  if tg_op='UPDATE' and new.calendar_id is distinct from old.calendar_id then
    if old.owner_id<>actor then raise exception using errcode='42501',message='sharing_cannot_move_received'; end if;
    select * into target_share from public.calendar_group_shares where calendar_id=new.calendar_id;
    if target_share.calendar_id is not null
      and not daypop_family.has_write_context('exposure',new.calendar_id) then
      raise exception using errcode='P0001',message='sharing_confirm_exposure';
    end if;
  end if;
  if tg_table_name='todos' then
    if new.parent_id is not null and exists(
      with recursive ancestors(id,parent_id) as (
        select id,parent_id from public.todos where id=new.parent_id
        union select t.id,t.parent_id from ancestors a join public.todos t on t.id=a.parent_id
      ) select 1 from ancestors where id=new.id
    ) then raise exception using errcode='23514',message='sharing_invalid_parent'; end if;
  end if;
  return new;
end;
$$;
revoke all on function daypop_family.guard_item_move() from public,anon,authenticated;
create trigger events_guard_move before update on public.events for each row execute function daypop_family.guard_item_move();
create trigger todos_guard_move before insert or update on public.todos for each row execute function daypop_family.guard_item_move();

-- A row version must advance even for two statements in the same RPC/SQL
-- transaction (or a backwards wall clock). Keep the existing server timestamp
-- trigger and enforce a strict final value; clients retain full precision.
create function daypop_family.advance_item_version()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  new.updated_at := greatest(new.updated_at,old.updated_at+interval '1 microsecond');
  return new;
end;
$$;
revoke all on function daypop_family.advance_item_version() from public,anon,authenticated;
create trigger events_zz_version before update on public.events for each row execute function daypop_family.advance_item_version();
create trigger todos_zz_version before update on public.todos for each row execute function daypop_family.advance_item_version();
create trigger event_exceptions_zz_version before update on public.event_exceptions for each row execute function daypop_family.advance_item_version();
create trigger calendar_group_shares_zz_version before update on public.calendar_group_shares for each row execute function daypop_family.advance_item_version();

create function daypop_family.exception_writable(p_id uuid,p_event uuid,p_replacement uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select daypop_family.exception_access(p_event,p_replacement,true)
    and (not exists(select 1 from public.events e where e.id=p_event and daypop_family.shared_calendar(e.calendar_id))
      or daypop_family.has_write_context('event_exceptions',p_id));
$$;
revoke all on function daypop_family.exception_writable(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function daypop_family.exception_writable(uuid,uuid,uuid) to authenticated;
alter policy exceptions_update_authorized on public.event_exceptions
using(daypop_family.exception_writable(id,event_id,replacement_event_id))
with check(daypop_family.exception_writable(id,event_id,replacement_event_id));
alter policy exceptions_delete_authorized on public.event_exceptions
using(daypop_family.exception_writable(id,event_id,replacement_event_id));

create function public.write_shared_calendar_item(p_action text,p_payload jsonb,p_versions jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid := (select auth.uid()); item_id uuid; data_owner uuid;
  existing_event public.events; draft_event public.events; existing_todo public.todos; draft_todo public.todos;
  allowed_fields text[]; target_calendar uuid; affected integer; target_ids uuid[]; candidate uuid;
begin
  if actor is null then raise exception using errcode='42501',message='sharing_sign_in_required'; end if;
  if p_action in ('cancel_occurrence','replace_occurrence') then
    return daypop_family.write_occurrence(p_action,p_payload,p_versions);
  elsif p_action='delete_calendar' then
    return daypop_family.write_calendar_deletion(p_payload,p_versions);
  end if;
  if p_action not in ('create_event','update_event','delete_event','create_todo','update_todo','delete_todo')
    or p_action is null or jsonb_typeof(p_payload) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('id','values','confirmExposure')) then
    raise exception using errcode='22023',message='sharing_invalid_command';
  end if;
  item_id := (p_payload->>'id')::uuid;
  if item_id is null then raise exception using errcode='22023',message='sharing_invalid_command'; end if;
  if p_action like '%event' then
    select * into existing_event from public.events where id=item_id;
    if p_action<>'create_event' and not found then raise exception using errcode='42501',message='sharing_access_changed'; end if;
    allowed_fields := array['calendar_id','title','location','notes','is_all_day','start_date','end_date',
      'starts_at','ends_at','timezone','reminder_minutes','recurrence_rule','sharing_scope'];
  else
    select * into existing_todo from public.todos where id=item_id;
    if p_action<>'create_todo' and not found then raise exception using errcode='42501',message='sharing_access_changed'; end if;
    allowed_fields := array['calendar_id','parent_id','title','due_date','priority','completed_at','sort_order','sharing_scope'];
  end if;
  if p_action not like 'delete_%' then
    if jsonb_typeof(p_payload->'values') is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(p_payload->'values') k where not(k=any(allowed_fields))) then
      raise exception using errcode='22023',message='sharing_invalid_fields';
    end if;
    if p_action like '%event' then
      draft_event := jsonb_populate_record(null::public.events,p_payload->'values');
      draft_event.reminder_minutes := coalesce(draft_event.reminder_minutes,'{}');
      if p_action='create_event' then draft_event.sharing_scope := coalesce(draft_event.sharing_scope,'inherit'); end if;
      target_calendar := draft_event.calendar_id;
    else
      draft_todo := jsonb_populate_record(null::public.todos,p_payload->'values');
      if p_action='create_todo' then
        draft_todo.priority := coalesce(draft_todo.priority,'none');
        draft_todo.sort_order := coalesce(draft_todo.sort_order,0);
        draft_todo.sharing_scope := coalesce(draft_todo.sharing_scope,'inherit');
      end if;
      target_calendar := draft_todo.calendar_id;
    end if;
  else
    target_calendar := coalesce(existing_event.calendar_id,existing_todo.calendar_id);
  end if;
  select owner_id into data_owner from public.calendars where id=target_calendar;
  if data_owner is null or daypop_family.calendar_access(target_calendar) not in ('owner','edit') then
    raise exception using errcode='42501',message='sharing_access_changed';
  end if;
  if (existing_event.id is not null and existing_event.owner_id<>data_owner)
    or (existing_todo.id is not null and existing_todo.owner_id<>data_owner) then
    raise exception using errcode='42501',message='sharing_cannot_move_received';
  end if;
  -- A lost response may be acknowledged only when the CURRENT complete content
  -- already equals the intent. This does not write or relax stale overwrites.
  if p_action='update_event'
    and daypop_family.event_access(existing_event.id,existing_event.owner_id,existing_event.calendar_id,existing_event.sharing_scope,true)
    and (to_jsonb(existing_event)-array['id','owner_id','created_by','created_at','updated_at'])
      =(to_jsonb(draft_event)-array['id','owner_id','created_by','created_at','updated_at']) then
    return jsonb_build_object('applied',true,'id',item_id);
  elsif p_action='update_todo'
    and daypop_family.todo_access(existing_todo.id,existing_todo.parent_id,existing_todo.owner_id,existing_todo.calendar_id,existing_todo.sharing_scope,true)
    and (to_jsonb(existing_todo)-array['id','owner_id','created_by','created_at','updated_at'])
      =(to_jsonb(draft_todo)-array['id','owner_id','created_by','created_at','updated_at']) then
    return jsonb_build_object('applied',true,'id',item_id);
  end if;
  perform daypop_family.prepare_write_context(p_versions,
    array_remove(array[target_calendar,existing_event.calendar_id,existing_todo.calendar_id],null),
    coalesce(p_payload->'confirmExposure','{}'::jsonb));

  if p_action='create_event' then
    if existing_event.id is not null then
      if existing_event.created_by=actor and existing_event.calendar_id=target_calendar
        and (to_jsonb(existing_event)-array['id','owner_id','created_by','created_at','updated_at'])
          = (to_jsonb(draft_event)-array['id','owner_id','created_by','created_at','updated_at']) then
        return jsonb_build_object('applied',true,'id',item_id);
      end if;
      raise exception using errcode='P0001',message='sharing_conflict';
    end if;
    insert into public.events(id,owner_id,calendar_id,title,location,notes,is_all_day,start_date,end_date,
      starts_at,ends_at,timezone,reminder_minutes,recurrence_rule,sharing_scope)
    values(item_id,data_owner,target_calendar,draft_event.title,draft_event.location,draft_event.notes,draft_event.is_all_day,
      draft_event.start_date,draft_event.end_date,draft_event.starts_at,draft_event.ends_at,draft_event.timezone,
      coalesce(draft_event.reminder_minutes,'{}'),draft_event.recurrence_rule,coalesce(draft_event.sharing_scope,'inherit'));
  elsif p_action='update_event' then
    if not daypop_family.has_write_context('events',item_id) then raise exception using errcode='P0001',message='sharing_conflict'; end if;
    if draft_event.sharing_scope is distinct from existing_event.sharing_scope then
      if existing_event.owner_id<>actor then raise exception using errcode='42501',message='sharing_calendar_owner_required'; end if;
      if exists(select 1 from daypop_family.visible_related_events(item_id) r where not daypop_family.has_write_context('events',r.id)) then
        raise exception using errcode='P0001',message='sharing_conflict';
      end if;
      update public.events set sharing_scope=draft_event.sharing_scope
      where id in (select id from daypop_family.visible_related_events(item_id));
    end if;
    update public.events set calendar_id=target_calendar,title=draft_event.title,location=draft_event.location,notes=draft_event.notes,
      is_all_day=draft_event.is_all_day,start_date=draft_event.start_date,end_date=draft_event.end_date,
      starts_at=draft_event.starts_at,ends_at=draft_event.ends_at,timezone=draft_event.timezone,
      reminder_minutes=coalesce(draft_event.reminder_minutes,'{}'),recurrence_rule=draft_event.recurrence_rule,
      sharing_scope=draft_event.sharing_scope
    where id=item_id;
    get diagnostics affected=row_count;
    if affected<>1 then raise exception using errcode='42501',message='sharing_access_changed'; end if;
  elsif p_action='delete_event' then
    if not daypop_family.can_delete_event(item_id) then raise exception using errcode='42501',message='sharing_owner_action_required'; end if;
    select array_agg(id) into target_ids from (
      with recursive descendants(id) as (
        select item_id union select x.replacement_event_id from descendants d
        join public.event_exceptions x on x.event_id=d.id where x.replacement_event_id is not null
      ) select id from descendants
    ) targets;
    if exists(select 1 from unnest(target_ids) id where not daypop_family.has_write_context('events',id))
      or exists(select 1 from public.event_exceptions x where (x.event_id=any(target_ids) or x.replacement_event_id=any(target_ids))
        and not daypop_family.has_write_context('event_exceptions',x.id)) then
      raise exception using errcode='P0001',message='sharing_conflict';
    end if;
    foreach candidate in array target_ids loop
      if existing_event.owner_id=actor then
        if not public.delete_event_with_attachment_cleanup(candidate) then raise exception using errcode='42501',message='sharing_access_changed'; end if;
      else
        delete from public.events where id=candidate;
        get diagnostics affected=row_count;
        if affected<>1 then raise exception using errcode='42501',message='sharing_access_changed'; end if;
      end if;
    end loop;
  elsif p_action='create_todo' then
    if existing_todo.id is not null then
      if existing_todo.created_by=actor and existing_todo.calendar_id=target_calendar
        and (to_jsonb(existing_todo)-array['id','owner_id','created_by','created_at','updated_at'])
          = (to_jsonb(draft_todo)-array['id','owner_id','created_by','created_at','updated_at']) then
        return jsonb_build_object('applied',true,'id',item_id);
      end if;
      raise exception using errcode='P0001',message='sharing_conflict';
    end if;
    insert into public.todos(id,owner_id,calendar_id,parent_id,title,due_date,priority,completed_at,sort_order,sharing_scope)
    values(item_id,data_owner,target_calendar,draft_todo.parent_id,draft_todo.title,draft_todo.due_date,
      coalesce(draft_todo.priority,'none'),draft_todo.completed_at,coalesce(draft_todo.sort_order,0),coalesce(draft_todo.sharing_scope,'inherit'));
  elsif p_action='update_todo' then
    if not daypop_family.has_write_context('todos',item_id) then raise exception using errcode='P0001',message='sharing_conflict'; end if;
    update public.todos set calendar_id=target_calendar,parent_id=draft_todo.parent_id,title=draft_todo.title,due_date=draft_todo.due_date,
      priority=draft_todo.priority,completed_at=draft_todo.completed_at,sort_order=draft_todo.sort_order,sharing_scope=draft_todo.sharing_scope
    where id=item_id;
    get diagnostics affected=row_count;
    if affected<>1 then raise exception using errcode='42501',message='sharing_access_changed'; end if;
  else
    if not daypop_family.can_delete_todo(item_id) then raise exception using errcode='42501',message='sharing_owner_action_required'; end if;
    if exists(
      with recursive descendants(id) as (
        select item_id union select t.id from descendants d join public.todos t on t.parent_id=d.id
      ) select 1 from descendants where not daypop_family.has_write_context('todos',id)
    ) then raise exception using errcode='P0001',message='sharing_conflict'; end if;
    delete from public.todos where id=item_id;
    get diagnostics affected=row_count;
    if affected<>1 then raise exception using errcode='42501',message='sharing_access_changed'; end if;
  end if;
  return jsonb_build_object('applied',true,'id',item_id);
end;
$$;
revoke all on function public.write_shared_calendar_item(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.write_shared_calendar_item(text,jsonb,jsonb) to authenticated;

create function daypop_family.write_occurrence(p_action text,p_payload jsonb,p_versions jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare source public.events; previous public.event_exceptions; replacement public.events; draft public.events;
  occurrence_key_date date := (p_payload->>'occurrenceDate')::date;
  occurrence_time timestamptz := (p_payload->>'occurrenceStartsAt')::timestamptz;
  event_id_value uuid := (p_payload->>'id')::uuid; target_calendar uuid;
begin
  if p_action not in ('cancel_occurrence','replace_occurrence')
    or jsonb_typeof(p_payload) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_payload) k where k not in
      ('id','exceptionId','occurrenceDate','occurrenceStartsAt','values','confirmExposure'))
    or (occurrence_key_date is null)=(occurrence_time is null) then
    raise exception using errcode='22023',message='sharing_invalid_command';
  end if;
  select * into source from public.events where id=event_id_value;
  if not found or not daypop_family.event_access(source.id,source.owner_id,source.calendar_id,source.sharing_scope,true) then
    raise exception using errcode='42501',message='sharing_access_changed';
  end if;
  if source.recurrence_rule is null then raise exception using errcode='22023',message='sharing_not_recurring'; end if;
  select * into previous from public.event_exceptions where event_id=source.id
    and event_exceptions.occurrence_date is not distinct from occurrence_key_date
    and event_exceptions.occurrence_starts_at is not distinct from occurrence_time;
  if p_action='cancel_occurrence' and previous.is_cancelled then
    return jsonb_build_object('applied',true,'id',source.id);
  end if;
  target_calendar := source.calendar_id;
  if p_action='replace_occurrence' then
    if jsonb_typeof(p_payload->'values') is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(p_payload->'values') k where k not in
        ('id','calendar_id','title','location','notes','is_all_day','start_date','end_date',
         'starts_at','ends_at','timezone','reminder_minutes','recurrence_rule','sharing_scope')) then
      raise exception using errcode='22023',message='sharing_invalid_fields';
    end if;
    draft := jsonb_populate_record(null::public.events,p_payload->'values');
    draft.recurrence_rule := null;
    draft.reminder_minutes := coalesce(draft.reminder_minutes,'{}');
    draft.sharing_scope := coalesce(draft.sharing_scope,source.sharing_scope);
    target_calendar := draft.calendar_id;
    if not exists(select 1 from public.calendars where id=target_calendar and owner_id=source.owner_id)
      or daypop_family.calendar_access(target_calendar) not in ('owner','edit') then
      raise exception using errcode='42501',message='sharing_cannot_move_received';
    end if;
    if source.owner_id<>(select auth.uid()) and target_calendar<>source.calendar_id then
      raise exception using errcode='42501',message='sharing_cannot_move_received';
    end if;
    select * into replacement from public.events where id=previous.replacement_event_id;
    if replacement.id is not null and not previous.is_cancelled
      and (to_jsonb(replacement)-array['id','owner_id','created_by','created_at','updated_at'])
        =(to_jsonb(draft)-array['id','owner_id','created_by','created_at','updated_at']) then
      return jsonb_build_object('applied',true,'id',source.id);
    end if;
  end if;
  perform daypop_family.prepare_write_context(p_versions,array[source.calendar_id,target_calendar],
    coalesce(p_payload->'confirmExposure','{}'::jsonb));
  if exists(select 1 from daypop_family.visible_related_events(source.id) r
      where not daypop_family.has_write_context('events',r.id))
    or exists(select 1 from public.event_exceptions x
      where x.event_id in (select id from daypop_family.visible_related_events(source.id))
      and not daypop_family.has_write_context('event_exceptions',x.id)) then
    raise exception using errcode='P0001',message='sharing_conflict';
  end if;
  if p_action='cancel_occurrence' then
    perform public.cancel_event_occurrence(source.id,(p_payload->>'exceptionId')::uuid,occurrence_key_date,occurrence_time);
  else
    if draft.sharing_scope is distinct from source.sharing_scope then
      if source.owner_id<>(select auth.uid()) then raise exception using errcode='42501',message='sharing_calendar_owner_required'; end if;
      update public.events set sharing_scope=draft.sharing_scope
      where id in (select id from daypop_family.visible_related_events(source.id));
    end if;
    perform public.replace_event_occurrence(source.id,(p_payload->>'exceptionId')::uuid,occurrence_key_date,occurrence_time,
      (p_payload->'values')||jsonb_build_object('sharing_scope',draft.sharing_scope));
  end if;
  -- The root is the version of the series graph, including a newly added key.
  update public.events set updated_at=updated_at where id=source.id;
  return jsonb_build_object('applied',true,'id',source.id);
end;
$$;
revoke all on function daypop_family.write_occurrence(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function daypop_family.write_occurrence(text,jsonb,jsonb) to authenticated;

-- This helper only validates and arms a transaction marker. The calendar RPC
-- below still executes all actual mutations as the authenticated INVOKER.
create function daypop_family.authorize_calendar_deletion(p_calendar uuid,p_versions jsonb,p_exposure jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid := (select auth.uid()); target uuid; own_calendars uuid[];
begin
  if actor is null or not exists(select 1 from public.calendars where id=p_calendar and owner_id=actor) then
    raise exception using errcode='42501',message='sharing_calendar_owner_required';
  end if;
  perform 1 from public.calendars where owner_id=actor order by id for update;
  select array_agg(id order by id) into own_calendars from public.calendars where owner_id=actor;
  select id into target from public.calendars where owner_id=actor and id<>p_calendar
    order by is_default desc,sort_order,created_at,id limit 1;
  if target is null then raise exception 'cannot delete the only calendar' using errcode='P0001'; end if;
  perform daypop_family.prepare_write_context(p_versions,own_calendars,p_exposure);
  if exists(select 1 from public.events where calendar_id=p_calendar and not daypop_family.has_write_context('events',id))
    or exists(select 1 from public.todos where calendar_id=p_calendar and not daypop_family.has_write_context('todos',id)) then
    raise exception using errcode='P0001',message='sharing_conflict';
  end if;
  insert into pg_temp.daypop_shared_write_context values(actor,'calendar_delete',p_calendar);
end;
$$;
revoke all on function daypop_family.authorize_calendar_deletion(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function daypop_family.authorize_calendar_deletion(uuid,jsonb,jsonb) to authenticated;

create function daypop_family.write_calendar_deletion(p_payload jsonb,p_versions jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item_id uuid := (p_payload->>'id')::uuid;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' or item_id is null
    or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('id','confirmExposure')) then
    raise exception using errcode='22023',message='sharing_invalid_command';
  end if;
  if not exists(select 1 from public.calendars where id=item_id and owner_id=(select auth.uid())) then
    raise exception using errcode='42501',message='sharing_calendar_owner_required';
  end if;
  perform daypop_family.authorize_calendar_deletion(item_id,p_versions,coalesce(p_payload->'confirmExposure','{}'::jsonb));
  perform public.delete_calendar_with_reassignment(item_id);
  return jsonb_build_object('applied',true,'id',item_id);
end;
$$;
revoke all on function daypop_family.write_calendar_deletion(jsonb,jsonb) from public,anon,authenticated;
grant execute on function daypop_family.write_calendar_deletion(jsonb,jsonb) to authenticated;

create function daypop_family.guard_calendar_deletion()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if current_setting('role',true)='authenticated' and daypop_family.shared_calendar(old.id)
    and not daypop_family.has_write_context('calendar_delete',old.id) then
    raise exception using errcode='P0001',message='sharing_disable_before_import';
  end if;
  return old;
end;
$$;
revoke all on function daypop_family.guard_calendar_deletion() from public,anon,authenticated;
create trigger calendars_guard_sharing_delete before delete on public.calendars
for each row execute function daypop_family.guard_calendar_deletion();

-- A direct permitted creation also takes the calendar lock. Otherwise a child
-- could arrive after the version-checked delete inspected its subtree, only to
-- be removed by the FK cascade. No row data is returned or mutated here.
create function daypop_family.lock_new_item_calendar()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if current_setting('role',true)='authenticated' and daypop_family.shared_calendar(new.calendar_id)
    and daypop_family.calendar_access(new.calendar_id) in ('owner','edit') then
    perform 1 from public.calendars where id=new.calendar_id for update;
  end if;
  return new;
end;
$$;
revoke all on function daypop_family.lock_new_item_calendar() from public,anon,authenticated;
create trigger events_lock_shared_creation before insert on public.events for each row execute function daypop_family.lock_new_item_calendar();
create trigger todos_lock_shared_creation before insert on public.todos for each row execute function daypop_family.lock_new_item_calendar();

create function daypop_family.lock_share_calendar()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    perform 1 from public.calendars where id=old.calendar_id for update;
    return old;
  end if;
  perform 1 from public.calendars where id=new.calendar_id for update;
  return new;
end;
$$;
revoke all on function daypop_family.lock_share_calendar() from public,anon,authenticated;
create trigger calendar_group_shares_lock_calendar before insert or update or delete on public.calendar_group_shares
for each row execute function daypop_family.lock_share_calendar();

-- Legacy RPC bodies below are copied from their LAST definitions, not their
-- original migrations. Shared calls must arm the same checked transaction.
create function daypop_family.assert_rpc_context(p_event uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.events e where e.id=p_event
    and daypop_family.event_access(e.id,e.owner_id,e.calendar_id,e.sharing_scope)
    and daypop_family.shared_calendar(e.calendar_id))
    and (exists(select 1 from daypop_family.related_events(p_event) r where not daypop_family.has_write_context('events',r.id))
      or exists(select 1 from public.event_exceptions x where x.event_id in (select id from daypop_family.related_events(p_event))
        and not daypop_family.has_write_context('event_exceptions',x.id))) then
    raise exception using errcode='P0001',message='sharing_conflict';
  end if;
end;
$$;
revoke all on function daypop_family.assert_rpc_context(uuid) from public,anon,authenticated;
grant execute on function daypop_family.assert_rpc_context(uuid) to authenticated;

-- Last source: 20260830000000_event_occurrence_rpcs.sql
create or replace function public.cancel_event_occurrence(
  p_event_id uuid,
  p_exception_id uuid,
  p_occurrence_date date,
  p_occurrence_starts_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  account_id uuid;
  existing public.event_exceptions;
  stored public.event_exceptions;
  cleanup_count integer;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select event.owner_id into account_id from public.events event where event.id=p_event_id;
  perform daypop_family.assert_rpc_context(p_event_id);

  if (p_occurrence_date is null) = (p_occurrence_starts_at is null) then
    raise exception 'exactly one occurrence key is required' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.events event
    where event.id = p_event_id
      and event.owner_id = account_id
      and event.recurrence_rule is not null
  ) then
    raise exception 'event is not a recurring event owned by the caller'
      using errcode = '22023';
  end if;

  -- Reconciled against the stored row, not against anything the caller sent.
  -- This is what makes a retried write update the existing exception instead of
  -- inserting a duplicate the partial unique index would reject.
  select *
    into existing
  from public.event_exceptions candidate
  where candidate.event_id = p_event_id
    and candidate.owner_id = account_id
    and candidate.occurrence_date is not distinct from p_occurrence_date
    and candidate.occurrence_starts_at is not distinct from p_occurrence_starts_at;

  if existing.replacement_event_id is not null and not daypop_family.can_delete_event(existing.replacement_event_id) then
    raise exception using errcode='42501',message='sharing_owner_action_required';
  end if;
  if existing.id is not null then
    update public.event_exceptions
    set is_cancelled = true, replacement_event_id = null
    where id = existing.id
      and owner_id = account_id
    returning * into stored;
  else
    -- A proposed id that is already taken is refused rather than silently
    -- updating somebody else's row through `ON CONFLICT`.
    if p_exception_id is not null and exists (
      select 1 from public.event_exceptions candidate where candidate.id = p_exception_id
    ) then
      raise exception 'proposed exception id already exists' using errcode = '23505';
    end if;

    insert into public.event_exceptions (
      id, owner_id, event_id, occurrence_date, occurrence_starts_at,
      is_cancelled, replacement_event_id
    )
    values (
      coalesce(p_exception_id, pg_catalog.gen_random_uuid()), account_id, p_event_id,
      p_occurrence_date, p_occurrence_starts_at, true, null
    )
    returning * into stored;
  end if;

  -- The exception has stopped pointing at the replacement before that event is
  -- deleted. Both FKs are `on delete cascade`, so the other order would take
  -- this row with it.
  if existing.replacement_event_id is not null then
    -- **No `ON CONFLICT` here, deliberately.** `20260809085514` removed exactly
    -- that clause from both delete RPCs, and this migration reintroduced it by
    -- copying the superseded body — pgTAP caught it as `new row violates
    -- row-level security policy for table attachment_cleanup_jobs`.
    --
    -- The reason: `attachment_cleanup_jobs_select_orphan_own` only makes a
    -- queued row visible once no `event_attachments` row still holds that
    -- `object_path`. At this point the metadata is still there — the cascade
    -- below has not run yet — so the row just inserted is invisible, and
    -- `ON CONFLICT` has to read the conflicting row to decide what to do.
    --
    -- Conflict handling is not needed anyway: the delete below cascades the
    -- metadata away, so a retry finds nothing to enqueue and, having set
    -- `replacement_event_id` to null, never reaches this block at all.
    insert into public.attachment_cleanup_jobs (owner_id, bucket_id, object_path)
    select attachment.owner_id, 'event-attachments', attachment.object_path
    from public.event_attachments attachment
    where attachment.event_id = existing.replacement_event_id
      and attachment.owner_id = account_id;

    get diagnostics cleanup_count = row_count;

    delete from public.events event
    where event.id = existing.replacement_event_id
      and event.owner_id = account_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'exception', pg_catalog.to_jsonb(stored),
    'deleted_event_id', existing.replacement_event_id,
    'enqueued_cleanup', coalesce(cleanup_count, 0)
  );
end;
$$;

-- Last source: 20260830000000_event_occurrence_rpcs.sql
create or replace function public.replace_event_occurrence(
  p_event_id uuid,
  p_exception_id uuid,
  p_occurrence_date date,
  p_occurrence_starts_at timestamptz,
  p_replacement jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  account_id uuid;
  existing public.event_exceptions;
  replacement_id uuid;
  stored public.event_exceptions;
  stored_event public.events;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select event.owner_id into account_id from public.events event where event.id=p_event_id;
  perform daypop_family.assert_rpc_context(p_event_id);

  if (p_occurrence_date is null) = (p_occurrence_starts_at is null) then
    raise exception 'exactly one occurrence key is required' using errcode = '22023';
  end if;

  if coalesce(pg_catalog.jsonb_typeof(p_replacement), 'null') <> 'object' then
    raise exception 'replacement payload must be an object' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.events event
    where event.id = p_event_id
      and event.owner_id = account_id
      and event.recurrence_rule is not null
  ) then
    raise exception 'event is not a recurring event owned by the caller'
      using errcode = '22023';
  end if;

  select *
    into existing
  from public.event_exceptions candidate
  where candidate.event_id = p_event_id
    and candidate.owner_id = account_id
    and candidate.occurrence_date is not distinct from p_occurrence_date
    and candidate.occurrence_starts_at is not distinct from p_occurrence_starts_at;

  -- Reusing the stored replacement is what keeps a retry from stacking up
  -- orphan events: the caller's proposed id is only used the first time.
  replacement_id := coalesce(
    existing.replacement_event_id,
    (p_replacement ->> 'id')::uuid,
    pg_catalog.gen_random_uuid()
  );

  if existing.replacement_event_id is null and exists (
    select 1
    from public.events event
    where event.id = replacement_id
  ) then
    raise exception 'proposed replacement id already exists' using errcode = '23505';
  end if;

  insert into public.events (
    id, owner_id, calendar_id, title, location, notes, is_all_day,
    start_date, end_date, starts_at, ends_at, timezone,
    reminder_minutes, recurrence_rule, sharing_scope
  )
  values (
    replacement_id,
    account_id,
    (p_replacement ->> 'calendar_id')::uuid,
    p_replacement ->> 'title',
    p_replacement ->> 'location',
    p_replacement ->> 'notes',
    (p_replacement ->> 'is_all_day')::boolean,
    (p_replacement ->> 'start_date')::date,
    (p_replacement ->> 'end_date')::date,
    (p_replacement ->> 'starts_at')::timestamptz,
    (p_replacement ->> 'ends_at')::timestamptz,
    p_replacement ->> 'timezone',
    coalesce(
      (
        select pg_catalog.array_agg(entry::integer)
        from pg_catalog.jsonb_array_elements_text(p_replacement -> 'reminder_minutes') as entry
      ),
      '{}'::integer[]
    ),
    null,
    coalesce(p_replacement ->> 'sharing_scope', 'inherit')
  )
  on conflict (id) do update set
    calendar_id = excluded.calendar_id,
    title = excluded.title,
    location = excluded.location,
    notes = excluded.notes,
    is_all_day = excluded.is_all_day,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    timezone = excluded.timezone,
    reminder_minutes = excluded.reminder_minutes,
    recurrence_rule = null,
    sharing_scope = excluded.sharing_scope
  returning * into stored_event;

  if existing.id is not null then
    update public.event_exceptions
    set is_cancelled = false, replacement_event_id = replacement_id
    where id = existing.id
      and owner_id = account_id
    returning * into stored;
  else
    if p_exception_id is not null and exists (
      select 1 from public.event_exceptions candidate where candidate.id = p_exception_id
    ) then
      raise exception 'proposed exception id already exists' using errcode = '23505';
    end if;

    insert into public.event_exceptions (
      id, owner_id, event_id, occurrence_date, occurrence_starts_at,
      is_cancelled, replacement_event_id
    )
    values (
      coalesce(p_exception_id, pg_catalog.gen_random_uuid()), account_id, p_event_id,
      p_occurrence_date, p_occurrence_starts_at, false, replacement_id
    )
    returning * into stored;
  end if;

  return pg_catalog.jsonb_build_object(
    'exception', pg_catalog.to_jsonb(stored),
    'event', pg_catalog.to_jsonb(stored_event)
  );
end;
$$;

-- Last source: 20260809085514_fix_attachment_cleanup_enqueue.sql
create or replace function public.delete_event_with_attachment_cleanup(
  p_event_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform daypop_family.assert_rpc_context(p_event_id);

  insert into public.attachment_cleanup_jobs (owner_id, bucket_id, object_path)
  select attachment.owner_id, 'event-attachments', attachment.object_path
  from public.event_attachments attachment
  where attachment.event_id = p_event_id
    and attachment.owner_id = (select auth.uid());

  delete from public.events event
  where event.id = p_event_id
    and event.owner_id = (select auth.uid());

  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;

-- Last source: 20261007000000_delete_calendar_rpc.sql
create or replace function public.delete_calendar_with_reassignment(
  p_calendar_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target_id uuid;
  target_is_default boolean;
begin
  if caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Serialise every calendar deletion by this owner. Without it two concurrent
  -- calls could each pick the other's calendar as the target.
  perform 1
  from public.calendars calendar
  where calendar.owner_id = caller
  order by calendar.id
  for update;

  if not exists (
    select 1
    from public.calendars calendar
    where calendar.id = p_calendar_id
      and calendar.owner_id = caller
  ) then
    return false;
  end if;

  select calendar.id, calendar.is_default
  into target_id, target_is_default
  from public.calendars calendar
  where calendar.owner_id = caller
    and calendar.id <> p_calendar_id
  order by calendar.is_default desc, calendar.sort_order, calendar.created_at, calendar.id
  limit 1;

  if target_id is null then
    raise exception 'cannot delete the only calendar' using errcode = 'P0001';
  end if;

  if (daypop_family.shared_calendar(p_calendar_id) or daypop_family.shared_calendar(target_id))
    and not daypop_family.has_write_context('calendar_delete',p_calendar_id) then
    raise exception using errcode='P0001',message='sharing_conflict';
  end if;

  update public.events event
  set calendar_id = target_id
  where event.calendar_id = p_calendar_id
    and event.owner_id = caller;

  update public.todos todo
  set calendar_id = target_id
  where todo.calendar_id = p_calendar_id
    and todo.owner_id = caller;

  update public.stickers sticker
  set calendar_id = target_id
  where sticker.calendar_id = p_calendar_id
    and sticker.owner_id = caller;

  delete from public.calendars calendar
  where calendar.id = p_calendar_id
    and calendar.owner_id = caller;

  -- Only now, with the old default gone, can another row carry the flag.
  if not target_is_default then
    update public.calendars calendar
    set is_default = true
    where calendar.id = target_id
      and calendar.owner_id = caller;
  end if;

  return true;
end;
$$;

revoke all on function public.delete_calendar_with_reassignment(uuid) from public;
revoke all on function public.delete_calendar_with_reassignment(uuid) from anon;
grant execute on function public.delete_calendar_with_reassignment(uuid) to authenticated;
