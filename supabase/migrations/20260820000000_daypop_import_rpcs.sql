-- DP-056: atomic import for a signed-in account.
--
-- The client cannot do this with row-level writes: a JSON restore replaces rows
-- across five tables and an .ics import appends across two, and anything that
-- fails part-way leaves the account half-imported. Both operations therefore
-- live in one function each, so the whole thing commits or none of it does.
--
-- Shape and guards deliberately mirror `import_legacy_daypop`: the same row
-- limits, `security invoker` with an empty `search_path`, and an
-- `authenticated`-only grant. The owner is always `auth.uid()`; an `owner_id`
-- in the payload is neither read nor trusted.
--
-- The per-collection key allowlist is written out in each function body rather
-- than shared. `daypop_private.jsonb_array_has_unknown_keys` was dropped when
-- the legacy RPC moved to `security invoker`, because a function running as the
-- caller cannot execute a helper in a schema the caller has no rights to.
--
-- Neither function touches `profiles`, the legacy import marker, Auth identity,
-- `event_attachments` or `attachment_cleanup_jobs`.

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

  if pg_catalog.jsonb_typeof(p_payload -> 'calendars') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload -> 'events') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload -> 'event_exceptions') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload -> 'todos') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload -> 'stickers') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload -> 'preferences') <> 'object'
  then
    raise exception 'Import collections have invalid shapes'
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
  ) or exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_payload -> 'preferences') as preference_key(key)
    where key not in (
      'timezone', 'week_starts_on', 'theme', 'theme_id',
      'fixed_six_week_grid', 'default_reminder_minutes', 'pet_name', 'pet_enabled'
    )
  ) then
    raise exception 'Import payload contains unsupported or sensitive fields'
      using errcode = '22023';
  end if;

  -- Re-checked here rather than trusting the screen's snapshot: a backup file
  -- carries no attachments, so replacing the document would either strand the
  -- metadata rows or destroy files in private Storage. Refuse instead.
  select count(*) into attachment_count
  from public.event_attachments attachment
  where attachment.owner_id = account_id;

  if attachment_count > 0 then
    raise exception 'Account still has % attachment(s); import would orphan them',
      attachment_count
      using errcode = '23503';
  end if;

  -- Children before parents so foreign keys stay satisfied inside the
  -- transaction. Only this owner's portable rows; attachments and their cleanup
  -- jobs are never in scope, and the count check above guarantees there are
  -- none to consider.
  delete from public.stickers where owner_id = account_id;
  delete from public.todos where owner_id = account_id;
  delete from public.event_exceptions where owner_id = account_id;
  delete from public.events where owner_id = account_id;
  delete from public.calendars where owner_id = account_id;

  insert into public.calendars (
    id, owner_id, name, color, is_visible, is_default, sort_order
  )
  select id, account_id, name, color, is_visible, coalesce(is_default, false), sort_order
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
    recurrence_rule, coalesce(sharing_scope, 'inherit')
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
    completed_at, sort_order, coalesce(sharing_scope, 'inherit')
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
    completed_at, sort_order, coalesce(sharing_scope, 'inherit')
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

  update public.user_preferences
  set
    timezone = coalesce(p_payload -> 'preferences' ->> 'timezone', timezone),
    week_starts_on = coalesce(
      (p_payload -> 'preferences' ->> 'week_starts_on')::integer, week_starts_on
    ),
    theme = coalesce(p_payload -> 'preferences' ->> 'theme', theme),
    theme_id = coalesce(p_payload -> 'preferences' ->> 'theme_id', theme_id),
    fixed_six_week_grid = coalesce(
      (p_payload -> 'preferences' ->> 'fixed_six_week_grid')::boolean, fixed_six_week_grid
    ),
    default_reminder_minutes = coalesce(
      (
        select pg_catalog.array_agg(minutes.value::integer)
        from pg_catalog.jsonb_array_elements_text(
          p_payload -> 'preferences' -> 'default_reminder_minutes'
        ) as minutes(value)
      ),
      default_reminder_minutes
    ),
    pet_name = coalesce(p_payload -> 'preferences' ->> 'pet_name', pet_name),
    pet_enabled = coalesce(
      (p_payload -> 'preferences' ->> 'pet_enabled')::boolean, pet_enabled
    )
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

  if pg_catalog.jsonb_typeof(p_payload -> 'events') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload -> 'event_exceptions') <> 'array'
  then
    raise exception 'ICS append collections have invalid shapes'
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
  )
  ) then
    raise exception 'ICS append payload contains unsupported or sensitive fields'
      using errcode = '22023';
  end if;

  -- The calendar must already belong to this account. RLS would reject a
  -- foreign one anyway, but failing here says why.
  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_payload -> 'events') as imported(calendar_id uuid)
    where imported.calendar_id is null
      or not exists (
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
    recurrence_rule, coalesce(sharing_scope, 'inherit')
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
