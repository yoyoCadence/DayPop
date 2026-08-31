-- DP-082 review: the two occurrence RPCs.
--
-- The JS suite exercises these through `FakeSupabase`, which models the parts
-- of Postgres they depend on. This file checks the same behaviour against a
-- real database, where the partial unique indexes, the cascades and the
-- transaction boundary are the genuine article rather than an imitation.

begin;

create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id)
values
  ('00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000b2');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);

select set_config(
  'daypop.calendar_id',
  (
    select id::text
    from public.calendars
    where owner_id = '00000000-0000-4000-8000-0000000000a1'
      and is_default
  ),
  true
);

-- A daily all-day series, so the occurrence key is a plain date.
insert into public.events (
  id, owner_id, calendar_id, title, is_all_day, start_date, end_date, recurrence_rule
)
values (
  '00000000-0000-4000-8000-0000000000e1',
  '00000000-0000-4000-8000-0000000000a1',
  current_setting('daypop.calendar_id')::uuid,
  '站會',
  true,
  date '2026-08-03',
  date '2026-08-03',
  'FREQ=DAILY;COUNT=5'
);

-- ---------- cancel ----------

select set_config(
  'daypop.cancelled',
  public.cancel_event_occurrence(
    '00000000-0000-4000-8000-0000000000e1',
    '00000000-0000-4000-8000-0000000000c1',
    date '2026-08-05',
    null
  )::text,
  true
);

select is(
  (select count(*)::integer from public.event_exceptions),
  1,
  'cancel writes exactly one exception row'
);

select ok(
  (
    select is_cancelled and replacement_event_id is null
    from public.event_exceptions
    where event_id = '00000000-0000-4000-8000-0000000000e1'
  ),
  'the exception is a cancellation with no replacement'
);

-- The retry case: a second call proposing a **different** exception id must
-- reconcile onto the stored row instead of inserting a duplicate that
-- `event_exceptions_event_date_unique_idx` would reject.
select lives_ok(
  $$
    select public.cancel_event_occurrence(
      '00000000-0000-4000-8000-0000000000e1',
      '00000000-0000-4000-8000-0000000000c9',
      date '2026-08-05',
      null
    )
  $$,
  'cancelling the same occurrence again is accepted'
);

select is(
  (select count(*)::integer from public.event_exceptions),
  1,
  'the retry updates the stored row rather than adding a second one'
);

select is(
  (select id from public.event_exceptions),
  '00000000-0000-4000-8000-0000000000c1'::uuid,
  'the retry keeps the id the first call stored'
);

-- ---------- replace ----------

select set_config(
  'daypop.replaced',
  public.replace_event_occurrence(
    '00000000-0000-4000-8000-0000000000e1',
    '00000000-0000-4000-8000-0000000000c1',
    date '2026-08-05',
    null,
    jsonb_build_object(
      'id', '00000000-0000-4000-8000-0000000000f1',
      'calendar_id', current_setting('daypop.calendar_id'),
      'title', '改期的站會',
      'is_all_day', true,
      'start_date', '2026-08-06',
      'end_date', '2026-08-06'
    )
  )::text,
  true
);

select is(
  (
    select title
    from public.events
    where id = '00000000-0000-4000-8000-0000000000f1'
  ),
  '改期的站會',
  'replace writes the standalone event'
);

select ok(
  (
    select recurrence_rule is null
    from public.events
    where id = '00000000-0000-4000-8000-0000000000f1'
  ),
  'a replacement never recurs, whatever the payload said'
);

select is(
  (
    select replacement_event_id
    from public.event_exceptions
    where event_id = '00000000-0000-4000-8000-0000000000e1'
  ),
  '00000000-0000-4000-8000-0000000000f1'::uuid,
  'the exception now points at the replacement'
);

-- The orphan case: a retry proposing a fresh replacement id must reuse the
-- stored one rather than leaving the first replacement behind.
select set_config(
  'daypop.retried',
  public.replace_event_occurrence(
    '00000000-0000-4000-8000-0000000000e1',
    '00000000-0000-4000-8000-0000000000c9',
    date '2026-08-05',
    null,
    jsonb_build_object(
      'id', '00000000-0000-4000-8000-0000000000f9',
      'calendar_id', current_setting('daypop.calendar_id'),
      'title', '改期的站會（重試）',
      'is_all_day', true,
      'start_date', '2026-08-06',
      'end_date', '2026-08-06'
    )
  )::text,
  true
);

select is(
  (
    select count(*)::integer
    from public.events
    where id <> '00000000-0000-4000-8000-0000000000e1'
  ),
  1,
  'the retry updates the stored replacement instead of adding an orphan'
);

select is(
  (
    select title
    from public.events
    where id = '00000000-0000-4000-8000-0000000000f1'
  ),
  '改期的站會（重試）',
  'the retry applied its edit to the stored replacement'
);

-- ---------- attachment cleanup ----------

insert into public.event_attachments (
  id, owner_id, event_id, object_path, file_name, mime_type, size_bytes
)
values (
  '00000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000f1',
  '00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000f1/00000000-0000-4000-8000-0000000000d1',
  'agenda.pdf',
  'application/pdf',
  1024
);

select set_config(
  'daypop.cancelled_again',
  public.cancel_event_occurrence(
    '00000000-0000-4000-8000-0000000000e1',
    '00000000-0000-4000-8000-0000000000c1',
    date '2026-08-05',
    null
  )::text,
  true
);

select is(
  (
    select count(*)::integer
    from public.events
    where id = '00000000-0000-4000-8000-0000000000f1'
  ),
  0,
  'cancelling after a replacement deletes that replacement event'
);

-- This is the fault review found: the metadata always went with the FK
-- cascade, but without an enqueue the Storage object had nothing left
-- pointing at it.
select is(
  (
    select count(*)::integer
    from public.attachment_cleanup_jobs
    where object_path
      = '00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000f1/00000000-0000-4000-8000-0000000000d1'
  ),
  1,
  'the replacement attachment object is queued for Storage cleanup'
);

select is(
  (select count(*)::integer from public.event_attachments),
  0,
  'the attachment metadata is gone with the cascade'
);

-- ---------- guards ----------

select throws_ok(
  $$
    select public.cancel_event_occurrence(
      '00000000-0000-4000-8000-0000000000e1',
      '00000000-0000-4000-8000-0000000000c2',
      date '2026-08-05',
      timestamptz '2026-08-05 01:00:00+00'
    )
  $$,
  '22023',
  'exactly one occurrence key is required',
  'supplying both occurrence keys is refused'
);

-- Another account's series must not be reachable, RLS or not.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);

select throws_ok(
  $$
    select public.cancel_event_occurrence(
      '00000000-0000-4000-8000-0000000000e1',
      '00000000-0000-4000-8000-0000000000c3',
      date '2026-08-04',
      null
    )
  $$,
  '22023',
  'event is not a recurring event owned by the caller',
  'another account cannot cancel an occurrence of a series it does not own'
);

select * from finish();
rollback;
