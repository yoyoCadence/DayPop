begin;

create extension if not exists pgtap with schema extensions;
select plan(36);

insert into auth.users (id)
values
  ('00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000b2');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
select set_config(
  'daypop.test_calendar_id',
  (
    select id::text
    from public.calendars
    where owner_id = '00000000-0000-4000-8000-0000000000a1'
      and is_default
  ),
  true
);

select is(
  (
    select count(*)::integer
    from public.profiles
    where id = '00000000-0000-4000-8000-0000000000a1'
  ),
  1,
  'auth signup bootstraps one profile'
);

select is(
  (
    select (
      name || ':' || color || ':' || is_visible::text || ':' ||
      is_default::text || ':' || sort_order::text
    )
    from public.calendars
    where owner_id = '00000000-0000-4000-8000-0000000000a1'
  ),
  '我的日曆:#F06C5C:true:true:0',
  'auth signup bootstraps the canonical default calendar'
);

select has_column(
  'public',
  'user_preferences',
  'fixed_six_week_grid',
  'preferences expose the semantic fixed-six grid column'
);

select is(
  (
    select (theme || ':' || theme_id || ':' || fixed_six_week_grid::text)
    from public.user_preferences
    where user_id = '00000000-0000-4000-8000-0000000000a1'
  ),
  'light:manga:false',
  'new preferences use canonical light manga and adaptive-grid defaults'
);

update public.profiles
set display_name = 'RLS A'
where id = '00000000-0000-4000-8000-0000000000a1';

update public.user_preferences
set pet_name = '保留摩卡'
where user_id = '00000000-0000-4000-8000-0000000000a1';

update public.calendars
set name = 'A calendar'
where id = current_setting('daypop.test_calendar_id')::uuid;

reset role;

do $$
begin
  perform daypop_private.bootstrap_account(
    '00000000-0000-4000-8000-0000000000a1'
  );
  perform daypop_private.bootstrap_account(
    '00000000-0000-4000-8000-0000000000a1'
  );
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);

select is(
  (
    select count(*)::integer
    from public.profiles
    where id = '00000000-0000-4000-8000-0000000000a1'
  ),
  1,
  'bootstrap retries do not duplicate profiles'
);

select is(
  (
    select count(*)::integer
    from public.user_preferences
    where user_id = '00000000-0000-4000-8000-0000000000a1'
  ),
  1,
  'bootstrap retries do not duplicate preferences'
);

select is(
  (
    select count(*)::integer
    from public.calendars
    where owner_id = '00000000-0000-4000-8000-0000000000a1'
      and is_default
  ),
  1,
  'bootstrap retries keep exactly one default calendar'
);

select is(
  (
    select p.display_name || ':' || prefs.pet_name || ':' || c.name
    from public.profiles as p
    join public.user_preferences as prefs on prefs.user_id = p.id
    join public.calendars as c on c.owner_id = p.id and c.is_default
    where p.id = '00000000-0000-4000-8000-0000000000a1'
  ),
  'RLS A:保留摩卡:A calendar',
  'bootstrap retries preserve saved account values'
);

select ok(
  not has_schema_privilege('authenticated', 'daypop_private', 'usage'),
  'authenticated cannot access the private bootstrap schema'
);

select ok(
  not (
    select has_function_privilege('authenticated', p.oid, 'execute')
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'daypop_private'
      and p.proname = 'bootstrap_account'
  ),
  'authenticated cannot execute the bootstrap helper'
);

select ok(
  not (
    select has_function_privilege('anon', p.oid, 'execute')
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'daypop_private'
      and p.proname = 'bootstrap_account'
  ),
  'anon cannot execute the bootstrap helper'
);

select is(
  (
    select p.prosecdef
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'daypop_private'
      and p.proname = 'handle_new_auth_user'
  ),
  true,
  'auth trigger handler runs as its controlled definer'
);

select is(
  (
    select p.proconfig[1]
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'daypop_private'
      and p.proname = 'handle_new_auth_user'
  ),
  concat('search_path=', chr(34), chr(34)),
  'auth trigger handler fixes an empty search_path'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_trigger
    where tgrelid = 'auth.users'::regclass
      and tgname = 'daypop_bootstrap_auth_user'
      and not tgisinternal
  ),
  1,
  'auth.users has one DayPop bootstrap trigger'
);

insert into public.events (
  owner_id,
  calendar_id,
  title,
  is_all_day,
  start_date,
  end_date,
  created_at
)
values (
  '00000000-0000-4000-8000-0000000000a1',
  current_setting('daypop.test_calendar_id')::uuid,
  'cascade event',
  true,
  date '2026-08-01',
  date '2026-08-01',
  timestamptz '2000-01-01 00:00:00+00'
);

select is(
  (
    select created_at <> timestamptz '2000-01-01 00:00:00+00'
    from public.events
    where title = 'cascade event'
  ),
  true,
  'server overrides a client-forged created_at on insert'
);

update public.events
set created_at = timestamptz '1999-01-01 00:00:00+00'
where title = 'cascade event';

select is(
  (
    select created_at <> timestamptz '1999-01-01 00:00:00+00'
    from public.events
    where title = 'cascade event'
  ),
  true,
  'server keeps created_at immutable on update'
);

select is(
  (
    select count(*)::integer
    from pg_trigger
    where tgname like '%_set_server_timestamps_on_insert'
      and not tgisinternal
  ),
  9,
  'all nine public data tables enforce server timestamps on insert'
);

do $$
begin
  begin
    update public.events
    set reminder_minutes = array[-1]
    where title = 'cascade event';
    raise exception 'negative reminder unexpectedly succeeded';
  exception
    when check_violation then null;
  end;
end;
$$;
select pass('event reminders reject negative minutes');

do $$
begin
  begin
    update public.events
    set reminder_minutes = array[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    where title = 'cascade event';
    raise exception 'excessive reminder count unexpectedly succeeded';
  exception
    when check_violation then null;
  end;
end;
$$;
select pass('event reminders reject more than ten entries');

do $$
begin
  begin
    update public.user_preferences
    set default_reminder_minutes = array[10081]
    where user_id = '00000000-0000-4000-8000-0000000000a1';
    raise exception 'oversized default reminder unexpectedly succeeded';
  exception
    when check_violation then null;
  end;
end;
$$;
select pass('default reminders reject values beyond seven days');

do $$
begin
  begin
    update public.user_preferences
    set default_reminder_minutes = array[null, 10]::integer[]
    where user_id = '00000000-0000-4000-8000-0000000000a1';
    raise exception 'null reminder unexpectedly succeeded';
  exception
    when check_violation then null;
  end;
end;
$$;
select pass('default reminders reject null entries');

do $$
begin
  begin
    insert into public.events (
      owner_id,
      calendar_id,
      title,
      is_all_day,
      starts_at,
      ends_at,
      timezone
    ) values (
      '00000000-0000-4000-8000-0000000000a1',
      current_setting('daypop.test_calendar_id')::uuid,
      'backwards timed event',
      false,
      timestamptz '2026-08-02 10:00:00+00',
      timestamptz '2026-08-02 09:00:00+00',
      'UTC'
    );
    raise exception 'backwards timed event unexpectedly succeeded';
  exception
    when check_violation then null;
  end;
end;
$$;
select pass('timed events reject an end at or before the start');

update public.user_preferences
set timezone = 'America/New_York'
where user_id = '00000000-0000-4000-8000-0000000000a1';

select is(
  (
    select timezone
    from public.user_preferences
    where user_id = '00000000-0000-4000-8000-0000000000a1'
  ),
  'America/New_York',
  'preferences accept a supported IANA timezone'
);

do $$
begin
  begin
    update public.user_preferences
    set timezone = 'Not/A_Timezone'
    where user_id = '00000000-0000-4000-8000-0000000000a1';
    raise exception 'invalid preference timezone unexpectedly succeeded';
  exception
    when invalid_parameter_value then null;
  end;
end;
$$;
select pass('preferences reject an unsupported timezone');

insert into public.events (
  owner_id,
  calendar_id,
  title,
  is_all_day,
  starts_at,
  ends_at,
  timezone
)
values (
  '00000000-0000-4000-8000-0000000000a1',
  current_setting('daypop.test_calendar_id')::uuid,
  'valid timezone event',
  false,
  timestamptz '2026-08-02 13:00:00+00',
  timestamptz '2026-08-02 14:00:00+00',
  'America/New_York'
);
select pass('timed events accept a supported IANA timezone');

do $$
begin
  begin
    insert into public.events (
      owner_id,
      calendar_id,
      title,
      is_all_day,
      starts_at,
      ends_at,
      timezone
    )
    values (
      '00000000-0000-4000-8000-0000000000a1',
      current_setting('daypop.test_calendar_id')::uuid,
      'invalid timezone event',
      false,
      timestamptz '2026-08-02 13:00:00+00',
      timestamptz '2026-08-02 14:00:00+00',
      'Not/A_Timezone'
    );
    raise exception 'invalid event timezone unexpectedly succeeded';
  exception
    when invalid_parameter_value then null;
  end;
end;
$$;
select pass('timed events reject an unsupported timezone');

select is(
  (
    select count(*)::integer
    from pg_trigger
    where tgname in ('events_validate_timezone', 'user_preferences_validate_timezone')
      and not tgisinternal
  ),
  2,
  'both public timezone write boundaries use the controlled trigger'
);

select is(
  (
    select prosecdef
    from pg_catalog.pg_proc
    where oid = 'public.validate_daypop_timezone()'::regprocedure
  ),
  false,
  'timezone validation uses security invoker'
);

select is(
  (
    select proconfig[1]
    from pg_catalog.pg_proc
    where oid = 'public.validate_daypop_timezone()'::regprocedure
  ),
  concat('search_path=', chr(34), chr(34)),
  'timezone validation fixes an empty search_path'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.validate_daypop_timezone()',
    'execute'
  ),
  'anon cannot invoke the timezone trigger function directly'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.validate_daypop_timezone()',
    'execute'
  ),
  'authenticated cannot invoke the timezone trigger function directly'
);

insert into public.todos (owner_id, calendar_id, title, due_date)
values (
  '00000000-0000-4000-8000-0000000000a1',
  current_setting('daypop.test_calendar_id')::uuid,
  'cascade todo',
  date '2026-08-01'
);

insert into public.stickers (owner_id, calendar_id, sticker_date, glyph)
values (
  '00000000-0000-4000-8000-0000000000a1',
  current_setting('daypop.test_calendar_id')::uuid,
  date '2026-08-01',
  '🌱'
);

select is(
  (select count(*)::integer from public.calendars),
  1,
  'owner can read their own calendar'
);

do $$
begin
  begin
    insert into public.calendars (owner_id, name)
    values ('00000000-0000-4000-8000-0000000000b2', 'forged calendar');
    raise exception 'cross-owner insert unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
select pass('owner cannot insert a row for another user');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);

select is(
  (
    select count(*)::integer
    from public.calendars
    where owner_id = '00000000-0000-4000-8000-0000000000a1'
  ),
  0,
  'second user cannot read the first user calendar'
);

do $$
declare
  changed_count integer;
begin
  update public.calendars
  set name = 'forged update'
  where id = current_setting('daypop.test_calendar_id')::uuid;
  get diagnostics changed_count = row_count;
  if changed_count <> 0 then
    raise exception 'second user updated first user calendar';
  end if;

  begin
    insert into public.events (
      owner_id,
      calendar_id,
      title,
      is_all_day,
      start_date,
      end_date
    )
    values (
      '00000000-0000-4000-8000-0000000000b2',
      current_setting('daypop.test_calendar_id')::uuid,
      'cross-owner child',
      true,
      date '2026-08-01',
      date '2026-08-01'
    );
    raise exception 'cross-owner child insert unexpectedly succeeded';
  exception
    when foreign_key_violation then null;
  end;
end;
$$;
select pass('second user cannot update or attach child rows to another owner calendar');

reset role;

delete from auth.users
where id = '00000000-0000-4000-8000-0000000000a1';

select is(
  (
    select sum(row_count)::integer
    from (
      select count(*) as row_count from public.calendars where owner_id = '00000000-0000-4000-8000-0000000000a1'
      union all
      select count(*) from public.events where owner_id = '00000000-0000-4000-8000-0000000000a1'
      union all
      select count(*) from public.todos where owner_id = '00000000-0000-4000-8000-0000000000a1'
      union all
      select count(*) from public.stickers where owner_id = '00000000-0000-4000-8000-0000000000a1'
    ) as owned_rows
  ),
  0,
  'deleting an auth user cascades through calendars and owned child rows'
);

select * from finish();
rollback;
