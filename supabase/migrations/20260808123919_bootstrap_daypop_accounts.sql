-- DP-024: keep account bootstrap atomic and independent from the repository.
-- The auth trigger is the only automatic entry point; the helper also repairs
-- pre-existing accounts during this migration without overwriting saved data.
create schema daypop_private;

revoke all on schema daypop_private from public, anon, authenticated;

create function daypop_private.bootstrap_account(account_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if account_id is null then
    raise exception 'DayPop account id cannot be null'
      using errcode = '22004';
  end if;

  -- Serialize retries for one account. ON CONFLICT remains as a final guard
  -- against a concurrent owner write that does not use this helper.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(account_id::text, 0)
  );

  insert into public.profiles (id)
  values (account_id)
  on conflict (id) do nothing;

  insert into public.user_preferences (
    user_id,
    timezone,
    week_starts_on,
    fixed_six_week_grid,
    theme,
    theme_id,
    default_reminder_minutes,
    pet_name,
    pet_enabled
  )
  values (
    account_id,
    'Asia/Taipei',
    0,
    false,
    'light',
    'manga',
    '{}'::integer[],
    '摩卡',
    true
  )
  on conflict (user_id) do nothing;

  insert into public.calendars (
    owner_id,
    name,
    color,
    is_visible,
    is_default,
    sort_order
  )
  select
    account_id,
    '我的日曆',
    '#F06C5C',
    true,
    true,
    0
  where not exists (
    select 1
    from public.calendars
    where owner_id = account_id
      and is_default
  )
  on conflict do nothing;
end;
$$;

revoke all on function daypop_private.bootstrap_account(uuid)
from public, anon, authenticated;

create function daypop_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform daypop_private.bootstrap_account(new.id);
  return new;
end;
$$;

revoke all on function daypop_private.handle_new_auth_user()
from public, anon, authenticated;

create trigger daypop_bootstrap_auth_user
after insert on auth.users
for each row execute function daypop_private.handle_new_auth_user();

-- Accounts created before DP-024 get only missing bootstrap rows. Existing
-- profile, preference, and default-calendar values are left unchanged.
do $$
declare
  existing_account_id uuid;
begin
  for existing_account_id in
    select id
    from auth.users
  loop
    perform daypop_private.bootstrap_account(existing_account_id);
  end loop;
end;
$$;

comment on schema daypop_private is
  'Non-API DayPop functions used by trusted database triggers and migrations.';

comment on function daypop_private.bootstrap_account(uuid) is
  'Idempotently creates missing profile, preferences, and one default calendar.';
