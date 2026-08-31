-- DP-082 review: atomic single-occurrence cancel and replace.
--
-- Both operations touch two or three rows across `events`, `event_exceptions`
-- and `attachment_cleanup_jobs`. The client was doing them as separate
-- PostgREST writes, which review found broken in two ways that no ordering of
-- those writes can fix:
--
-- 1. **Attachment cleanup was skipped.** Cancelling an occurrence that had a
--    replacement deleted that event with a plain `delete`, so its
--    `event_attachments` rows went with the FK cascade while the Storage
--    objects were never enqueued in `attachment_cleanup_jobs` — an orphan file
--    nothing can find again. `delete_event_with_attachment_cleanup` already
--    solves that for whole events; `cancel_event_occurrence` repeats its
--    enqueue-then-delete body for the one event it removes. Copy that body from
--    `20260809085514`, its current definition — **not** from the original in
--    `20260809060200`, whose `ON CONFLICT` that follow-up existed to remove.
--    See the comment at the enqueue itself.
--
-- 2. **Retries were not idempotent.** The client mints a fresh exception id per
--    attempt and PostgREST's `upsert` infers its conflict target from the
--    primary key, so a retry after a lost response inserted a *second* row for
--    the same occurrence and hit `event_exceptions_event_date_unique_idx`. For
--    replace, the new replacement event had already been written by then, so
--    every retry left another orphan behind. PostgREST cannot express the fix,
--    because both unique indexes are **partial** and `ON CONFLICT` can only
--    infer a partial index when the statement repeats its `WHERE` predicate.
--    Written out in PL/pgSQL that is straightforward, so the reconciliation
--    lives here: the stored row decides, never the id the caller proposed.
--
-- Being one function each also makes each operation one transaction, which
-- removes the partial-failure window the client-side version could only
-- document.
--
-- Guards follow the house pattern (`delete_event_with_attachment_cleanup`,
-- `replace_daypop_data`): `security invoker` with an empty `search_path`, an
-- explicit `auth.uid()` check, and an `authenticated`-only grant. The owner is
-- always `auth.uid()`; no owner id is accepted from the caller. Every statement
-- also filters `owner_id`, so a mis-scoped call fails as "no rows" rather than
-- relying on RLS alone.
--
-- Client-proposed ids are kept, as everywhere else in this schema, but are only
-- ever used for a row that does not exist yet: an id that already belongs to
-- somebody else is rejected up front rather than reaching an `ON CONFLICT`.
--
-- Both return `jsonb` carrying the stored rows, so the adapter maps the
-- database's own values — including the trigger-set timestamps it may not
-- write — back into its snapshot, exactly as `#upsertEvent()` does.

create or replace function public.cancel_event_occurrence(
  p_event_id uuid,
  p_exception_id uuid,
  p_occurrence_date date,
  p_occurrence_starts_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  existing public.event_exceptions;
  stored public.event_exceptions;
  cleanup_count integer;
begin
  if account_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if (p_occurrence_date is null) = (p_occurrence_starts_at is null) then
    raise exception 'exactly one occurrence key is required' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.events event
    where event.id = p_event_id
      and event.owner_id = account_id
      and event.recurrence_rule is not null
  ) then
    raise exception 'event is not a recurring event owned by the caller'
      using errcode = '22023';
  end if;

  -- Reconciled against the stored row, not against anything the caller sent.
  -- This is what makes a retried write update the existing exception instead of
  -- inserting a duplicate the partial unique index would reject.
  select *
    into existing
  from public.event_exceptions candidate
  where candidate.event_id = p_event_id
    and candidate.owner_id = account_id
    and candidate.occurrence_date is not distinct from p_occurrence_date
    and candidate.occurrence_starts_at is not distinct from p_occurrence_starts_at;

  if existing.id is not null then
    update public.event_exceptions
    set is_cancelled = true, replacement_event_id = null
    where id = existing.id
      and owner_id = account_id
    returning * into stored;
  else
    -- A proposed id that is already taken is refused rather than silently
    -- updating somebody else's row through `ON CONFLICT`.
    if p_exception_id is not null and exists (
      select 1 from public.event_exceptions candidate where candidate.id = p_exception_id
    ) then
      raise exception 'proposed exception id already exists' using errcode = '23505';
    end if;

    insert into public.event_exceptions (
      id, owner_id, event_id, occurrence_date, occurrence_starts_at,
      is_cancelled, replacement_event_id
    )
    values (
      coalesce(p_exception_id, pg_catalog.gen_random_uuid()), account_id, p_event_id,
      p_occurrence_date, p_occurrence_starts_at, true, null
    )
    returning * into stored;
  end if;

  -- The exception has stopped pointing at the replacement before that event is
  -- deleted. Both FKs are `on delete cascade`, so the other order would take
  -- this row with it.
  if existing.replacement_event_id is not null then
    -- **No `ON CONFLICT` here, deliberately.** `20260809085514` removed exactly
    -- that clause from both delete RPCs, and this migration reintroduced it by
    -- copying the superseded body — pgTAP caught it as `new row violates
    -- row-level security policy for table attachment_cleanup_jobs`.
    --
    -- The reason: `attachment_cleanup_jobs_select_orphan_own` only makes a
    -- queued row visible once no `event_attachments` row still holds that
    -- `object_path`. At this point the metadata is still there — the cascade
    -- below has not run yet — so the row just inserted is invisible, and
    -- `ON CONFLICT` has to read the conflicting row to decide what to do.
    --
    -- Conflict handling is not needed anyway: the delete below cascades the
    -- metadata away, so a retry finds nothing to enqueue and, having set
    -- `replacement_event_id` to null, never reaches this block at all.
    insert into public.attachment_cleanup_jobs (owner_id, bucket_id, object_path)
    select attachment.owner_id, 'event-attachments', attachment.object_path
    from public.event_attachments attachment
    where attachment.event_id = existing.replacement_event_id
      and attachment.owner_id = account_id;

    get diagnostics cleanup_count = row_count;

    delete from public.events event
    where event.id = existing.replacement_event_id
      and event.owner_id = account_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'exception', pg_catalog.to_jsonb(stored),
    'deleted_event_id', existing.replacement_event_id,
    'enqueued_cleanup', coalesce(cleanup_count, 0)
  );
end;
$$;

-- The replacement event's columns arrive as one jsonb object rather than
-- fourteen arguments, following the import RPCs. Only the keys named below are
-- read; `owner_id` in particular is ignored and always set from `auth.uid()`,
-- and `recurrence_rule` is written as NULL because a detached occurrence never
-- recurs.
create or replace function public.replace_event_occurrence(
  p_event_id uuid,
  p_exception_id uuid,
  p_occurrence_date date,
  p_occurrence_starts_at timestamptz,
  p_replacement jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  existing public.event_exceptions;
  replacement_id uuid;
  stored public.event_exceptions;
  stored_event public.events;
begin
  if account_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if (p_occurrence_date is null) = (p_occurrence_starts_at is null) then
    raise exception 'exactly one occurrence key is required' using errcode = '22023';
  end if;

  if coalesce(pg_catalog.jsonb_typeof(p_replacement), 'null') <> 'object' then
    raise exception 'replacement payload must be an object' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.events event
    where event.id = p_event_id
      and event.owner_id = account_id
      and event.recurrence_rule is not null
  ) then
    raise exception 'event is not a recurring event owned by the caller'
      using errcode = '22023';
  end if;

  select *
    into existing
  from public.event_exceptions candidate
  where candidate.event_id = p_event_id
    and candidate.owner_id = account_id
    and candidate.occurrence_date is not distinct from p_occurrence_date
    and candidate.occurrence_starts_at is not distinct from p_occurrence_starts_at;

  -- Reusing the stored replacement is what keeps a retry from stacking up
  -- orphan events: the caller's proposed id is only used the first time.
  replacement_id := coalesce(
    existing.replacement_event_id,
    (p_replacement ->> 'id')::uuid,
    pg_catalog.gen_random_uuid()
  );

  if existing.replacement_event_id is null and exists (
    select 1
    from public.events event
    where event.id = replacement_id
      and event.owner_id <> account_id
  ) then
    raise exception 'proposed replacement id already exists' using errcode = '23505';
  end if;

  insert into public.events (
    id, owner_id, calendar_id, title, location, notes, is_all_day,
    start_date, end_date, starts_at, ends_at, timezone,
    reminder_minutes, recurrence_rule, sharing_scope
  )
  values (
    replacement_id,
    account_id,
    (p_replacement ->> 'calendar_id')::uuid,
    p_replacement ->> 'title',
    p_replacement ->> 'location',
    p_replacement ->> 'notes',
    (p_replacement ->> 'is_all_day')::boolean,
    (p_replacement ->> 'start_date')::date,
    (p_replacement ->> 'end_date')::date,
    (p_replacement ->> 'starts_at')::timestamptz,
    (p_replacement ->> 'ends_at')::timestamptz,
    p_replacement ->> 'timezone',
    coalesce(
      (
        select pg_catalog.array_agg(entry::integer)
        from pg_catalog.jsonb_array_elements_text(p_replacement -> 'reminder_minutes') as entry
      ),
      '{}'::integer[]
    ),
    null,
    coalesce(p_replacement ->> 'sharing_scope', 'inherit')
  )
  on conflict (id) do update set
    calendar_id = excluded.calendar_id,
    title = excluded.title,
    location = excluded.location,
    notes = excluded.notes,
    is_all_day = excluded.is_all_day,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    timezone = excluded.timezone,
    reminder_minutes = excluded.reminder_minutes,
    recurrence_rule = null,
    sharing_scope = excluded.sharing_scope
  returning * into stored_event;

  if existing.id is not null then
    update public.event_exceptions
    set is_cancelled = false, replacement_event_id = replacement_id
    where id = existing.id
      and owner_id = account_id
    returning * into stored;
  else
    if p_exception_id is not null and exists (
      select 1 from public.event_exceptions candidate where candidate.id = p_exception_id
    ) then
      raise exception 'proposed exception id already exists' using errcode = '23505';
    end if;

    insert into public.event_exceptions (
      id, owner_id, event_id, occurrence_date, occurrence_starts_at,
      is_cancelled, replacement_event_id
    )
    values (
      coalesce(p_exception_id, pg_catalog.gen_random_uuid()), account_id, p_event_id,
      p_occurrence_date, p_occurrence_starts_at, false, replacement_id
    )
    returning * into stored;
  end if;

  return pg_catalog.jsonb_build_object(
    'exception', pg_catalog.to_jsonb(stored),
    'event', pg_catalog.to_jsonb(stored_event)
  );
end;
$$;

revoke all on function public.cancel_event_occurrence(uuid, uuid, date, timestamptz) from public;
revoke all on function public.cancel_event_occurrence(uuid, uuid, date, timestamptz) from anon;
grant execute on function public.cancel_event_occurrence(uuid, uuid, date, timestamptz) to authenticated;

revoke all on function public.replace_event_occurrence(uuid, uuid, date, timestamptz, jsonb) from public;
revoke all on function public.replace_event_occurrence(uuid, uuid, date, timestamptz, jsonb) from anon;
grant execute on function public.replace_event_occurrence(uuid, uuid, date, timestamptz, jsonb) to authenticated;
