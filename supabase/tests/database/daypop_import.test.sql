-- DP-056 import RPCs. Everything runs inside one transaction and is rolled
-- back, so no fixture survives the run.
--
-- What a single connection cannot prove is left explicit at the end: the
-- attachment/attendee guard is closed by a *table* lock, and this file asserts
-- the lock is actually held rather than simulating a second session. A true
-- two-connection interleaving needs a live database and is left to preflight.

begin;

create extension if not exists pgtap with schema extensions;
select plan(36);

-- Two accounts, so cross-account isolation can be checked.
insert into auth.users (id, email)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@example.test'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'other@example.test');

-- The account bootstrap trigger creates the profile, preferences and a default
-- calendar for each of them.

create or replace function pg_temp.act_as(p_user uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
end;
$$;

create or replace function pg_temp.payload(p_calendar uuid, p_extra jsonb default '{}'::jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'calendars', jsonb_build_array(
      jsonb_build_object(
        'id', p_calendar,
        'name', '匯入的日曆',
        'color', '#F06C5C',
        'is_visible', true,
        'is_default', true,
        'sort_order', 0
      )
    ),
    'events', '[]'::jsonb,
    'event_exceptions', '[]'::jsonb,
    'todos', '[]'::jsonb,
    'stickers', '[]'::jsonb,
    'preferences', jsonb_build_object(
      'timezone', 'Asia/Taipei',
      'week_starts_on', 0,
      'theme', 'system',
      'theme_id', 'manga',
      'fixed_six_week_grid', true,
      'default_reminder_minutes', '[]'::jsonb,
      'pet_name', '日蹦',
      'pet_enabled', true
    )
  ) || p_extra;
$$;

/** A canonical timed event row. */
create or replace function pg_temp.timed_event(p_id uuid, p_calendar uuid, p_title text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'id', p_id,
    'calendar_id', p_calendar,
    'title', p_title,
    'is_all_day', false,
    'start_date', null,
    'end_date', null,
    'starts_at', '2026-08-16T01:00:00+00:00',
    'ends_at', '2026-08-16T02:00:00+00:00',
    'timezone', 'Asia/Taipei',
    'location', null,
    'notes', null,
    'reminder_minutes', '[]'::jsonb,
    'recurrence_rule', null,
    'sharing_scope', 'inherit'
  );
$$;

/** A canonical all-day event row — dates set, instants and timezone null. */
create or replace function pg_temp.all_day_event(p_id uuid, p_calendar uuid, p_title text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'id', p_id,
    'calendar_id', p_calendar,
    'title', p_title,
    'is_all_day', true,
    'start_date', '2026-08-16',
    'end_date', '2026-08-16',
    'starts_at', null,
    'ends_at', null,
    'timezone', null,
    'location', null,
    'notes', null,
    'reminder_minutes', '[]'::jsonb,
    'recurrence_rule', null,
    'sharing_scope', 'inherit'
  );
$$;

select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------- grants ---

select is(
  (select prosecdef from pg_proc where proname = 'replace_daypop_data'),
  false,
  'replace_daypop_data runs as the caller'
);
select is(
  (select prosecdef from pg_proc where proname = 'append_daypop_ics'),
  false,
  'append_daypop_ics runs as the caller'
);
select is(
  (select proconfig from pg_proc where proname = 'replace_daypop_data'),
  array['search_path='],
  'replace_daypop_data pins an empty search_path'
);
select is(
  (select proconfig from pg_proc where proname = 'append_daypop_ics'),
  array['search_path='],
  'append_daypop_ics pins an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.replace_daypop_data(jsonb)', 'execute'),
  'authenticated may execute replace_daypop_data'
);
select ok(
  not has_function_privilege('anon', 'public.replace_daypop_data(jsonb)', 'execute'),
  'anon may not execute replace_daypop_data'
);
select ok(
  not has_function_privilege('anon', 'public.append_daypop_ics(jsonb)', 'execute'),
  'anon may not execute append_daypop_ics'
);

-- ------------------------------------------------------------ happy path ---

select lives_ok(
  $$select public.replace_daypop_data(pg_temp.payload('bbbbbbbb-0000-4000-8000-000000000001'))$$,
  'replace accepts a minimal canonical payload'
);
select is(
  (select count(*)::int from public.calendars where owner_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1,
  'replace leaves exactly the imported calendar'
);
select is(
  (select id from public.calendars where owner_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'bbbbbbbb-0000-4000-8000-000000000001'::uuid,
  'the surviving calendar is the imported one'
);

-- An all-day event must survive the shape guard. This is the case the earlier
-- `timezone is not null` rule rejected outright.
select lives_ok(
  $$select public.replace_daypop_data(
      pg_temp.payload(
        'bbbbbbbb-0000-4000-8000-000000000001',
        jsonb_build_object('events', jsonb_build_array(
          pg_temp.all_day_event(
            'cccccccc-0000-4000-8000-000000000001',
            'bbbbbbbb-0000-4000-8000-000000000001',
            '生日'
          )
        ))
      )
    )$$,
  'replace accepts an all-day event'
);
select is(
  (select start_date from public.events where id = 'cccccccc-0000-4000-8000-000000000001'),
  '2026-08-16'::date,
  'the all-day event keeps its date'
);
select is(
  (select timezone from public.events where id = 'cccccccc-0000-4000-8000-000000000001'),
  null,
  'the all-day event keeps a null timezone'
);

select lives_ok(
  $$select public.replace_daypop_data(
      pg_temp.payload(
        'bbbbbbbb-0000-4000-8000-000000000001',
        jsonb_build_object('events', jsonb_build_array(
          pg_temp.timed_event(
            'cccccccc-0000-4000-8000-000000000002',
            'bbbbbbbb-0000-4000-8000-000000000001',
            '晨會'
          )
        ))
      )
    )$$,
  'replace accepts a timed event'
);

-- ----------------------------------------------------- preferences restore ---

update public.user_preferences
set default_reminder_minutes = array[10, 30]
where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.replace_daypop_data(pg_temp.payload('bbbbbbbb-0000-4000-8000-000000000001'))$$,
  'replace runs with an empty reminder list in the payload'
);
select is(
  (
    select default_reminder_minutes
    from public.user_preferences
    where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'
  ),
  array[]::integer[],
  'an empty default_reminder_minutes really clears the list'
);

-- ------------------------------------------------------------- rejections ---

select throws_ok(
  $$select public.replace_daypop_data('{}'::jsonb)$$,
  '22023',
  null,
  'an empty object is refused rather than emptying the account'
);
select is(
  (select count(*)::int from public.calendars where owner_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1,
  'the account still has its calendar after the refused empty payload'
);

select throws_ok(
  $$select public.replace_daypop_data(
      pg_temp.payload('bbbbbbbb-0000-4000-8000-000000000001') - 'todos'
    )$$,
  '22023',
  null,
  'a missing top-level collection is refused'
);

select throws_ok(
  $$select public.replace_daypop_data(
      jsonb_set(
        pg_temp.payload('bbbbbbbb-0000-4000-8000-000000000001'),
        '{calendars}',
        '[]'::jsonb
      )
    )$$,
  '22023',
  null,
  'zero calendars is refused'
);

select throws_ok(
  $$select public.replace_daypop_data(
      jsonb_set(
        pg_temp.payload('bbbbbbbb-0000-4000-8000-000000000001'),
        '{calendars,0,is_default}',
        'false'::jsonb
      )
    )$$,
  '22023',
  null,
  'no default calendar is refused'
);

select throws_ok(
  $$select public.replace_daypop_data(
      pg_temp.payload(
        'bbbbbbbb-0000-4000-8000-000000000001',
        jsonb_build_object('events', jsonb_build_array(
          pg_temp.timed_event(
            'cccccccc-0000-4000-8000-000000000003',
            'bbbbbbbb-0000-4000-8000-000000000001',
            '缺欄位'
          ) - 'sharing_scope'
        ))
      )
    )$$,
  '23502',
  null,
  'a row missing sharing_scope is refused rather than filled from a default'
);

select throws_ok(
  $$select public.replace_daypop_data(
      pg_temp.payload(
        'bbbbbbbb-0000-4000-8000-000000000001',
        jsonb_build_object('events', jsonb_build_array(
          pg_temp.timed_event(
            'cccccccc-0000-4000-8000-000000000004',
            'bbbbbbbb-0000-4000-8000-000000000001',
            '缺提醒'
          ) - 'reminder_minutes'
        ))
      )
    )$$,
  '23502',
  null,
  'a row missing reminder_minutes is refused'
);

select throws_ok(
  $$select public.replace_daypop_data(
      pg_temp.payload(
        'bbbbbbbb-0000-4000-8000-000000000001',
        jsonb_build_object('events', jsonb_build_array(
          jsonb_set(
            pg_temp.all_day_event(
              'cccccccc-0000-4000-8000-000000000005',
              'bbbbbbbb-0000-4000-8000-000000000001',
              '形狀錯誤'
            ),
            '{timezone}',
            '"Asia/Taipei"'::jsonb
          )
        ))
      )
    )$$,
  '22023',
  null,
  'an all-day event carrying a timezone is refused'
);

select throws_ok(
  $$select public.replace_daypop_data(
      pg_temp.payload(
        'bbbbbbbb-0000-4000-8000-000000000001',
        jsonb_build_object('preferences', jsonb_build_object('timezone', 'Asia/Taipei'))
      )
    )$$,
  '22023',
  null,
  'partial preferences are refused'
);

-- ------------------------------------------------- attachments / attendees ---

insert into public.events (
  id, owner_id, calendar_id, title, is_all_day, starts_at, ends_at, timezone,
  reminder_minutes, sharing_scope
)
values (
  'dddddddd-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'bbbbbbbb-0000-4000-8000-000000000001',
  '有附件的行程', false,
  '2026-08-16T01:00:00+00:00', '2026-08-16T02:00:00+00:00', 'Asia/Taipei',
  array[]::integer[], 'inherit'
);

insert into public.event_attendees (id, owner_id, event_id, email, response_status)
values (
  'eeeeeeee-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'dddddddd-0000-4000-8000-000000000001',
  'guest@example.test',
  'needs-action'
);

select throws_ok(
  $$select public.replace_daypop_data(pg_temp.payload('bbbbbbbb-0000-4000-8000-000000000001'))$$,
  '23503',
  null,
  'replace refuses while attendee rows exist'
);
select is(
  (select count(*)::int from public.event_attendees where owner_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1,
  'the attendee row is still there after the refusal'
);
select is(
  (select count(*)::int from public.events where id = 'dddddddd-0000-4000-8000-000000000001'),
  1,
  'its event is still there too, so the whole call rolled back'
);

delete from public.event_attendees where owner_id = 'aaaaaaaa-0000-4000-8000-000000000001';

-- ------------------------------------------------------------ append (ics) ---

select lives_ok(
  $$select public.append_daypop_ics(
      jsonb_build_object(
        'events', jsonb_build_array(
          pg_temp.all_day_event(
            'ffffffff-0000-4000-8000-000000000001',
            'bbbbbbbb-0000-4000-8000-000000000001',
            '附加的全天'
          )
        ),
        'event_exceptions', '[]'::jsonb
      )
    )$$,
  'append accepts an all-day event'
);
select is(
  (select count(*)::int from public.events where owner_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  2,
  'append added to what was there rather than replacing it'
);

select throws_ok(
  $$select public.append_daypop_ics(
      jsonb_build_object('events', '[]'::jsonb)
    )$$,
  '22023',
  null,
  'append refuses a payload missing event_exceptions'
);

select throws_ok(
  $$select public.append_daypop_ics(
      jsonb_build_object(
        'events', jsonb_build_array(
          pg_temp.timed_event(
            '11111111-0000-4000-8000-000000000001',
            '99999999-0000-4000-8000-000000000009',
            '別人的日曆'
          )
        ),
        'event_exceptions', '[]'::jsonb
      )
    )$$,
  '23503',
  null,
  'append refuses a calendar this account does not own'
);

-- ------------------------------------------------------------- owner spoof ---

select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000002');

select is(
  (select count(*)::int from public.events where id = 'ffffffff-0000-4000-8000-000000000001'),
  0,
  'the other account cannot see the first account rows'
);

select throws_ok(
  $$select public.append_daypop_ics(
      jsonb_build_object(
        'events', jsonb_build_array(
          pg_temp.timed_event(
            '22222222-0000-4000-8000-000000000001',
            'bbbbbbbb-0000-4000-8000-000000000001',
            '偷別人的日曆'
          )
        ),
        'event_exceptions', '[]'::jsonb
      )
    )$$,
  '23503',
  null,
  'one account cannot append into another account calendar'
);

-- --------------------------------------------------------------- the lock ---
--
-- The attachment/attendee guard is only sound while nothing can insert into
-- those tables between the count and the delete. That is what the SHARE lock
-- buys, so assert the lock is genuinely held after a successful replace rather
-- than trusting the comment. A real two-session interleaving needs a second
-- connection and belongs to preflight.

select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000001');
select public.replace_daypop_data(pg_temp.payload('bbbbbbbb-0000-4000-8000-000000000001'));

select ok(
  exists (
    select 1
    from pg_locks
    where pid = pg_backend_pid()
      and relation = 'public.event_attachments'::regclass
      and mode = 'ShareLock'
  ),
  'replace holds a SHARE lock on event_attachments'
);
select ok(
  exists (
    select 1
    from pg_locks
    where pid = pg_backend_pid()
      and relation = 'public.event_attendees'::regclass
      and mode = 'ShareLock'
  ),
  'replace holds a SHARE lock on event_attendees'
);

select * from finish();
rollback;
