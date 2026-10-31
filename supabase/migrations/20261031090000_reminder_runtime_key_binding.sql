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
