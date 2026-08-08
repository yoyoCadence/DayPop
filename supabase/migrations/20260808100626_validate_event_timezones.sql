-- DP-027: Postgres cannot use pg_timezone_names in an immutable CHECK.
-- Validate the two public write boundaries with a trigger instead, while the
-- domain independently validates the same value through Intl.
create or replace function public.validate_daypop_timezone()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.timezone is null then
    return new;
  end if;

  if new.timezone <> btrim(new.timezone)
    or new.timezone = ''
    or not exists (
      select 1
      from pg_catalog.pg_timezone_names as timezone_name
      where timezone_name.name = new.timezone
    )
  then
    raise exception using
      errcode = '22023',
      message = 'timezone must be a supported IANA timezone';
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_daypop_timezone()
  from public, anon, authenticated;

create trigger user_preferences_validate_timezone
before insert or update of timezone on public.user_preferences
for each row execute function public.validate_daypop_timezone();

create trigger events_validate_timezone
before insert or update of timezone on public.events
for each row execute function public.validate_daypop_timezone();
