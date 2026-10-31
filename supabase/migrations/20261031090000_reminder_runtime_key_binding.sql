-- DP-222: readiness belongs to one reviewed, enabled VAPID configuration.
-- Existing personal data and the original twenty migrations remain unchanged.
create function daypop_reminders.reset_configuration_health()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.enabled is distinct from old.enabled or new.public_key is distinct from old.public_key then
    new.last_tick := null;
    new.last_error := null;
  end if;
  return new;
end;
$$;
revoke all on function daypop_reminders.reset_configuration_health() from public,anon,authenticated;
create trigger reminder_configuration_health before update on daypop_reminders.configuration
  for each row execute function daypop_reminders.reset_configuration_health();

create function public.reminder_sender_configuration()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform daypop_reminders.require_service();
  return (select jsonb_build_object('enabled',enabled,'publicKey',public_key)
    from daypop_reminders.configuration where singleton);
end;
$$;
revoke all on function public.reminder_sender_configuration() from public,anon,authenticated;
grant execute on function public.reminder_sender_configuration() to service_role;

-- Unbound heartbeats cannot mark a newly rotated configuration as ready.
drop function public.reminder_sender_heartbeat(text);
create function public.reminder_sender_heartbeat(p_public_key text,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform daypop_reminders.require_service();
  update daypop_reminders.configuration set last_tick=clock_timestamp(),last_error=p_error
    where singleton and enabled and public_key=p_public_key;
  if not found then raise exception using errcode='55000',message='reminder_backend_unavailable'; end if;
  delete from daypop_reminders.deliveries where expires_at<clock_timestamp()-interval '1 day';
end;
$$;
revoke all on function public.reminder_sender_heartbeat(text,text) from public,anon,authenticated;
grant execute on function public.reminder_sender_heartbeat(text,text) to service_role;

-- Every claim is bound to the runtime, not just its startup and heartbeat.
-- The device lock serializes key/registration changes before this comparison.
drop function public.claim_reminder_delivery(uuid,uuid,text,text,timestamptz);
create function public.claim_reminder_delivery(p_public_key text,p_device_id uuid,p_calendar_id uuid,p_version text,p_job_hash text,p_fire_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb; lease uuid := gen_random_uuid(); current_time_value timestamptz; device public.reminder_push_devices;
begin
  perform daypop_reminders.require_service();
  select * into device from public.reminder_push_devices where id=p_device_id for update;
  if not found or device.public_key is distinct from p_public_key then return null; end if;
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
revoke all on function public.claim_reminder_delivery(text,uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_reminder_delivery(text,uuid,uuid,text,text,timestamptz) to service_role;
