-- DayPop core owner-scoped data model.
-- Family sharing is intentionally deferred; sharing_scope preserves the per-item
-- privacy requirement without granting any cross-user access in this migration.

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length
    check (display_name is null or char_length(btrim(display_name)) between 1 and 80),
  constraint profiles_avatar_path_length
    check (avatar_path is null or char_length(avatar_path) between 1 and 500)
);

create table public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  timezone text not null default 'Asia/Taipei',
  week_starts_on smallint not null default 0,
  month_weeks smallint not null default 6,
  theme text not null default 'system',
  default_reminder_minutes integer[] not null default '{}',
  pet_name text not null default '摩卡',
  pet_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_preferences_timezone_not_blank check (btrim(timezone) <> ''),
  constraint user_preferences_week_starts_on check (week_starts_on in (0, 1)),
  constraint user_preferences_month_weeks check (month_weeks between 4 and 6),
  constraint user_preferences_theme check (theme in ('system', 'light', 'dark')),
  constraint user_preferences_pet_name_length check (char_length(btrim(pet_name)) between 1 and 40)
);

create table public.calendars (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  color text not null default '#F06C5C',
  is_visible boolean not null default true,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendars_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint calendars_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint calendars_sort_order_nonnegative check (sort_order >= 0),
  constraint calendars_id_owner_unique unique (id, owner_id)
);

create unique index calendars_one_default_per_owner_idx
  on public.calendars (owner_id)
  where is_default;

create index calendars_owner_sort_idx
  on public.calendars (owner_id, sort_order, created_at);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  calendar_id uuid not null,
  title text not null,
  is_all_day boolean not null default false,
  start_date date,
  end_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  location text,
  notes text,
  reminder_minutes integer[] not null default '{}',
  recurrence_rule text,
  sharing_scope text not null default 'inherit',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_calendar_owner_fk
    foreign key (calendar_id, owner_id)
    references public.calendars (id, owner_id)
    on delete restrict,
  constraint events_id_owner_unique unique (id, owner_id),
  constraint events_title_length check (char_length(btrim(title)) between 1 and 300),
  constraint events_location_length check (location is null or char_length(location) <= 500),
  constraint events_recurrence_rule_not_blank
    check (recurrence_rule is null or btrim(recurrence_rule) <> ''),
  constraint events_sharing_scope check (sharing_scope in ('inherit', 'private')),
  constraint events_time_shape check (
    (
      is_all_day
      and start_date is not null
      and end_date is not null
      and end_date >= start_date
      and starts_at is null
      and ends_at is null
      and timezone is null
    )
    or
    (
      not is_all_day
      and start_date is null
      and end_date is null
      and starts_at is not null
      and ends_at is not null
      and ends_at > starts_at
      and timezone is not null
      and btrim(timezone) <> ''
    )
  )
);

create index events_owner_calendar_idx
  on public.events (owner_id, calendar_id);

create index events_owner_starts_at_idx
  on public.events (owner_id, starts_at)
  where not is_all_day;

create index events_owner_start_date_idx
  on public.events (owner_id, start_date)
  where is_all_day;

create table public.event_exceptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null,
  occurrence_date date,
  occurrence_starts_at timestamptz,
  is_cancelled boolean not null default true,
  replacement_event_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_exceptions_event_owner_fk
    foreign key (event_id, owner_id)
    references public.events (id, owner_id)
    on delete cascade,
  constraint event_exceptions_replacement_owner_fk
    foreign key (replacement_event_id, owner_id)
    references public.events (id, owner_id)
    on delete cascade,
  constraint event_exceptions_occurrence_shape check (
    (occurrence_date is not null and occurrence_starts_at is null)
    or (occurrence_date is null and occurrence_starts_at is not null)
  ),
  constraint event_exceptions_replacement_shape check (
    (is_cancelled and replacement_event_id is null)
    or (not is_cancelled and replacement_event_id is not null)
  ),
  constraint event_exceptions_not_self_replacement
    check (replacement_event_id is null or replacement_event_id <> event_id)
);

create unique index event_exceptions_event_date_unique_idx
  on public.event_exceptions (event_id, occurrence_date)
  where occurrence_date is not null;

create unique index event_exceptions_event_time_unique_idx
  on public.event_exceptions (event_id, occurrence_starts_at)
  where occurrence_starts_at is not null;

create index event_exceptions_owner_event_idx
  on public.event_exceptions (owner_id, event_id);

create index event_exceptions_owner_replacement_idx
  on public.event_exceptions (owner_id, replacement_event_id)
  where replacement_event_id is not null;

create table public.event_attendees (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null,
  name text,
  email text,
  response_status text not null default 'needs_action',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_attendees_event_owner_fk
    foreign key (event_id, owner_id)
    references public.events (id, owner_id)
    on delete cascade,
  constraint event_attendees_identity_present
    check (
      (name is not null and btrim(name) <> '')
      or (email is not null and btrim(email) <> '')
    ),
  constraint event_attendees_response_status
    check (response_status in ('needs_action', 'accepted', 'declined', 'tentative'))
);

create index event_attendees_owner_event_idx
  on public.event_attendees (owner_id, event_id);

create table public.event_attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null,
  object_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_attachments_event_owner_fk
    foreign key (event_id, owner_id)
    references public.events (id, owner_id)
    on delete cascade,
  constraint event_attachments_object_path_unique unique (object_path),
  constraint event_attachments_object_path_not_blank check (btrim(object_path) <> ''),
  constraint event_attachments_file_name_length check (char_length(btrim(file_name)) between 1 and 255),
  constraint event_attachments_mime_type_not_blank check (btrim(mime_type) <> ''),
  constraint event_attachments_size_nonnegative check (size_bytes >= 0)
);

create index event_attachments_owner_event_idx
  on public.event_attachments (owner_id, event_id);

create table public.todos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  calendar_id uuid not null,
  parent_id uuid,
  title text not null,
  due_date date,
  priority text not null default 'none',
  completed_at timestamptz,
  sort_order integer not null default 0,
  sharing_scope text not null default 'inherit',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint todos_calendar_owner_fk
    foreign key (calendar_id, owner_id)
    references public.calendars (id, owner_id)
    on delete restrict,
  constraint todos_id_owner_calendar_unique unique (id, owner_id, calendar_id),
  constraint todos_parent_owner_calendar_fk
    foreign key (parent_id, owner_id, calendar_id)
    references public.todos (id, owner_id, calendar_id)
    on delete cascade,
  constraint todos_not_self_parent check (parent_id is null or parent_id <> id),
  constraint todos_title_length check (char_length(btrim(title)) between 1 and 300),
  constraint todos_priority check (priority in ('none', 'low', 'medium', 'high')),
  constraint todos_sort_order_nonnegative check (sort_order >= 0),
  constraint todos_sharing_scope check (sharing_scope in ('inherit', 'private'))
);

create index todos_owner_calendar_sort_idx
  on public.todos (owner_id, calendar_id, sort_order, created_at);

create index todos_owner_due_date_idx
  on public.todos (owner_id, due_date)
  where due_date is not null;

create index todos_owner_parent_idx
  on public.todos (owner_id, parent_id)
  where parent_id is not null;

create table public.stickers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  calendar_id uuid not null,
  sticker_date date not null,
  glyph text,
  asset_key text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stickers_calendar_owner_fk
    foreign key (calendar_id, owner_id)
    references public.calendars (id, owner_id)
    on delete restrict,
  constraint stickers_content_present check (
    (glyph is not null and btrim(glyph) <> '')
    or (asset_key is not null and btrim(asset_key) <> '')
  ),
  constraint stickers_sort_order_nonnegative check (sort_order >= 0)
);

create index stickers_owner_date_sort_idx
  on public.stickers (owner_id, sticker_date, sort_order);

create index stickers_owner_calendar_idx
  on public.stickers (owner_id, calendar_id);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger user_preferences_set_updated_at
before update on public.user_preferences
for each row execute function public.set_updated_at();

create trigger calendars_set_updated_at
before update on public.calendars
for each row execute function public.set_updated_at();

create trigger events_set_updated_at
before update on public.events
for each row execute function public.set_updated_at();

create trigger event_exceptions_set_updated_at
before update on public.event_exceptions
for each row execute function public.set_updated_at();

create trigger event_attendees_set_updated_at
before update on public.event_attendees
for each row execute function public.set_updated_at();

create trigger event_attachments_set_updated_at
before update on public.event_attachments
for each row execute function public.set_updated_at();

create trigger todos_set_updated_at
before update on public.todos
for each row execute function public.set_updated_at();

create trigger stickers_set_updated_at
before update on public.stickers
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.calendars enable row level security;
alter table public.events enable row level security;
alter table public.event_exceptions enable row level security;
alter table public.event_attendees enable row level security;
alter table public.event_attachments enable row level security;
alter table public.todos enable row level security;
alter table public.stickers enable row level security;
