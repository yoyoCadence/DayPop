-- DP-220. Notification metadata is separate from the v4 personal document.
-- Disabled until a reviewed sender, server secrets and cron are installed.
create schema daypop_reminders;
revoke all on schema daypop_reminders from public,anon,authenticated;

create table daypop_reminders.configuration (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  public_key text check(public_key ~ '^B[A-Za-z0-9_-]{86}$'),
  last_tick timestamptz,
  last_error text check(last_error in ('configuration','planning','transport','capacity'))
);
insert into daypop_reminders.configuration(singleton) values(true);
alter table daypop_reminders.configuration enable row level security;

create table public.calendar_reminder_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  calendar_id uuid not null references public.calendars(id) on delete cascade,
  minutes_before integer[] not null default '{}',
  timezone text not null,
  date_time text not null default '09:00' check(date_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  include_todos boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,calendar_id),
  check((cardinality(minutes_before)=0 or (array_ndims(minutes_before)=1 and array_lower(minutes_before,1)=1))
    and cardinality(minutes_before)<=10 and array_position(minutes_before,null) is null
    and 0<=all(minutes_before) and 10080>=all(minutes_before))
);
create index calendar_reminder_settings_calendar_idx on public.calendar_reminder_settings(calendar_id);
create trigger reminder_settings_timezone before insert or update of timezone on public.calendar_reminder_settings
  for each row execute function public.validate_daypop_timezone();
create trigger reminder_settings_timestamp before insert or update on public.calendar_reminder_settings
  for each row execute function public.set_updated_at();
alter table public.calendar_reminder_settings enable row level security;
create policy reminder_settings_owner_read on public.calendar_reminder_settings for select to authenticated
  using(user_id=(select auth.uid()));
revoke all on public.calendar_reminder_settings from public,anon,authenticated;
grant select on public.calendar_reminder_settings to authenticated;

create table public.reminder_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check(char_length(endpoint) between 20 and 2048),
  p256dh text not null check(p256dh ~ '^B[A-Za-z0-9_-]{86}$'),
  auth_key text not null check(auth_key ~ '^[A-Za-z0-9_-]{22}$'),
  public_key text not null check(public_key ~ '^B[A-Za-z0-9_-]{86}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(endpoint ~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|[a-z0-9-]+[.]push[.]apple[.]com|[a-z0-9-]+[.]notify[.]windows[.]com)/[^#[:space:]]+$')
);
create index reminder_push_devices_user_idx on public.reminder_push_devices(user_id,id);
alter table public.reminder_push_devices enable row level security;
create policy reminder_devices_owner_read on public.reminder_push_devices for select to authenticated
  using(user_id=(select auth.uid()));
revoke all on public.reminder_push_devices from public,anon,authenticated;
-- The capability URL and encryption keys are never exposed through SELECT.
grant select(id,user_id,created_at,updated_at) on public.reminder_push_devices to authenticated;
grant select,insert,update,delete on public.calendar_reminder_settings,public.reminder_push_devices to service_role;

create table daypop_reminders.deliveries (
  device_id uuid not null references public.reminder_push_devices(id) on delete cascade,
  job_hash text not null check(job_hash ~ '^[a-f0-9]{64}$'),
  fire_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null check(status in ('sending','sent','retry','failed')),
  lease_id uuid not null,
  lease_until timestamptz not null,
  attempts integer not null default 1 check(attempts between 1 and 4),
  primary key(device_id,job_hash),
  check(expires_at=fire_at+interval '5 minutes')
);
create index reminder_deliveries_expiry_idx on daypop_reminders.deliveries(expires_at);
alter table daypop_reminders.deliveries enable row level security;
revoke all on all tables in schema daypop_reminders from public,anon,authenticated;

create function public.reminder_capabilities()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('enabled',coalesce(c.enabled and c.public_key is not null
      and c.last_tick>statement_timestamp()-interval '5 minutes',false),
    'publicKey',case when c.enabled then c.public_key else null end,
    'lastTick',c.last_tick)
  from daypop_reminders.configuration c where c.singleton and (select auth.uid()) is not null;
$$;

create function public.set_calendar_reminder(p_calendar_id uuid,p_minutes_before integer[],p_timezone text,
  p_date_time text,p_include_todos boolean,p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid := (select auth.uid()); previous timestamptz; stored public.calendar_reminder_settings;
begin
  if actor is null then raise exception using errcode='42501',message='reminder_sign_in_required'; end if;
  -- Serializes first insert, changes and device registration for one account.
  perform pg_advisory_xact_lock(hashtextextended('daypop-reminders:'||actor::text,0));
  select updated_at into previous from public.calendar_reminder_settings where user_id=actor and calendar_id=p_calendar_id;
  if previous is distinct from p_expected_updated_at then raise exception using errcode='P0001',message='reminder_conflict'; end if;
  if p_minutes_before is null or p_timezone is null or p_date_time is null or p_include_todos is null then
    raise exception using errcode='22023',message='reminder_invalid_settings';
  end if;
  if cardinality(p_minutes_before)=0 then
    delete from public.calendar_reminder_settings where user_id=actor and calendar_id=p_calendar_id;
    return jsonb_build_object('calendarId',p_calendar_id,'updatedAt',null);
  end if;
  if daypop_family.calendar_access(p_calendar_id) is null then
    raise exception using errcode='42501',message='reminder_calendar_unavailable';
  end if;
  if previous is null and (select count(*) from public.calendar_reminder_settings where user_id=actor)>=200 then
    raise exception using errcode='54000',message='reminder_calendar_limit';
  end if;
  insert into public.calendar_reminder_settings(user_id,calendar_id,minutes_before,timezone,date_time,include_todos)
  values(actor,p_calendar_id,p_minutes_before,p_timezone,p_date_time,p_include_todos)
  on conflict(user_id,calendar_id) do update set minutes_before=excluded.minutes_before,timezone=excluded.timezone,
    date_time=excluded.date_time,include_todos=excluded.include_todos returning * into stored;
  return jsonb_build_object('calendarId',stored.calendar_id,'minutesBefore',stored.minutes_before,
    'timezone',stored.timezone,'dateTime',stored.date_time,'includeTodos',stored.include_todos,'updatedAt',stored.updated_at);
end;
$$;

create function public.register_reminder_device(p_endpoint text,p_p256dh text,p_auth text,p_public_key text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid := (select auth.uid()); previous public.reminder_push_devices; device_id uuid;
begin
  if actor is null then raise exception using errcode='42501',message='reminder_sign_in_required'; end if;
  if not exists(select 1 from daypop_reminders.configuration where singleton and enabled
    and public_key=p_public_key and last_tick>statement_timestamp()-interval '5 minutes') then
    raise exception using errcode='55000',message='reminder_backend_unavailable';
  end if;
  if p_endpoint is null or p_p256dh is null or p_auth is null or p_public_key is null then
    raise exception using errcode='22023',message='reminder_invalid_subscription';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('daypop-reminders:endpoint:'||p_endpoint,0));
  perform pg_advisory_xact_lock(hashtextextended('daypop-reminders:'||actor::text,0));
  select * into previous from public.reminder_push_devices where endpoint=p_endpoint for update;
  if previous.id is not null and (previous.p256dh<>p_p256dh or previous.auth_key<>p_auth) then
    raise exception using errcode='42501',message='reminder_subscription_mismatch';
  end if;
  if previous.user_id=actor and previous.public_key=p_public_key then return previous.id; end if;
  if (select count(*) from public.reminder_push_devices where user_id=actor)>=10 then
    raise exception using errcode='54000',message='reminder_device_limit';
  end if;
  -- Explicit browser consent can transfer its own proven capability to the new
  -- account. Old jobs cascade; the new registration boundary prevents backfill.
  delete from public.reminder_push_devices where id=previous.id;
  insert into public.reminder_push_devices(user_id,endpoint,p256dh,auth_key,public_key)
  values(actor,p_endpoint,p_p256dh,p_auth,p_public_key) returning id into device_id;
  return device_id;
end;
$$;

create function public.unregister_reminder_device(p_device_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null then raise exception using errcode='42501',message='reminder_sign_in_required'; end if;
  delete from public.reminder_push_devices where id=p_device_id and user_id=(select auth.uid());
end;
$$;
revoke all on function public.reminder_capabilities(),public.set_calendar_reminder(uuid,integer[],text,text,boolean,timestamptz),
  public.register_reminder_device(text,text,text,text),public.unregister_reminder_device(uuid) from public,anon,authenticated;
grant execute on function public.reminder_capabilities(),public.set_calendar_reminder(uuid,integer[],text,text,boolean,timestamptz),
  public.register_reminder_device(text,text,text,text),public.unregister_reminder_device(uuid) to authenticated;

-- Only the authenticated service role can enter the sender RPCs. A caller's
-- user id/GUC never grants sender authority. The context below temporarily sets
-- the DB-owned device recipient to REUSE the existing authorization predicates,
-- then restores it. No new interpretation of private graphs or memberships.
create function daypop_reminders.require_service()
returns void language plpgsql security invoker set search_path='' as $$
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception using errcode='42501',message='reminder_service_required';
  end if;
end;
$$;
revoke all on function daypop_reminders.require_service() from public,anon,authenticated;

create function daypop_reminders.calendar_context(p_device_id uuid,p_calendar_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare device public.reminder_push_devices; rule public.calendar_reminder_settings; snapshot jsonb;
  old_sub text := current_setting('request.jwt.claim.sub',true);
begin
  perform daypop_reminders.require_service();
  select * into device from public.reminder_push_devices where id=p_device_id;
  if not found or not exists(select 1 from daypop_reminders.configuration where singleton and enabled and public_key=device.public_key) then return null; end if;
  select * into rule from public.calendar_reminder_settings where user_id=device.user_id and calendar_id=p_calendar_id;
  if not found or cardinality(rule.minutes_before)=0 then return null; end if;
  perform set_config('request.jwt.claim.sub',device.user_id::text,true);
  if daypop_family.calendar_access(p_calendar_id) is null then
    perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true); return null;
  end if;
  with relevant_ids as (
    -- Reuse the existing complete exception graph; filtering by calendar first
    -- would lose moved replacements or resurrect an omitted cancellation.
    select distinct r.id from public.events seed
      cross join lateral daypop_family.related_events(seed.id) r
    where seed.calendar_id=p_calendar_id
  ), visible_events as (
    select e.* from public.events e join relevant_ids r on r.id=e.id
      and daypop_family.event_access(e.id,e.owner_id,e.calendar_id,e.sharing_scope)
  ), visible_exceptions as (
    select x.* from public.event_exceptions x join visible_events e on e.id=x.event_id
    where daypop_family.exception_access(x.event_id,x.replacement_event_id)
  ), visible_todos as (
    select t.* from public.todos t where t.calendar_id=p_calendar_id and rule.include_todos
      and daypop_family.todo_access(t.id,t.parent_id,t.owner_id,t.calendar_id,t.sharing_scope)
  ) select jsonb_build_object(
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'calendarId',e.calendar_id,
      'title','DayPop','location',null,'notes',null,'reminderMinutes','[]'::jsonb,'sharingScope',e.sharing_scope,
      'recurrence',case when e.recurrence_rule is null then null else jsonb_build_object('rule',e.recurrence_rule) end,
      'createdAt',e.created_at,'updatedAt',e.updated_at,'allDay',e.is_all_day) ||
      case when e.is_all_day then jsonb_build_object('startDate',e.start_date,'endDate',e.end_date)
        else jsonb_build_object('startsAt',e.starts_at,'endsAt',e.ends_at,'timezone',e.timezone) end order by e.id)
      from visible_events e),'[]'::jsonb),
    'eventExceptions',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'eventId',x.event_id,
      'occurrence',case when x.occurrence_date is null then jsonb_build_object('kind','timed','startsAt',x.occurrence_starts_at)
        else jsonb_build_object('kind','all-day','date',x.occurrence_date) end,
      'isCancelled',x.is_cancelled,'replacementEventId',x.replacement_event_id,
      'createdAt',x.created_at,'updatedAt',x.updated_at) order by x.id) from visible_exceptions x),'[]'::jsonb),
    'todos',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'calendarId',t.calendar_id,'parentId',t.parent_id,
      'title','DayPop','dueDate',t.due_date,'completedAt',t.completed_at,'priority',t.priority,'sortOrder',t.sort_order,
      'sharingScope',t.sharing_scope,'createdAt',t.created_at,'updatedAt',t.updated_at) order by t.id) from visible_todos t),'[]'::jsonb)
  ) into snapshot;
  perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
  if jsonb_array_length(snapshot->'events')>5000 or jsonb_array_length(snapshot->'eventExceptions')>10000
    or jsonb_array_length(snapshot->'todos')>5000 then raise exception using errcode='54000',message='reminder_snapshot_limit'; end if;
  return jsonb_build_object('snapshot',snapshot,'rule',jsonb_build_object('calendarId',rule.calendar_id,
    'minutesBefore',rule.minutes_before,'timezone',rule.timezone,'dateTime',rule.date_time,
    'includeTodos',rule.include_todos,'updatedAt',rule.updated_at),'deviceCreatedAt',device.created_at,
    'version',encode(extensions.digest((snapshot::text||rule::text||device.id::text||device.created_at::text),'sha256'),'hex'));
exception when others then
  perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true); raise;
end;
$$;
revoke all on function daypop_reminders.calendar_context(uuid,uuid) from public,anon,authenticated;

create function public.reminder_sender_page(p_after uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform daypop_reminders.require_service();
  select coalesce(jsonb_agg(jsonb_build_object('deviceId',d.id,'calendarIds',
    (select jsonb_agg(r.calendar_id order by r.calendar_id) from public.calendar_reminder_settings r where r.user_id=d.user_id)) order by d.id),'[]'::jsonb)
  into result from (select d.id,d.user_id from public.reminder_push_devices d
    join daypop_reminders.configuration c on c.singleton and c.enabled and c.public_key=d.public_key
    where (p_after is null or d.id>p_after) and exists(select 1 from public.calendar_reminder_settings r where r.user_id=d.user_id)
    order by d.id limit 100) d;
  return result;
end;
$$;
create function public.reminder_sender_context(p_device_id uuid,p_calendar_id uuid)
returns jsonb language sql volatile security definer set search_path='' as $$
  select daypop_reminders.calendar_context(p_device_id,p_calendar_id);
$$;

create function public.claim_reminder_delivery(p_device_id uuid,p_calendar_id uuid,p_version text,p_job_hash text,p_fire_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb; lease uuid := gen_random_uuid(); current_time_value timestamptz; device public.reminder_push_devices;
begin
  perform daypop_reminders.require_service();
  select * into device from public.reminder_push_devices where id=p_device_id for update;
  if not found then return null; end if;
  -- A competing sender may have held this lock through the expiry boundary.
  current_time_value := clock_timestamp();
  if p_fire_at is null or not isfinite(p_fire_at) or p_fire_at>current_time_value or p_fire_at+interval '5 minutes'<=current_time_value
    or p_job_hash is null or p_job_hash !~ '^[a-f0-9]{64}$' then return null; end if;
  if p_fire_at<device.created_at then return null; end if;
  context := daypop_reminders.calendar_context(p_device_id,p_calendar_id);
  if context is null or context->>'version' is distinct from p_version
    or p_fire_at<(context->'rule'->>'updatedAt')::timestamptz then return null; end if;
  insert into daypop_reminders.deliveries(device_id,job_hash,fire_at,expires_at,status,lease_id,lease_until)
  values(p_device_id,p_job_hash,p_fire_at,p_fire_at+interval '5 minutes','sending',lease,current_time_value+interval '30 seconds')
  on conflict(device_id,job_hash) do update set status='sending',lease_id=excluded.lease_id,
    lease_until=excluded.lease_until,attempts=daypop_reminders.deliveries.attempts+1
  where daypop_reminders.deliveries.status in ('sending','retry') and daypop_reminders.deliveries.lease_until<=current_time_value
    and daypop_reminders.deliveries.attempts<4 and daypop_reminders.deliveries.fire_at=excluded.fire_at;
  if not found then return null; end if;
  return jsonb_build_object('leaseId',lease,'endpoint',device.endpoint,'p256dh',device.p256dh,'auth',device.auth_key,
    'expiresAt',p_fire_at+interval '5 minutes');
end;
$$;

create function public.finish_reminder_delivery(p_device_id uuid,p_job_hash text,p_lease_id uuid,p_result text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform daypop_reminders.require_service();
  if p_result not in ('sent','retry','failed','gone') or p_result is null then
    raise exception using errcode='22023',message='reminder_invalid_result';
  end if;
  -- Same device -> ledger lock order as claim, including gone/cascade cleanup.
  perform id from public.reminder_push_devices where id=p_device_id for update;
  if not found then return; end if;
  update daypop_reminders.deliveries set status=case when p_result='gone' then 'failed' else p_result end,
    lease_until=clock_timestamp()+interval '30 seconds'
  where device_id=p_device_id and job_hash=p_job_hash and lease_id=p_lease_id and status='sending';
  if found and p_result='gone' then delete from public.reminder_push_devices where id=p_device_id; end if;
end;
$$;
create function public.reminder_sender_heartbeat(p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform daypop_reminders.require_service();
  update daypop_reminders.configuration set last_tick=clock_timestamp(),last_error=p_error where singleton;
  -- Bounded retention, no event content or endpoint history in the ledger.
  delete from daypop_reminders.deliveries where expires_at<clock_timestamp()-interval '1 day';
end;
$$;
revoke all on function public.reminder_sender_page(uuid),public.reminder_sender_context(uuid,uuid),
  public.claim_reminder_delivery(uuid,uuid,text,text,timestamptz),public.finish_reminder_delivery(uuid,text,uuid,text),
  public.reminder_sender_heartbeat(text) from public,anon,authenticated;
grant execute on function public.reminder_sender_page(uuid),public.reminder_sender_context(uuid,uuid),
  public.claim_reminder_delivery(uuid,uuid,text,text,timestamptz),public.finish_reminder_delivery(uuid,text,uuid,text),
  public.reminder_sender_heartbeat(text) to service_role;
