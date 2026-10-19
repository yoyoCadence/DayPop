-- DP-047 / ADR §9. Group management only; calendar/data policies stay owner-only.
-- Apply with the owner's CLI workflow before deploying the frontend.
-- The exposed RPCs are invokers. The narrowly scoped implementations live in
-- a separate, non-exposed schema: clients must not forge membership rows, and
-- invitation acceptance must read the current verified Auth email. Every helper
-- derives identity from auth.uid(), pins search_path, and rejects anonymous use.
-- Unlike a generic privileged CRUD endpoint, no helper accepts a caller/owner
-- identity or role, executes dynamic SQL, or returns raw profile/Auth rows.

create schema daypop_family;
revoke all on schema daypop_family from public, anon, authenticated;
grant usage on schema daypop_family to authenticated;

create table public.family_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint family_groups_name check (name = btrim(name) and char_length(name) between 1 and 80)
);

create table public.family_memberships (
  group_id uuid not null references public.family_groups(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id,user_id)
);
create unique index family_one_owner_per_group_idx on public.family_memberships(group_id) where role='owner';

create table public.family_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.family_groups(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  email text not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending','accepted','declined','revoked','expired')),
  expires_at timestamptz not null,
  accepted_by uuid references auth.users(id) on delete set null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint family_invitation_email check (
    email = lower(btrim(email)) and char_length(email) <= 320
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  )
);
create unique index family_pending_email_idx on public.family_invitations(group_id,email) where status='pending';
create index family_invitations_group_expiry_idx on public.family_invitations(group_id,status,expires_at);
create index family_invitations_inviter_idx on public.family_invitations(invited_by);
create index family_invitations_accepted_by_idx on public.family_invitations(accepted_by);

create trigger family_groups_insert_time before insert on public.family_groups for each row execute function public.set_updated_at();
create trigger family_groups_update_time before update on public.family_groups for each row execute function public.set_updated_at();
create trigger family_memberships_insert_time before insert on public.family_memberships for each row execute function public.set_updated_at();
create trigger family_memberships_update_time before update on public.family_memberships for each row execute function public.set_updated_at();
create trigger family_invitations_insert_time before insert on public.family_invitations for each row execute function public.set_updated_at();
create trigger family_invitations_update_time before update on public.family_invitations for each row execute function public.set_updated_at();

alter table public.family_groups enable row level security;
alter table public.family_memberships enable row level security;
alter table public.family_invitations enable row level security;
revoke all on public.family_groups,public.family_memberships,public.family_invitations from public,anon,authenticated;
grant select on public.family_groups,public.family_memberships to authenticated;
-- Even the owner cannot read token hashes via REST. The raw token is returned
-- once by invite/resend and never included in the durable state projection.
grant select (id,group_id,invited_by,email,status,expires_at,created_at,updated_at)
  on public.family_invitations to authenticated;

create function daypop_family.is_member(p_group_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.family_memberships m
    where m.group_id=p_group_id and m.user_id=(select auth.uid())
  );
$$;
create function daypop_family.is_owner(p_group_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.family_groups g
    join public.family_memberships m on m.group_id=g.id and m.user_id=g.owner_id and m.role='owner'
    where g.id=p_group_id and g.owner_id=(select auth.uid())
  );
$$;
create function daypop_family.confirmed_email()
returns text language sql stable security definer set search_path='' as $$
  select lower(btrim(u.email)) from auth.users u
  where u.id=(select auth.uid()) and u.email_confirmed_at is not null;
$$;
revoke all on function daypop_family.is_member(uuid),daypop_family.is_owner(uuid),daypop_family.confirmed_email() from public,anon,authenticated;
grant execute on function daypop_family.is_member(uuid),daypop_family.is_owner(uuid),daypop_family.confirmed_email() to authenticated;

create policy family_groups_read_member on public.family_groups for select to authenticated
using (daypop_family.is_member(id));
create policy family_memberships_read_member on public.family_memberships for select to authenticated
using (daypop_family.is_member(group_id));
create policy family_invitations_read_owner_or_recipient on public.family_invitations for select to authenticated
using (daypop_family.is_owner(group_id) or email=(select daypop_family.confirmed_email()));
-- No direct INSERT/UPDATE/DELETE grants or policies. Controlled RPCs below are
-- the only mutation path and serialize on the group before checking capacity.

create function daypop_family.snapshot()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  caller uuid := (select auth.uid());
  family public.family_groups%rowtype;
  caller_role text;
begin
  if caller is null or not exists(select 1 from auth.users where id=caller) then
    raise exception using errcode='P0001',message='family_sign_in_required';
  end if;
  select g.*,m.role into family.id,family.owner_id,family.name,family.created_at,family.updated_at,caller_role
  from public.family_groups g join public.family_memberships m on m.group_id=g.id where m.user_id=caller;
  if not found then
    return jsonb_build_object('group',null,'members','[]'::jsonb,'invitations','[]'::jsonb);
  end if;
  return jsonb_build_object(
    'group',jsonb_build_object('id',family.id,'ownerId',family.owner_id,'name',family.name,'createdAt',family.created_at,'updatedAt',family.updated_at),
    'members',(
      select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'role',m.role,
        'displayName',coalesce(nullif(btrim(p.display_name),''),'成員 '||right(m.user_id::text,4)),
        'joinedAt',m.created_at) order by (m.role='owner') desc,m.created_at,m.user_id),'[]'::jsonb)
      from public.family_memberships m left join public.profiles p on p.id=m.user_id where m.group_id=family.id
    ),
    'invitations',case when caller_role='owner' and family.owner_id=caller then (
      select coalesce(jsonb_agg(invitation.data order by invitation.active desc,invitation.created_at desc,invitation.id),'[]'::jsonb)
      from (
        select i.id,i.created_at,(i.status='pending' and i.expires_at>statement_timestamp()) as active,
          jsonb_build_object('id',i.id,'email',i.email,
            'status',case when i.expires_at<=statement_timestamp() then 'expired' else i.status end,
            'expiresAt',i.expires_at,'createdAt',i.created_at) as data
        from public.family_invitations i where i.group_id=family.id and i.status in ('pending','expired')
        order by (i.status='pending' and i.expires_at>statement_timestamp()) desc,i.created_at desc,i.id limit 20
      ) invitation
    ) else '[]'::jsonb end
  );
end;
$$;

create function daypop_family.preview(p_token text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  caller uuid := (select auth.uid());
  caller_email text;
  invitation public.family_invitations%rowtype;
begin
  if caller is null then raise exception using errcode='P0001',message='family_sign_in_required'; end if;
  caller_email := daypop_family.confirmed_email();
  if caller_email is null then raise exception using errcode='P0001',message='family_email_unverified'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='P0001',message='family_invitation_unavailable';
  end if;
  select * into invitation from public.family_invitations
  where token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
  if not found or invitation.status<>'pending' or invitation.expires_at<=statement_timestamp() then
    raise exception using errcode='P0001',message='family_invitation_unavailable';
  end if;
  if invitation.email<>caller_email then raise exception using errcode='P0001',message='family_email_mismatch'; end if;
  return (
    select jsonb_build_object('id',invitation.id,'groupId',g.id,'groupName',g.name,
      'inviterName',coalesce(nullif(btrim(p.display_name),''),'家庭擁有者'),'expiresAt',invitation.expires_at)
    from public.family_groups g left join public.profiles p on p.id=g.owner_id where g.id=invitation.group_id
  );
end;
$$;

create function daypop_family.command(p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  caller uuid := (select auth.uid());
  caller_email text;
  email_verified boolean;
  family public.family_groups%rowtype;
  invitation public.family_invitations%rowtype;
  caller_role text;
  allowed_keys text[];
  requested_group uuid;
  requested_invitation uuid;
  requested_member uuid;
  requested_name text;
  requested_email text;
  raw_token text;
  reserved integer;
  invitation_result jsonb := null;
begin
  if caller is null then raise exception using errcode='P0001',message='family_sign_in_required'; end if;
  -- Lock identity before group locks. A verified-email change cannot race an
  -- acceptance between its email check and the membership insert.
  select lower(btrim(u.email)),u.email_confirmed_at is not null into caller_email,email_verified
  from auth.users u where u.id=caller for share;
  if not found then raise exception using errcode='P0001',message='family_sign_in_required'; end if;
  allowed_keys := case p_action
    when 'create' then array['name'] when 'rename' then array['groupId','name']
    when 'invite' then array['groupId','email']
    when 'resend' then array['groupId','invitationId'] when 'revoke' then array['groupId','invitationId']
    when 'accept' then array['token'] when 'decline' then array['token']
    when 'remove' then array['groupId','memberId']
    when 'leave' then array['groupId'] when 'dissolve' then array['groupId'] else null end;
  if allowed_keys is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode='P0001',message='family_invalid_command';
  end if;
  if exists(select 1 from jsonb_object_keys(p_payload) k where not (k=any(allowed_keys))) then
    raise exception using errcode='P0001',message='family_invalid_command';
  end if;
  if p_action in ('create','rename') then
    requested_name := btrim(p_payload->>'name');
    if jsonb_typeof(p_payload->'name') is distinct from 'string' or char_length(requested_name) not between 1 and 80 then
      raise exception using errcode='P0001',message='family_invalid_name';
    end if;
  end if;

  if p_action='create' then
    select g.* into family from public.family_groups g join public.family_memberships m on m.group_id=g.id where m.user_id=caller;
    if found then
      -- A lost response may be retried. Never rename/overwrite an existing group
      -- as a side effect of retrying create, and never create a second one.
      if family.owner_id=caller and family.name=requested_name then
        return jsonb_build_object('snapshot',daypop_family.snapshot(),'invitation',null);
      end if;
      raise exception using errcode='P0001',message='family_already_member';
    end if;
    insert into public.family_groups(owner_id,name) values(caller,requested_name) returning * into family;
    insert into public.family_memberships(group_id,user_id,role) values(family.id,caller,'owner');
    return jsonb_build_object('snapshot',daypop_family.snapshot(),'invitation',null);
  end if;

  if p_action in ('accept','decline') then
    if not email_verified or caller_email is null then raise exception using errcode='P0001',message='family_email_unverified'; end if;
    raw_token := p_payload->>'token';
    if jsonb_typeof(p_payload->'token') is distinct from 'string' or raw_token !~ '^[0-9a-f]{64}$' then
      raise exception using errcode='P0001',message='family_invitation_unavailable';
    end if;
    select * into invitation from public.family_invitations where token_hash=encode(extensions.digest(raw_token,'sha256'),'hex');
    if not found then raise exception using errcode='P0001',message='family_invitation_unavailable'; end if;
    -- Always group -> invitation, including accept/revoke/resend/remove. Capacity
    -- and revocation are rechecked after the lock, not from the initial lookup.
    select * into family from public.family_groups where id=invitation.group_id for update;
    if not found then raise exception using errcode='P0001',message='family_invitation_unavailable'; end if;
    select * into invitation from public.family_invitations
      where token_hash=encode(extensions.digest(raw_token,'sha256'),'hex') and group_id=family.id for update;
    if not found then raise exception using errcode='P0001',message='family_invitation_unavailable'; end if;
    if p_action='accept' and invitation.status='accepted' and invitation.accepted_by=caller
      and exists(select 1 from public.family_memberships where user_id=caller and group_id=family.id) then
      return jsonb_build_object('snapshot',daypop_family.snapshot(),'invitation',null);
    end if;
    if invitation.status<>'pending' or invitation.expires_at<=clock_timestamp() then
      raise exception using errcode='P0001',message='family_invitation_unavailable';
    end if;
    if invitation.email<>caller_email then raise exception using errcode='P0001',message='family_email_mismatch'; end if;
    if p_action='accept' then
      if exists(select 1 from public.family_memberships where user_id=caller) then
        raise exception using errcode='P0001',message='family_already_member';
      end if;
      select count(*) into reserved from public.family_memberships where group_id=family.id;
      if reserved>=6 then raise exception using errcode='P0001',message='family_full'; end if;
      -- user_id UNIQUE is a second, cross-group concurrency barrier: concurrent
      -- accepts in two groups can never commit two active memberships.
      insert into public.family_memberships(group_id,user_id,role) values(family.id,caller,'member');
      update public.family_invitations set status='accepted',accepted_by=caller,consumed_at=clock_timestamp() where id=invitation.id;
    else
      update public.family_invitations set status='declined',consumed_at=clock_timestamp() where id=invitation.id;
    end if;
    return jsonb_build_object('snapshot',daypop_family.snapshot(),'invitation',null);
  end if;

  if jsonb_typeof(p_payload->'groupId') is distinct from 'string'
    or (p_payload->>'groupId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception using errcode='P0001',message='family_invalid_command';
  end if;
  requested_group := (p_payload->>'groupId')::uuid;
  select * into family from public.family_groups where id=requested_group for update;
  if not found then
    if p_action in ('leave','dissolve') and not exists(select 1 from public.family_memberships where user_id=caller) then
      return jsonb_build_object('snapshot',daypop_family.snapshot(),'invitation',null);
    end if;
    raise exception using errcode='P0001',message='family_group_changed';
  end if;
  select role into caller_role from public.family_memberships where group_id=family.id and user_id=caller;
  if not found then raise exception using errcode='P0001',message='family_group_changed'; end if;
  if p_action='leave' then
    if caller_role='owner' or family.owner_id=caller then
      raise exception using errcode='P0001',message='family_owner_must_dissolve';
    end if;
    delete from public.family_memberships where group_id=family.id and user_id=caller;
    return jsonb_build_object('snapshot',daypop_family.snapshot(),'invitation',null);
  end if;
  if caller_role<>'owner' or family.owner_id<>caller then
    raise exception using errcode='P0001',message='family_owner_required';
  end if;
  if p_action='rename' then
    update public.family_groups set name=requested_name where id=family.id;
  elsif p_action='dissolve' then
    delete from public.family_groups where id=family.id;
  elsif p_action='remove' then
    if jsonb_typeof(p_payload->'memberId') is distinct from 'string'
      or (p_payload->>'memberId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception using errcode='P0001',message='family_invalid_command';
    end if;
    requested_member := (p_payload->>'memberId')::uuid;
    if requested_member=family.owner_id then raise exception using errcode='P0001',message='family_owner_must_dissolve'; end if;
    delete from public.family_memberships where group_id=family.id and user_id=requested_member and role='member';
  else
    -- Materializing expiry frees the partial unique email index. Authorization
    -- always checks expires_at too; no cron or background job is required.
    update public.family_invitations set status='expired'
      where group_id=family.id and status='pending' and expires_at<=clock_timestamp();
    if p_action in ('resend','revoke') then
      if jsonb_typeof(p_payload->'invitationId') is distinct from 'string'
        or (p_payload->>'invitationId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
        raise exception using errcode='P0001',message='family_invalid_command';
      end if;
      requested_invitation := (p_payload->>'invitationId')::uuid;
      select * into invitation from public.family_invitations where id=requested_invitation and group_id=family.id for update;
      if not found or invitation.status not in ('pending','expired') then
        raise exception using errcode='P0001',message='family_invitation_unavailable';
      end if;
      requested_email := invitation.email;
    else
      requested_email := lower(btrim(p_payload->>'email'));
      if jsonb_typeof(p_payload->'email') is distinct from 'string' or char_length(requested_email)>320
        or requested_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
        raise exception using errcode='P0001',message='family_invalid_email';
      end if;
      select * into invitation from public.family_invitations where group_id=family.id and email=requested_email and status='pending' for update;
    end if;
    if p_action='revoke' then
      update public.family_invitations set status='revoked',consumed_at=clock_timestamp() where id=invitation.id;
    else
      if exists(select 1 from public.family_memberships m join auth.users u on u.id=m.user_id
        where m.group_id=family.id and lower(btrim(u.email))=requested_email) then
        raise exception using errcode='P0001',message='family_already_member';
      end if;
      select (select count(*) from public.family_memberships where group_id=family.id)
        + (select count(*) from public.family_invitations where group_id=family.id and status='pending'
           and expires_at>clock_timestamp() and id is distinct from invitation.id) into reserved;
      if reserved>=6 then raise exception using errcode='P0001',message='family_full'; end if;
      raw_token := encode(extensions.gen_random_bytes(32),'hex');
      if invitation.id is null then
        insert into public.family_invitations(group_id,invited_by,email,token_hash,expires_at)
        values(family.id,caller,requested_email,encode(extensions.digest(raw_token,'sha256'),'hex'),clock_timestamp()+interval '7 days') returning * into invitation;
      else
        update public.family_invitations set token_hash=encode(extensions.digest(raw_token,'sha256'),'hex'),
          status='pending',expires_at=clock_timestamp()+interval '7 days',consumed_at=null
          where id=invitation.id returning * into invitation;
      end if;
      invitation_result := jsonb_build_object('id',invitation.id,'token',raw_token,'expiresAt',invitation.expires_at);
    end if;
  end if;
  return jsonb_build_object('snapshot',daypop_family.snapshot(),'invitation',invitation_result);
end;
$$;

revoke all on function daypop_family.snapshot(),daypop_family.preview(text),daypop_family.command(text,jsonb) from public,anon,authenticated;
grant execute on function daypop_family.snapshot(),daypop_family.preview(text),daypop_family.command(text,jsonb) to authenticated;

create function public.family_snapshot()
returns jsonb language sql stable security invoker set search_path='' as $$select daypop_family.snapshot();$$;
create function public.family_invitation_preview(p_token text)
returns jsonb language sql stable security invoker set search_path='' as $$select daypop_family.preview(p_token);$$;
create function public.family_command(p_action text,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$select daypop_family.command(p_action,p_payload);$$;
revoke all on function public.family_snapshot(),public.family_invitation_preview(text),public.family_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.family_snapshot(),public.family_invitation_preview(text),public.family_command(text,jsonb) to authenticated;
