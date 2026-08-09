begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

select has_column(
  'public',
  'profiles',
  'legacy_imported_at',
  'profiles record the one-time legacy import timestamp'
);

select has_column(
  'public',
  'profiles',
  'legacy_import_fingerprint',
  'profiles record the exact legacy document fingerprint'
);

select has_function(
  'public',
  'import_legacy_daypop',
  array['text', 'jsonb'],
  'legacy import has one typed RPC entry point'
);

select has_trigger(
  'public',
  'profiles',
  'profiles_guard_legacy_import_marker',
  'profiles guard completion markers outside the import RPC'
);

select has_function(
  'daypop_private',
  'guard_legacy_import_marker',
  array[]::text[],
  'the profile marker guard stays outside the exposed API schema'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'daypop_private.guard_legacy_import_marker()',
    'execute'
  ),
  'authenticated users cannot invoke the private marker guard directly'
);

select hasnt_function(
  'daypop_private',
  'jsonb_array_has_unknown_keys',
  array['jsonb', 'text[]'],
  'the invoker RPC no longer depends on an inaccessible private helper'
);

select is(
  (
    select prosecdef
    from pg_catalog.pg_proc
    where oid = 'public.import_legacy_daypop(text,jsonb)'::regprocedure
  ),
  false,
  'legacy import runs as the authenticated caller so owner RLS remains active'
);

select is(
  (
    select proconfig[1]
    from pg_catalog.pg_proc
    where oid = 'public.import_legacy_daypop(text,jsonb)'::regprocedure
  ),
  concat('search_path=', chr(34), chr(34)),
  'legacy import fixes an empty search_path'
);

select ok(
  (
    select not exists (
      select 1
      from unnest(coalesce(proconfig, array[]::text[])) as setting(value)
      where setting.value like 'daypop.%'
    )
    from pg_catalog.pg_proc
    where oid = 'public.import_legacy_daypop(text,jsonb)'::regprocedure
  ),
  'legacy import does not depend on restricted custom configuration parameters'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.import_legacy_daypop(text,jsonb)',
    'execute'
  ),
  'authenticated users can invoke the import RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.import_legacy_daypop(text,jsonb)',
    'execute'
  ),
  'anonymous users cannot invoke the import RPC'
);

select ok(
  has_column_privilege(
    'authenticated',
    'public.profiles',
    'legacy_import_fingerprint',
    'update'
  ),
  'the invoker RPC has the marker column permission required behind the guard'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'public.profiles',
    'legacy_import_fingerprint',
    'insert'
  ),
  'clients cannot recreate a profile with a forged completion marker'
);

insert into auth.users (id)
values
  ('00000000-0000-4000-8000-0000000000c3'),
  ('00000000-0000-4000-8000-0000000000d4');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c3', true);
select set_config(
  'daypop.legacy_default_calendar',
  (
    select id::text
    from public.calendars
    where owner_id = '00000000-0000-4000-8000-0000000000c3'
      and is_default
  ),
  true
);

select throws_ok(
  $$
    update public.profiles
    set
      legacy_import_fingerprint = repeat('f', 64),
      legacy_imported_at = statement_timestamp()
    where id = '00000000-0000-4000-8000-0000000000c3'
  $$,
  '42501',
  'Legacy import markers are controlled by the import RPC',
  'a direct profile update cannot forge the completion marker'
);

select is(
  (
    public.import_legacy_daypop(
      repeat('a', 64),
      pg_catalog.jsonb_build_object(
        'calendars', jsonb_build_array(jsonb_build_object(
          'id', '10000000-0000-4000-8000-000000000001',
          'name', '舊工作',
          'color', '#3366AA',
          'is_visible', true,
          'sort_order', 1
        )),
        'events', jsonb_build_array(jsonb_build_object(
          'id', '10000000-0000-4000-8000-000000000002',
          'calendar_id', '10000000-0000-4000-8000-000000000001',
          'title', '舊行程',
          'is_all_day', true,
          'start_date', '2026-08-09',
          'end_date', '2026-08-09',
          'starts_at', null,
          'ends_at', null,
          'timezone', null,
          'location', null,
          'notes', null,
          'reminder_minutes', jsonb_build_array(10),
          'recurrence_rule', 'FREQ=DAILY'
        )),
        'event_exceptions', jsonb_build_array(jsonb_build_object(
          'id', '10000000-0000-4000-8000-000000000003',
          'event_id', '10000000-0000-4000-8000-000000000002',
          'occurrence_date', '2026-08-10',
          'occurrence_starts_at', null
        )),
        'todos', jsonb_build_array(jsonb_build_object(
          'id', '10000000-0000-4000-8000-000000000004',
          'calendar_id', current_setting('daypop.legacy_default_calendar'),
          'parent_id', null,
          'title', '舊待辦',
          'due_date', '2026-08-09',
          'priority', 'medium',
          'completed_at', null,
          'sort_order', 0
        )),
        'stickers', jsonb_build_array(jsonb_build_object(
          'id', '10000000-0000-4000-8000-000000000005',
          'calendar_id', current_setting('daypop.legacy_default_calendar'),
          'sticker_date', '2026-08-09',
          'glyph', '🌱',
          'sort_order', 0
        )),
        'preferences', jsonb_build_object(
          'timezone', 'Asia/Taipei',
          'week_starts_on', 1,
          'theme', 'dark',
          'theme_id', 'pixel',
          'fixed_six_week_grid', true,
          'default_reminder_minutes', jsonb_build_array(10),
          'pet_name', '豆豆',
          'pet_enabled', false
        )
      )
    ) ->> 'status'
  ),
  'imported',
  'valid legacy payload imports atomically'
);

select is(
  (
    select count(*)::integer
    from (
      select id from public.calendars where name = '舊工作'
      union all
      select id from public.events where title = '舊行程'
      union all
      select id from public.event_exceptions where event_id = '10000000-0000-4000-8000-000000000002'
      union all
      select id from public.todos where title = '舊待辦'
      union all
      select id from public.stickers where glyph = '🌱'
    ) as imported_rows
  ),
  5,
  'all supported row kinds are owned and visible to the caller'
);

select is(
  (
    select legacy_import_fingerprint
    from public.profiles
    where id = '00000000-0000-4000-8000-0000000000c3'
  ),
  repeat('a', 64),
  'successful import writes the exact fingerprint last'
);

select is(
  (
    public.import_legacy_daypop(
      repeat('a', 64),
      jsonb_build_object(
        'calendars', '[]'::jsonb,
        'events', '[]'::jsonb,
        'event_exceptions', '[]'::jsonb,
        'todos', '[]'::jsonb,
        'stickers', '[]'::jsonb,
        'preferences', '{}'::jsonb
      )
    ) ->> 'status'
  ),
  'already_imported',
  'same-document retries are idempotent before payload writes'
);

select throws_ok(
  $$
    select public.import_legacy_daypop(
      repeat('b', 64),
      jsonb_build_object(
        'calendars', '[]'::jsonb,
        'events', '[]'::jsonb,
        'event_exceptions', '[]'::jsonb,
        'todos', '[]'::jsonb,
        'stickers', '[]'::jsonb,
        'preferences', '{}'::jsonb
      )
    )
  $$,
  '23505',
  'Legacy import has already completed for this account',
  'a different document cannot be imported twice'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000d4', true);
select set_config(
  'daypop.legacy_default_calendar',
  (
    select id::text
    from public.calendars
    where owner_id = '00000000-0000-4000-8000-0000000000d4'
      and is_default
  ),
  true
);

do $$
begin
  begin
    perform public.import_legacy_daypop(
      repeat('c', 64),
      jsonb_build_object(
        'calendars', jsonb_build_array(jsonb_build_object(
          'id', '20000000-0000-4000-8000-000000000001',
          'name', '必須回滾',
          'color', '#3366AA',
          'is_visible', true,
          'sort_order', 1
        )),
        'events', '[]'::jsonb,
        'event_exceptions', '[]'::jsonb,
        'todos', '[]'::jsonb,
        'stickers', jsonb_build_array(jsonb_build_object(
          'id', '20000000-0000-4000-8000-000000000002',
          'calendar_id', current_setting('daypop.legacy_default_calendar'),
          'sticker_date', '2026-08-09',
          'glyph', '',
          'sort_order', 0
        )),
        'preferences', jsonb_build_object(
          'timezone', 'Asia/Taipei',
          'week_starts_on', 0,
          'theme', 'light',
          'theme_id', 'manga',
          'fixed_six_week_grid', false,
          'default_reminder_minutes', '[]'::jsonb,
          'pet_name', '摩卡',
          'pet_enabled', true
        )
      )
    );
    raise exception 'invalid sticker unexpectedly succeeded';
  exception
    when check_violation then null;
  end;
end;
$$;
select pass('a late row constraint aborts the import RPC');

select is(
  (
    select count(*)::integer
    from public.calendars
    where owner_id = '00000000-0000-4000-8000-0000000000d4'
      and name = '必須回滾'
  ),
  0,
  'a late failure rolls back rows inserted earlier in the RPC'
);

select is(
  (
    select legacy_imported_at
    from public.profiles
    where id = '00000000-0000-4000-8000-0000000000d4'
  ),
  null,
  'a failed import leaves the completion marker empty for recovery'
);

select is(
  (
    select count(*)::integer
    from public.calendars
    where owner_id = '00000000-0000-4000-8000-0000000000c3'
  ),
  0,
  'another authenticated account cannot read imported rows'
);

select * from finish();
rollback;
