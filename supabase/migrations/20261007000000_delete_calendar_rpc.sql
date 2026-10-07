-- DP-138: delete a calendar and re-home its rows in one transaction.
--
-- The client did this as four or five separate PostgREST writes: move
-- `events`, move `todos`, move `stickers`, promote another calendar when the
-- default was the one being deleted, then delete. Two things were wrong, and
-- no reordering of separate requests fixes both:
--
-- 1. **Deleting the default calendar could never succeed.**
--    `calendars_one_default_per_owner_idx` is a partial unique index and is
--    checked after every statement. Promoting the survivor while the old
--    default still exists is a second default row, so the promote request
--    failed with `duplicate key value violates unique constraint` — after the
--    three moves had already been committed. Reproduced on a local database
--    built from these migrations: the calendar stayed, still the default, with
--    its event, todos and sticker already moved to the other calendar, and
--    every retry repeated it. Deleting first and promoting second avoids the
--    index but leaves the owner with no default calendar if the second request
--    is lost; the client validates every loaded document against "exactly one
--    default calendar" and would then refuse to load the account at all.
--
-- 2. **A failure part-way left the server ahead of the client.** Whatever had
--    been moved stayed moved while the client kept its last confirmed document.
--
-- As one function the order is free: rows move, the calendar goes, and only
-- then is the survivor promoted — at no statement boundary are there two
-- defaults, and any error rolls the whole thing back.
--
-- Which calendar inherits the rows mirrors `calendarDeletionPlan()` in
-- `src/domain/mutations.ts`: the owner's existing default if it survives,
-- otherwise the first survivor by `sort_order`. `created_at` and `id` break a
-- tie in `sort_order` so the choice is deterministic; the domain function has
-- no such tie-break, which only matters for imported data that reuses a
-- `sort_order`. The server decides and the client reads the result back.
--
-- The three child tables are each moved by a single statement. For `todos`
-- that is required, not just tidy: `todos_parent_owner_calendar_fk` ties a
-- subtask to its parent's calendar, and it is checked at the end of the
-- statement, so a parent and its children have to change calendar together.
--
-- Guards follow the house pattern (`delete_event_with_attachment_cleanup`,
-- `cancel_event_occurrence`): `security invoker` with an empty `search_path`,
-- an explicit `auth.uid()` check, and an `authenticated`-only grant. The owner
-- is always `auth.uid()`; no owner id is accepted from the caller, and every
-- statement also filters `owner_id` rather than relying on RLS alone.
--
-- Returns `true` when the calendar was deleted and `false` when the caller owns
-- no calendar with that id — typically a retry after a response was lost, or a
-- calendar already removed elsewhere. `false` is therefore also "it is gone",
-- and the client reloads either way (the same reading as DP-134/135). Refusing
-- the owner's last calendar is an error rather than `false`, so the two cannot
-- be confused.

create or replace function public.delete_calendar_with_reassignment(
  p_calendar_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target_id uuid;
  target_is_default boolean;
begin
  if caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Serialise every calendar deletion by this owner. Without it two concurrent
  -- calls could each pick the other's calendar as the target.
  perform 1
  from public.calendars calendar
  where calendar.owner_id = caller
  order by calendar.id
  for update;

  if not exists (
    select 1
    from public.calendars calendar
    where calendar.id = p_calendar_id
      and calendar.owner_id = caller
  ) then
    return false;
  end if;

  select calendar.id, calendar.is_default
  into target_id, target_is_default
  from public.calendars calendar
  where calendar.owner_id = caller
    and calendar.id <> p_calendar_id
  order by calendar.is_default desc, calendar.sort_order, calendar.created_at, calendar.id
  limit 1;

  if target_id is null then
    raise exception 'cannot delete the only calendar' using errcode = 'P0001';
  end if;

  update public.events event
  set calendar_id = target_id
  where event.calendar_id = p_calendar_id
    and event.owner_id = caller;

  update public.todos todo
  set calendar_id = target_id
  where todo.calendar_id = p_calendar_id
    and todo.owner_id = caller;

  update public.stickers sticker
  set calendar_id = target_id
  where sticker.calendar_id = p_calendar_id
    and sticker.owner_id = caller;

  delete from public.calendars calendar
  where calendar.id = p_calendar_id
    and calendar.owner_id = caller;

  -- Only now, with the old default gone, can another row carry the flag.
  if not target_is_default then
    update public.calendars calendar
    set is_default = true
    where calendar.id = target_id
      and calendar.owner_id = caller;
  end if;

  return true;
end;
$$;

revoke all on function public.delete_calendar_with_reassignment(uuid) from public;
revoke all on function public.delete_calendar_with_reassignment(uuid) from anon;
grant execute on function public.delete_calendar_with_reassignment(uuid) to authenticated;
