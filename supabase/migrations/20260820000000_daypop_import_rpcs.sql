-- DP-056: atomic import for a signed-in account.
--
-- The client cannot do this with row-level writes: a JSON restore replaces rows
-- across five tables and an .ics import appends across two, and anything that
-- fails part-way leaves the account half-imported. Both operations therefore
-- live in one function each, so the whole thing commits or none of it does.
--
-- Guards mirror `import_legacy_daypop`: the same row limits, `security invoker`
-- with an empty `search_path`, and an `authenticated`-only grant. The owner is
-- always `auth.uid()`; an `owner_id` in the payload is neither read nor trusted.
--
-- The per-collection key allowlist is written out in each function body rather
-- than shared. `daypop_private.jsonb_array_has_unknown_keys` was dropped when
-- the legacy RPC moved to `security invoker`, because a function running as the
-- caller cannot execute a helper in a schema the caller has no rights to, and
-- widening that schema's privileges for two RPCs is not worth it.
--
-- **Missing keys must fail closed.** `jsonb_typeof(p_payload -> 'absent')` is
-- SQL NULL, and `if NULL then ... end if` takes neither branch, so a check
-- written as "reject when the type is wrong" lets `{}` through — and `{}` would
-- reach the deletes and empty the account. Every shape test below is therefore
-- written as "require the exact type" and wrapped in `coalesce(..., false)`.
--
-- Neither function touches `profiles`, the legacy import marker, Auth identity,
-- `event_attachments`, `event_attendees` or `attachment_cleanup_jobs`. The two
-- tables that are *not* in the portable payload — attachments and attendees —
-- would be destroyed by the event cascade, so a replace refuses while either
-- still has rows rather than deleting data no backup carries.

create or replace function public.replace_daypop_data(
  p_payload jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  attachment_count integer;
  attendee_count integer;
  default_calendar_count integer;
  preference_keys text[];
begin
  if account_id is null then
    raise exception 'Authentication is required for import'
      using errcode = '42501';
  end if;
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Import payload must be an object'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_payload) as payload_key(key)
    where key not in (
      'calendars',
      'events',
      'event_exceptions',
      'todos',
      'stickers',
      'preferences'
    )
  ) then
    raise exception 'Import payload has unsupported top-level fields'
      using errcode = '22023';
  end if;

  -- Required *and* exactly typed. See the note above on why this is phrased
  -- positively and coalesced.
  if not coalesce(
    pg_catalog.jsonb_typeof(p_payload -> 'calendars') = 'array'
      and pg_catalog.jsonb_typeof(p_payload -> 'events') = 'array'
      and pg_catalog.jsonb_typeof(p_payload -> 'event_exceptions') = 'array'
      and pg_catalog.jsonb_typeof(p_payload -> 'todos') = 'array'
      and pg_catalog.jsonb_typeof(p_payload -> 'stickers') = 'array'
      and pg_catalog.jsonb_typeof(p_payload -> 'preferences') = 'object',
    false
  ) then
    raise exception 'Import payload is missing a required collection or has an invalid shape'
      using errcode = '22023';
  end if;

  if pg_catalog.jsonb_array_length(p_payload -> 'calendars') > 100
    or pg_catalog.jsonb_array_length(p_payload -> 'events') > 10000
    or pg_catalog.jsonb_array_length(p_payload -> 'event_exceptions') > 50000
    or pg_catalog.jsonb_array_length(p_payload -> 'todos') > 20000
    or pg_catalog.jsonb_array_length(p_payload -> 'stickers') > 10000
  then
    raise exception 'Import exceeds the allowed row count'
      using errcode = '54000';
  end if;

  if exists (
    select 1
    from (
      values
        (
          'calendars',
          array['id', 'name', 'color', 'is_visible', 'is_default', 'sort_order']::text[]
        ),
        (
          'events',
          array[
            'id', 'calendar_id', 'title', 'is_all_day', 'start_date', 'end_date',
            'starts_at', 'ends_at', 'timezone', 'location', 'notes',
            'reminder_minutes', 'recurrence_rule', 'sharing_scope'
          ]::text[]
        ),
        (
          'event_exceptions',
          array[
            'id', 'event_id', 'occurrence_date', 'occurrence_starts_at',
            'is_cancelled', 'replacement_event_id'
          ]::text[]
        ),
        (
          'todos',
          array[
            'id', 'calendar_id', 'parent_id', 'title', 'due_date', 'priority',
            'completed_at', 'sort_order', 'sharing_scope'
          ]::text[]
        ),
        (
          'stickers',
          array['id', 'calendar_id', 'sticker_date', 'glyph', 'asset_key', 'sort_order']::text[]
        )
    ) as collection(name, allowed_keys)
    cross join lateral pg_catalog.jsonb_array_elements(
      p_payload -> collection.name
    ) as element(value)
    where case
      when pg_catalog.jsonb_typeof(element.value) <> 'object' then true
      else exists (
        select 1
        from pg_catalog.jsonb_object_keys(element.value) as object_key(key)
        where not (object_key.key = any (collection.allowed_keys))
      )
    end
  ) then
    raise exception 'Import payload contains unsupported or sensitive fields'
      using errcode = '22023';
  end if;

  -- Preferences are replaced wholesale, so every key has to be present. A
  -- partial patch here would silently keep values the backup did not contain.
  select coalesce(pg_catalog.array_agg(key), array[]::text[])
  into preference_keys
  from pg_catalog.jsonb_object_keys(p_payload -> 'preferences') as preference_key(key);

  if not (
    preference_keys @> array[
      'default_reminder_minutes', 'fixed_six_week_grid', 'pet_enabled', 'pet_name',
      'theme', 'theme_id', 'timezone', 'week_starts_on'
    ]::text[]
    and coalesce(pg_catalog.array_length(preference_keys, 1), 0) = 8
  ) then
    raise exception 'Import preferences must contain exactly the supported keys'
      using errcode = '22023';
  end if;

  if not coalesce(
    pg_catalog.jsonb_typeof(p_payload -> 'preferences' -> 'default_reminder_minutes') = 'array'
      and pg_catalog.jsonb_typeof(p_payload -> 'preferences' -> 'timezone') = 'string'
      and pg_catalog.jsonb_typeof(p_payload -> 'preferences' -> 'theme') = 'string'
      and pg_catalog.jsonb_typeof(p_payload -> 'preferences' -> 'theme_id') = 'string'
      and pg_catalog.jsonb_typeof(p_payload -> 'preferences' -> 'pet_name') = 'string'
      and pg_catalog.jsonb_typeof(p_payload -> 'preferences' -> 'week_starts_on') = 'number'
      and pg_catalog.jsonb_typeof(p_payload -> 'preferences' -> 'fixed_six_week_grid') = 'boolean'
      and pg_catalog.jsonb_typeof(p_payload -> 'preferences' -> 'pet_enabled') = 'boolean',
    false
  ) then
    raise exception 'Import preferences have invalid value types'
      using errcode = '22023';
  end if;

  -- Cross-row invariants the canonical document guarantees. An unknown-key
  -- allowlist alone would accept a document the App cannot open.
  if pg_catalog.jsonb_array_length(p_payload -> 'calendars') < 1 then
    raise exception 'Import must contain at least one calendar'
      using errcode = '22023';
  end if;

  select count(*) filter (where imported.is_default)
  into default_calendar_count
  from pg_catalog.jsonb_to_recordset(p_payload -> 'calendars') as imported(is_default boolean);

  if default_calendar_count <> 1 then
    raise exception 'Import must contain exactly one default calendar, found %',
      default_calendar_count
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from (
      values
        (
          'calendars',
          array['id', 'name', 'color', 'is_visible', 'is_default', 'sort_order']::text[]
        ),
        (
          'events',
          array['id', 'calendar_id', 'title', 'is_all_day', 'start_date', 'end_date', 'starts_at', 'ends_at', 'timezone', 'location', 'notes', 'reminder_minutes', 'recurrence_rule', 'sharing_scope']::text[]
        ),
        (
          'event_exceptions',
          array['id', 'event_id', 'occurrence_date', 'occurrence_starts_at', 'is_cancelled', 'replacement_event_id']::text[]
        ),
        (
          'todos',
          array['id', 'calendar_id', 'parent_id', 'title', 'due_date', 'priority', 'completed_at', 'sort_order', 'sharing_scope']::text[]
        ),
        (
          'stickers',
          array['id', 'calendar_id', 'sticker_date', 'glyph', 'asset_key', 'sort_order']::text[]
        )
    ) as collection(name, required_keys)
    cross join lateral pg_catalog.jsonb_array_elements(
      p_payload -> collection.name
    ) as element(value)
    where pg_catalog.jsonb_typeof(element.value) <> 'object'
      or not (
        select coalesce(pg_catalog.array_agg(object_key.key), array[]::text[])
        from pg_catalog.jsonb_object_keys(element.value) as object_key(key)
      ) @> collection.required_keys
  ) then
    raise exception 'Import row is missing a required field'
      using errcode = '23502';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_payload -> 'events') as element(value)
    where case
      when pg_catalog.jsonb_typeof(element.value -> 'is_all_day') <> 'boolean' then true
      when (element.value ->> 'is_all_day')::boolean then
        -- All-day: dates carry the occurrence, the instant columns must be null.
        pg_catalog.jsonb_typeof(element.value -> 'start_date') <> 'string'
        or pg_catalog.jsonb_typeof(element.value -> 'end_date') <> 'string'
        or pg_catalog.jsonb_typeof(element.value -> 'starts_at') <> 'null'
        or pg_catalog.jsonb_typeof(element.value -> 'ends_at') <> 'null'
        or pg_catalog.jsonb_typeof(element.value -> 'timezone') <> 'null'
      else
        -- Timed: instants plus a timezone, and no date columns.
        pg_catalog.jsonb_typeof(element.value -> 'starts_at') <> 'string'
        or pg_catalog.jsonb_typeof(element.value -> 'ends_at') <> 'string'
        or pg_catalog.jsonb_typeof(element.value -> 'timezone') <> 'string'
        or pg_catalog.jsonb_typeof(element.value -> 'start_date') <> 'null'
        or pg_catalog.jsonb_typeof(element.value -> 'end_date') <> 'null'
    end
  ) then
    raise exception 'Event rows must match the all-day or timed shape'
      using errcode = '22023';
  end if;

  -- A row lock is not enough here. FOR UPDATE only locks rows that already
  -- exist, so another session can still insert a *new* event and finalize an
  -- attachment on it between the count and the delete — the cleanup job is
  -- consumed by the finalize, the cascade then removes the metadata, and the
  -- Storage object is orphaned. That is a predicate gap, and closing it needs a
  -- lock over the whole relation rather than over the rows read.
  --
  -- SHARE conflicts with ROW EXCLUSIVE, so while this transaction holds it no
  -- session anywhere can insert, update or delete in these two tables; readers
  -- are unaffected. It is coarse, and deliberately so: an import is rare, runs
  -- for a moment, and the alternative is an advisory lock that every writer of
  -- both tables would have to remember to take.
  lock table public.event_attachments, public.event_attendees in share mode;

  select count(*) into attachment_count
  from public.event_attachments attachment
  where attachment.owner_id = account_id;

  if attachment_count > 0 then
    raise exception 'Account still has % attachment(s); import would orphan them',
      attachment_count
      using errcode = '23503';
  end if;

  -- Attendees are not in the portable payload either, and the event cascade
  -- would delete them without any backup carrying them. Refuse for the same
  -- reason as attachments until the contract covers them.
  select count(*) into attendee_count
  from public.event_attendees attendee
  where attendee.owner_id = account_id;

  if attendee_count > 0 then
    raise exception 'Account still has % attendee row(s); import would delete them',
      attendee_count
      using errcode = '23503';
  end if;

  -- Children before parents so foreign keys stay satisfied inside the
  -- transaction.
  delete from public.stickers where owner_id = account_id;
  delete from public.todos where owner_id = account_id;
  delete from public.event_exceptions where owner_id = account_id;
  delete from public.events where owner_id = account_id;
  delete from public.calendars where owner_id = account_id;

  insert into public.calendars (
    id, owner_id, name, color, is_visible, is_default, sort_order
  )
  select id, account_id, name, color, is_visible, is_default, sort_order
  from pg_catalog.jsonb_to_recordset(p_payload -> 'calendars') as imported(
    id uuid,
    name text,
    color text,
    is_visible boolean,
    is_default boolean,
    sort_order integer
  );

  insert into public.events (
    id, owner_id, calendar_id, title, is_all_day, start_date, end_date,
    starts_at, ends_at, timezone, location, notes, reminder_minutes,
    recurrence_rule, sharing_scope
  )
  select
    id, account_id, calendar_id, title, is_all_day, start_date, end_date,
    starts_at, ends_at, timezone, location, notes, reminder_minutes,
    recurrence_rule, sharing_scope
  from pg_catalog.jsonb_to_recordset(p_payload -> 'events') as imported(
    id uuid,
    calendar_id uuid,
    title text,
    is_all_day boolean,
    start_date date,
    end_date date,
    starts_at timestamptz,
    ends_at timestamptz,
    timezone text,
    location text,
    notes text,
    reminder_minutes integer[],
    recurrence_rule text,
    sharing_scope text
  );

  insert into public.event_exceptions (
    id, owner_id, event_id, occurrence_date, occurrence_starts_at,
    is_cancelled, replacement_event_id
  )
  select
    id, account_id, event_id, occurrence_date, occurrence_starts_at,
    is_cancelled, replacement_event_id
  from pg_catalog.jsonb_to_recordset(p_payload -> 'event_exceptions') as imported(
    id uuid,
    event_id uuid,
    occurrence_date date,
    occurrence_starts_at timestamptz,
    is_cancelled boolean,
    replacement_event_id uuid
  );

  -- Parents first, so a subtask never references a row that is not in yet.
  insert into public.todos (
    id, owner_id, calendar_id, parent_id, title, due_date, priority,
    completed_at, sort_order, sharing_scope
  )
  select
    id, account_id, calendar_id, parent_id, title, due_date, priority,
    completed_at, sort_order, sharing_scope
  from pg_catalog.jsonb_to_recordset(p_payload -> 'todos') as imported(
    id uuid,
    calendar_id uuid,
    parent_id uuid,
    title text,
    due_date date,
    priority text,
    completed_at timestamptz,
    sort_order integer,
    sharing_scope text
  )
  where parent_id is null;

  insert into public.todos (
    id, owner_id, calendar_id, parent_id, title, due_date, priority,
    completed_at, sort_order, sharing_scope
  )
  select
    id, account_id, calendar_id, parent_id, title, due_date, priority,
    completed_at, sort_order, sharing_scope
  from pg_catalog.jsonb_to_recordset(p_payload -> 'todos') as imported(
    id uuid,
    calendar_id uuid,
    parent_id uuid,
    title text,
    due_date date,
    priority text,
    completed_at timestamptz,
    sort_order integer,
    sharing_scope text
  )
  where parent_id is not null;

  insert into public.stickers (
    id, owner_id, calendar_id, sticker_date, glyph, asset_key, sort_order
  )
  select id, account_id, calendar_id, sticker_date, glyph, asset_key, sort_order
  from pg_catalog.jsonb_to_recordset(p_payload -> 'stickers') as imported(
    id uuid,
    calendar_id uuid,
    sticker_date date,
    glyph text,
    asset_key text,
    sort_order integer
  );

  -- Assigned outright, never coalesced against the current row: this is a
  -- restore, so `default_reminder_minutes: []` has to clear the list rather
  -- than quietly keep whatever was there before.
  update public.user_preferences
  set
    timezone = p_payload -> 'preferences' ->> 'timezone',
    week_starts_on = (p_payload -> 'preferences' ->> 'week_starts_on')::integer,
    theme = p_payload -> 'preferences' ->> 'theme',
    theme_id = p_payload -> 'preferences' ->> 'theme_id',
    fixed_six_week_grid = (p_payload -> 'preferences' ->> 'fixed_six_week_grid')::boolean,
    default_reminder_minutes = coalesce(
      (
        select pg_catalog.array_agg(minutes.value::integer)
        from pg_catalog.jsonb_array_elements_text(
          p_payload -> 'preferences' -> 'default_reminder_minutes'
        ) as minutes(value)
      ),
      array[]::integer[]
    ),
    pet_name = p_payload -> 'preferences' ->> 'pet_name',
    pet_enabled = (p_payload -> 'preferences' ->> 'pet_enabled')::boolean
  where user_id = account_id;

  if not found then
    raise exception 'DayPop preferences row is missing'
      using errcode = '23503';
  end if;
end;
$$;

create or replace function public.append_daypop_ics(
  p_payload jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
begin
  if account_id is null then
    raise exception 'Authentication is required for import'
      using errcode = '42501';
  end if;
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Import payload must be an object'
      using errcode = '22023';
  end if;

  -- An .ics append may only add events and their exceptions. Calendars, todos,
  -- stickers and preferences are not in scope, so their presence is an error
  -- rather than something silently ignored.
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_payload) as payload_key(key)
    where key not in ('events', 'event_exceptions')
  ) then
    raise exception 'ICS append payload has unsupported top-level fields'
      using errcode = '22023';
  end if;

  if not coalesce(
    pg_catalog.jsonb_typeof(p_payload -> 'events') = 'array'
      and pg_catalog.jsonb_typeof(p_payload -> 'event_exceptions') = 'array',
    false
  ) then
    raise exception 'ICS append is missing a required collection or has an invalid shape'
      using errcode = '22023';
  end if;

  if pg_catalog.jsonb_array_length(p_payload -> 'events') > 10000
    or pg_catalog.jsonb_array_length(p_payload -> 'event_exceptions') > 50000
  then
    raise exception 'ICS append exceeds the allowed row count'
      using errcode = '54000';
  end if;

  if exists (
    select 1
    from (
      values
        (
          'events',
          array[
            'id', 'calendar_id', 'title', 'is_all_day', 'start_date', 'end_date',
            'starts_at', 'ends_at', 'timezone', 'location', 'notes',
            'reminder_minutes', 'recurrence_rule', 'sharing_scope'
          ]::text[]
        ),
        (
          'event_exceptions',
          array[
            'id', 'event_id', 'occurrence_date', 'occurrence_starts_at',
            'is_cancelled', 'replacement_event_id'
          ]::text[]
        )
    ) as collection(name, allowed_keys)
    cross join lateral pg_catalog.jsonb_array_elements(
      p_payload -> collection.name
    ) as element(value)
    where case
      when pg_catalog.jsonb_typeof(element.value) <> 'object' then true
      else exists (
        select 1
        from pg_catalog.jsonb_object_keys(element.value) as object_key(key)
        where not (object_key.key = any (collection.allowed_keys))
      )
    end
  ) then
    raise exception 'ICS append payload contains unsupported or sensitive fields'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from (
      values
        (
          'events',
          array['id', 'calendar_id', 'title', 'is_all_day', 'start_date', 'end_date', 'starts_at', 'ends_at', 'timezone', 'location', 'notes', 'reminder_minutes', 'recurrence_rule', 'sharing_scope']::text[]
        ),
        (
          'event_exceptions',
          array['id', 'event_id', 'occurrence_date', 'occurrence_starts_at', 'is_cancelled', 'replacement_event_id']::text[]
        )
    ) as collection(name, required_keys)
    cross join lateral pg_catalog.jsonb_array_elements(
      p_payload -> collection.name
    ) as element(value)
    where pg_catalog.jsonb_typeof(element.value) <> 'object'
      or not (
        select coalesce(pg_catalog.array_agg(object_key.key), array[]::text[])
        from pg_catalog.jsonb_object_keys(element.value) as object_key(key)
      ) @> collection.required_keys
  ) then
    raise exception 'ICS append row is missing a required field'
      using errcode = '23502';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_payload -> 'events') as element(value)
    where case
      when pg_catalog.jsonb_typeof(element.value -> 'is_all_day') <> 'boolean' then true
      when (element.value ->> 'is_all_day')::boolean then
        -- All-day: dates carry the occurrence, the instant columns must be null.
        pg_catalog.jsonb_typeof(element.value -> 'start_date') <> 'string'
        or pg_catalog.jsonb_typeof(element.value -> 'end_date') <> 'string'
        or pg_catalog.jsonb_typeof(element.value -> 'starts_at') <> 'null'
        or pg_catalog.jsonb_typeof(element.value -> 'ends_at') <> 'null'
        or pg_catalog.jsonb_typeof(element.value -> 'timezone') <> 'null'
      else
        -- Timed: instants plus a timezone, and no date columns.
        pg_catalog.jsonb_typeof(element.value -> 'starts_at') <> 'string'
        or pg_catalog.jsonb_typeof(element.value -> 'ends_at') <> 'string'
        or pg_catalog.jsonb_typeof(element.value -> 'timezone') <> 'string'
        or pg_catalog.jsonb_typeof(element.value -> 'start_date') <> 'null'
        or pg_catalog.jsonb_typeof(element.value -> 'end_date') <> 'null'
    end
  ) then
    raise exception 'Event rows must match the all-day or timed shape'
      using errcode = '22023';
  end if;

  -- The calendar must already belong to this account. RLS would reject a
  -- foreign one anyway, but failing here says why.
  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_payload -> 'events') as imported(calendar_id uuid)
    where not exists (
      select 1
      from public.calendars calendar
      where calendar.id = imported.calendar_id
        and calendar.owner_id = account_id
    )
  ) then
    raise exception 'ICS append references a calendar this account does not own'
      using errcode = '23503';
  end if;

  insert into public.events (
    id, owner_id, calendar_id, title, is_all_day, start_date, end_date,
    starts_at, ends_at, timezone, location, notes, reminder_minutes,
    recurrence_rule, sharing_scope
  )
  select
    id, account_id, calendar_id, title, is_all_day, start_date, end_date,
    starts_at, ends_at, timezone, location, notes, reminder_minutes,
    recurrence_rule, sharing_scope
  from pg_catalog.jsonb_to_recordset(p_payload -> 'events') as imported(
    id uuid,
    calendar_id uuid,
    title text,
    is_all_day boolean,
    start_date date,
    end_date date,
    starts_at timestamptz,
    ends_at timestamptz,
    timezone text,
    location text,
    notes text,
    reminder_minutes integer[],
    recurrence_rule text,
    sharing_scope text
  );

  insert into public.event_exceptions (
    id, owner_id, event_id, occurrence_date, occurrence_starts_at,
    is_cancelled, replacement_event_id
  )
  select
    id, account_id, event_id, occurrence_date, occurrence_starts_at,
    is_cancelled, replacement_event_id
  from pg_catalog.jsonb_to_recordset(p_payload -> 'event_exceptions') as imported(
    id uuid,
    event_id uuid,
    occurrence_date date,
    occurrence_starts_at timestamptz,
    is_cancelled boolean,
    replacement_event_id uuid
  );
end;
$$;

revoke all on function public.replace_daypop_data(jsonb) from public;
revoke all on function public.replace_daypop_data(jsonb) from anon;
grant execute on function public.replace_daypop_data(jsonb) to authenticated;

revoke all on function public.append_daypop_ics(jsonb) from public;
revoke all on function public.append_daypop_ics(jsonb) from anon;
grant execute on function public.append_daypop_ics(jsonb) to authenticated;
