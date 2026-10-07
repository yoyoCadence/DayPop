-- DP-138: `delete_calendar_with_reassignment`.
--
-- The JS suite reaches this through `FakeSupabase`. This file checks it against
-- a real database, where the partial unique index on the default calendar, the
-- composite todo foreign key, RLS and the transaction boundary are the genuine
-- article — the first of those is exactly what the client-side version of this
-- operation got wrong.

begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (id)
values
  ('00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000b2');

-- ---------- shape and grants ----------

select is(
  (select prosecdef from pg_proc where oid = 'public.delete_calendar_with_reassignment(uuid)'::regprocedure),
  false,
  'the function is security invoker'
);

select is(
  (select proconfig[1] from pg_proc where oid = 'public.delete_calendar_with_reassignment(uuid)'::regprocedure),
  concat('search_path=', chr(34), chr(34)),
  'the function pins an empty search_path'
);

select ok(
  has_function_privilege('authenticated', 'public.delete_calendar_with_reassignment(uuid)', 'execute'),
  'authenticated may execute it'
);

select ok(
  not has_function_privilege('anon', 'public.delete_calendar_with_reassignment(uuid)', 'execute'),
  'anon may not execute it'
);

-- ---------- fixtures: owner A has three calendars, owner B has two ----------

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);

insert into public.calendars (id, owner_id, name, color, sort_order)
values ('00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000b2', 'B 的工作', '#2563eb', 1);
insert into public.events (id, owner_id, calendar_id, title, is_all_day, start_date, end_date)
values (
  '00000000-0000-4000-8000-0000000000e9', '00000000-0000-4000-8000-0000000000b2',
  '00000000-0000-4000-8000-0000000000c9', 'B 的行程', true, date '2026-08-03', date '2026-08-03'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);

select set_config(
  'daypop.default_calendar',
  (select id::text from public.calendars where owner_id = '00000000-0000-4000-8000-0000000000a1' and is_default),
  true
);

insert into public.calendars (id, owner_id, name, color, sort_order)
values
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a1', '工作', '#2563eb', 1),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000a1', '家庭', '#16a34a', 2);

-- 工作 holds an event, a parent todo with a subtask, and a sticker.
insert into public.events (id, owner_id, calendar_id, title, is_all_day, start_date, end_date)
values (
  '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000c2', '工作會議', true, date '2026-08-03', date '2026-08-03'
);
insert into public.todos (id, owner_id, calendar_id, title)
values (
  '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000c2', '父待辦'
);
insert into public.todos (id, owner_id, calendar_id, parent_id, title)
values (
  '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000d1', '子待辦'
);
insert into public.stickers (id, owner_id, calendar_id, sticker_date, glyph)
values (
  '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000c2', date '2026-08-03', '⭐'
);

-- ---------- a failure part-way rolls everything back ----------
--
-- A trigger that rejects the sticker move stands in for any error after rows
-- have started to move. `stickers` is the last of the three tables, so the
-- event and both todos have already been re-homed when it fires.

reset role;
-- Created inside this transaction and rolled back with it.
create function public.dp138_reject_sticker_move() returns trigger language plpgsql as $$
begin
  raise exception 'sticker move rejected for the test';
end;
$$;
create trigger reject_sticker_move
before update on public.stickers
for each row execute function public.dp138_reject_sticker_move();
set local role authenticated;

select throws_ok(
  $$ select public.delete_calendar_with_reassignment('00000000-0000-4000-8000-0000000000c2') $$,
  'P0001',
  'sticker move rejected for the test',
  'an error after the first rows have moved fails the whole call'
);

select is(
  (
    select count(*)::integer
    from (
      select calendar_id from public.events where owner_id = '00000000-0000-4000-8000-0000000000a1'
      union all
      select calendar_id from public.todos where owner_id = '00000000-0000-4000-8000-0000000000a1'
      union all
      select calendar_id from public.stickers where owner_id = '00000000-0000-4000-8000-0000000000a1'
    ) moved
    where calendar_id = '00000000-0000-4000-8000-0000000000c2'
  ),
  4,
  'after the failure every row is still on the calendar that was to be deleted'
);

select is(
  (select count(*)::integer from public.calendars where owner_id = '00000000-0000-4000-8000-0000000000a1'),
  3,
  'after the failure the calendar still exists'
);

reset role;
drop trigger reject_sticker_move on public.stickers;
set local role authenticated;

-- ---------- deleting a non-default calendar ----------

select is(
  public.delete_calendar_with_reassignment('00000000-0000-4000-8000-0000000000c2'),
  true,
  'deleting an owned non-default calendar returns true'
);

select is(
  (select count(*)::integer from public.calendars where id = '00000000-0000-4000-8000-0000000000c2'),
  0,
  'the calendar is gone'
);

select is(
  (
    select array_agg(distinct calendar_id::text)
    from (
      select calendar_id from public.events where owner_id = '00000000-0000-4000-8000-0000000000a1'
      union all
      select calendar_id from public.todos where owner_id = '00000000-0000-4000-8000-0000000000a1'
      union all
      select calendar_id from public.stickers where owner_id = '00000000-0000-4000-8000-0000000000a1'
    ) moved
  ),
  array[current_setting('daypop.default_calendar')],
  'its event, parent todo, subtask and sticker all moved to the existing default'
);

select is(
  (select parent_id::text from public.todos where id = '00000000-0000-4000-8000-0000000000d2'),
  '00000000-0000-4000-8000-0000000000d1',
  'the subtask kept its parent across the move'
);

select is(
  (select id::text from public.calendars where owner_id = '00000000-0000-4000-8000-0000000000a1' and is_default),
  current_setting('daypop.default_calendar'),
  'the default calendar is unchanged'
);

-- ---------- a retry after a lost response ----------

select is(
  public.delete_calendar_with_reassignment('00000000-0000-4000-8000-0000000000c2'),
  false,
  'a calendar the caller no longer owns returns false instead of failing'
);

-- ---------- deleting the default calendar ----------
--
-- The case the client-side sequence could never complete: promoting 家庭 while
-- the old default still existed violated `calendars_one_default_per_owner_idx`.

select is(
  public.delete_calendar_with_reassignment(current_setting('daypop.default_calendar')::uuid),
  true,
  'deleting the default calendar succeeds'
);

select is(
  (select array_agg(name order by name) from public.calendars where owner_id = '00000000-0000-4000-8000-0000000000a1'),
  array['家庭'],
  'only the surviving calendar is left'
);

select is(
  (select count(*)::integer from public.calendars where owner_id = '00000000-0000-4000-8000-0000000000a1' and is_default),
  1,
  'the owner has exactly one default calendar afterwards'
);

select is(
  (select is_default from public.calendars where id = '00000000-0000-4000-8000-0000000000c3'),
  true,
  'the survivor was promoted to default'
);

select is(
  (
    select count(*)::integer
    from (
      select calendar_id from public.events where owner_id = '00000000-0000-4000-8000-0000000000a1'
      union all
      select calendar_id from public.todos where owner_id = '00000000-0000-4000-8000-0000000000a1'
      union all
      select calendar_id from public.stickers where owner_id = '00000000-0000-4000-8000-0000000000a1'
    ) moved
    where calendar_id = '00000000-0000-4000-8000-0000000000c3'
  ),
  4,
  'every row followed the promoted calendar; nothing was lost'
);

-- ---------- the last calendar ----------

select throws_ok(
  $$ select public.delete_calendar_with_reassignment('00000000-0000-4000-8000-0000000000c3') $$,
  'P0001',
  'cannot delete the only calendar',
  'the owner''s last calendar is refused'
);

select is(
  (select count(*)::integer from public.calendars where owner_id = '00000000-0000-4000-8000-0000000000a1'),
  1,
  'and it is still there'
);

-- ---------- another owner's calendar ----------

select is(
  public.delete_calendar_with_reassignment('00000000-0000-4000-8000-0000000000c9'),
  false,
  'another owner''s calendar is reported as not found'
);

reset role;

select is(
  (select count(*)::integer from public.calendars where owner_id = '00000000-0000-4000-8000-0000000000b2'),
  2,
  'the other owner still has both calendars'
);

select is(
  (select calendar_id::text from public.events where id = '00000000-0000-4000-8000-0000000000e9'),
  '00000000-0000-4000-8000-0000000000c9',
  'and their event has not moved'
);

-- ---------- without a session ----------

set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);

select throws_ok(
  $$ select public.delete_calendar_with_reassignment('00000000-0000-4000-8000-0000000000c9') $$,
  '42501',
  'authentication required',
  'a call without a user is refused'
);

select * from finish();
rollback;
