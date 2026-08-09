-- DP-025: one-time, owner-scoped import of the original calpet.v2 document.
-- The browser converts and validates legacy values first; this RPC repeats the
-- trust-boundary checks and commits all rows plus the completion marker as one
-- transaction. The original localStorage bytes are never changed here.

alter table public.profiles
add column legacy_imported_at timestamptz,
add column legacy_import_fingerprint text,
add constraint profiles_legacy_import_marker_coherent check (
  (legacy_imported_at is null and legacy_import_fingerprint is null)
  or
  (legacy_imported_at is not null and legacy_import_fingerprint is not null)
),
add constraint profiles_legacy_import_fingerprint_format check (
  legacy_import_fingerprint is null
  or legacy_import_fingerprint ~ '^[0-9a-f]{64}$'
);

-- Completion markers are controlled only by the import RPC. Profile owners
-- retain the editable columns they had before this migration.
revoke insert, update on table public.profiles from authenticated;
grant insert (id, display_name, avatar_path) on table public.profiles to authenticated;
grant update (display_name, avatar_path) on table public.profiles to authenticated;

create function daypop_private.jsonb_array_has_unknown_keys(
  items jsonb,
  allowed_keys text[]
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(items) as element(value)
    where pg_catalog.jsonb_typeof(value) <> 'object'
      or exists (
        select 1
        from pg_catalog.jsonb_object_keys(value) as object_key(key)
        where not (key = any (allowed_keys))
      )
  );
$$;

revoke all on function daypop_private.jsonb_array_has_unknown_keys(jsonb, text[])
from public, anon, authenticated, service_role;

create function public.import_legacy_daypop(
  p_fingerprint text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  previous_fingerprint text;
  previous_imported_at timestamptz;
  completed_at timestamptz;
begin
  if account_id is null then
    raise exception 'Authentication is required for legacy import'
      using errcode = '42501';
  end if;
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Legacy import fingerprint is invalid'
      using errcode = '22023';
  end if;
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Legacy import payload must be an object'
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
    raise exception 'Legacy import payload has unsupported top-level fields'
      using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_payload -> 'calendars') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload -> 'events') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload -> 'event_exceptions') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload -> 'todos') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload -> 'stickers') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload -> 'preferences') <> 'object'
  then
    raise exception 'Legacy import collections have invalid shapes'
      using errcode = '22023';
  end if;

  if pg_catalog.jsonb_array_length(p_payload -> 'calendars') > 100
    or pg_catalog.jsonb_array_length(p_payload -> 'events') > 10000
    or pg_catalog.jsonb_array_length(p_payload -> 'event_exceptions') > 50000
    or pg_catalog.jsonb_array_length(p_payload -> 'todos') > 20000
    or pg_catalog.jsonb_array_length(p_payload -> 'stickers') > 10000
  then
    raise exception 'Legacy import exceeds the allowed row count'
      using errcode = '54000';
  end if;

  if daypop_private.jsonb_array_has_unknown_keys(
    p_payload -> 'calendars',
    array['id', 'name', 'color', 'is_visible', 'sort_order']
  ) or daypop_private.jsonb_array_has_unknown_keys(
    p_payload -> 'events',
    array[
      'id', 'calendar_id', 'title', 'is_all_day', 'start_date', 'end_date',
      'starts_at', 'ends_at', 'timezone', 'location', 'notes',
      'reminder_minutes', 'recurrence_rule'
    ]
  ) or daypop_private.jsonb_array_has_unknown_keys(
    p_payload -> 'event_exceptions',
    array['id', 'event_id', 'occurrence_date', 'occurrence_starts_at']
  ) or daypop_private.jsonb_array_has_unknown_keys(
    p_payload -> 'todos',
    array[
      'id', 'calendar_id', 'parent_id', 'title', 'due_date', 'priority',
      'completed_at', 'sort_order'
    ]
  ) or daypop_private.jsonb_array_has_unknown_keys(
    p_payload -> 'stickers',
    array['id', 'calendar_id', 'sticker_date', 'glyph', 'sort_order']
  ) or exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_payload -> 'preferences') as preference_key(key)
    where key not in (
      'timezone', 'week_starts_on', 'theme', 'theme_id',
      'fixed_six_week_grid', 'default_reminder_minutes', 'pet_name', 'pet_enabled'
    )
  ) then
    raise exception 'Legacy import payload contains unsupported or sensitive fields'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_payload -> 'events') as event(value)
    where value ->> 'recurrence_rule' is not null
      and value ->> 'recurrence_rule' not in (
        'FREQ=DAILY',
        'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
        'FREQ=WEEKLY',
        'FREQ=MONTHLY',
        'FREQ=YEARLY'
      )
  ) then
    raise exception 'Legacy import contains an unsupported recurrence rule'
      using errcode = '22023';
  end if;

  -- One account lock is acquired before any insert and held only for this RPC.
  select legacy_import_fingerprint, legacy_imported_at
  into previous_fingerprint, previous_imported_at
  from public.profiles
  where id = account_id
  for update;

  if not found then
    raise exception 'DayPop profile is missing'
      using errcode = '23503';
  end if;
  if previous_fingerprint = p_fingerprint then
    return pg_catalog.jsonb_build_object(
      'status', 'already_imported',
      'imported_at', previous_imported_at
    );
  end if;
  if previous_fingerprint is not null then
    raise exception 'Legacy import has already completed for this account'
      using errcode = '23505';
  end if;

  insert into public.calendars (
    id, owner_id, name, color, is_visible, is_default, sort_order
  )
  select id, account_id, name, color, is_visible, false, sort_order
  from pg_catalog.jsonb_to_recordset(p_payload -> 'calendars') as imported(
    id uuid,
    name text,
    color text,
    is_visible boolean,
    sort_order integer
  );

  insert into public.events (
    id,
    owner_id,
    calendar_id,
    title,
    is_all_day,
    start_date,
    end_date,
    starts_at,
    ends_at,
    timezone,
    location,
    notes,
    reminder_minutes,
    recurrence_rule,
    sharing_scope
  )
  select
    id,
    account_id,
    calendar_id,
    title,
    is_all_day,
    start_date,
    end_date,
    starts_at,
    ends_at,
    timezone,
    location,
    notes,
    reminder_minutes,
    recurrence_rule,
    'inherit'
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
    recurrence_rule text
  );

  insert into public.event_exceptions (
    id,
    owner_id,
    event_id,
    occurrence_date,
    occurrence_starts_at,
    is_cancelled,
    replacement_event_id
  )
  select
    id,
    account_id,
    event_id,
    occurrence_date,
    occurrence_starts_at,
    true,
    null
  from pg_catalog.jsonb_to_recordset(p_payload -> 'event_exceptions') as imported(
    id uuid,
    event_id uuid,
    occurrence_date date,
    occurrence_starts_at timestamptz
  );

  -- Parent rows always precede their children so the self-referencing FK stays immediate.
  insert into public.todos (
    id,
    owner_id,
    calendar_id,
    parent_id,
    title,
    due_date,
    priority,
    completed_at,
    sort_order,
    sharing_scope
  )
  select
    id,
    account_id,
    calendar_id,
    parent_id,
    title,
    due_date,
    priority,
    completed_at,
    sort_order,
    'inherit'
  from pg_catalog.jsonb_to_recordset(p_payload -> 'todos') as imported(
    id uuid,
    calendar_id uuid,
    parent_id uuid,
    title text,
    due_date date,
    priority text,
    completed_at timestamptz,
    sort_order integer
  )
  where parent_id is null;

  insert into public.todos (
    id,
    owner_id,
    calendar_id,
    parent_id,
    title,
    due_date,
    priority,
    completed_at,
    sort_order,
    sharing_scope
  )
  select
    id,
    account_id,
    calendar_id,
    parent_id,
    title,
    due_date,
    priority,
    completed_at,
    sort_order,
    'inherit'
  from pg_catalog.jsonb_to_recordset(p_payload -> 'todos') as imported(
    id uuid,
    calendar_id uuid,
    parent_id uuid,
    title text,
    due_date date,
    priority text,
    completed_at timestamptz,
    sort_order integer
  )
  where parent_id is not null;

  insert into public.stickers (
    id, owner_id, calendar_id, sticker_date, glyph, asset_key, sort_order
  )
  select id, account_id, calendar_id, sticker_date, glyph, null, sort_order
  from pg_catalog.jsonb_to_recordset(p_payload -> 'stickers') as imported(
    id uuid,
    calendar_id uuid,
    sticker_date date,
    glyph text,
    sort_order integer
  );

  update public.user_preferences
  set
    timezone = imported.timezone,
    week_starts_on = imported.week_starts_on,
    theme = imported.theme,
    theme_id = imported.theme_id,
    fixed_six_week_grid = imported.fixed_six_week_grid,
    default_reminder_minutes = imported.default_reminder_minutes,
    pet_name = imported.pet_name,
    pet_enabled = imported.pet_enabled
  from pg_catalog.jsonb_to_record(p_payload -> 'preferences') as imported(
    timezone text,
    week_starts_on smallint,
    theme text,
    theme_id text,
    fixed_six_week_grid boolean,
    default_reminder_minutes integer[],
    pet_name text,
    pet_enabled boolean
  )
  where user_id = account_id;

  if not found then
    raise exception 'DayPop preferences are missing'
      using errcode = '23503';
  end if;

  completed_at := statement_timestamp();
  update public.profiles
  set
    legacy_import_fingerprint = p_fingerprint,
    legacy_imported_at = completed_at
  where id = account_id;

  return pg_catalog.jsonb_build_object(
    'status', 'imported',
    'imported_at', completed_at
  );
end;
$$;

revoke all on function public.import_legacy_daypop(text, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.import_legacy_daypop(text, jsonb) to authenticated;

comment on function public.import_legacy_daypop(text, jsonb) is
  'Atomically imports one validated calpet.v2 payload for auth.uid(); retries with the same SHA-256 are idempotent.';
