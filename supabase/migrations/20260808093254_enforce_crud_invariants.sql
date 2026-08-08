-- DP-036: keep reminder payloads bounded before authenticated CRUD is wired
-- into the App. The seven-day ceiling matches the canonical prototype's
-- custom reminder clamp; ten entries leaves room for multiple reminders
-- without allowing an unbounded array through the Data API.
alter table public.user_preferences
  add constraint user_preferences_default_reminders_bounded check (
    cardinality(default_reminder_minutes) <= 10
    and array_position(default_reminder_minutes, null) is null
    and 0 <= all (default_reminder_minutes)
    and 10080 >= all (default_reminder_minutes)
  );

alter table public.events
  add constraint events_reminders_bounded check (
    cardinality(reminder_minutes) <= 10
    and array_position(reminder_minutes, null) is null
    and 0 <= all (reminder_minutes)
    and 10080 >= all (reminder_minutes)
  );

-- This function name is retained because all existing UPDATE triggers already
-- call it. INSERT triggers added below make both timestamps server-owned;
-- UPDATE keeps created_at immutable and advances updated_at.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at = statement_timestamp();
  else
    new.created_at = old.created_at;
  end if;
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

create trigger profiles_set_server_timestamps_on_insert
before insert on public.profiles
for each row execute function public.set_updated_at();

create trigger user_preferences_set_server_timestamps_on_insert
before insert on public.user_preferences
for each row execute function public.set_updated_at();

create trigger calendars_set_server_timestamps_on_insert
before insert on public.calendars
for each row execute function public.set_updated_at();

create trigger events_set_server_timestamps_on_insert
before insert on public.events
for each row execute function public.set_updated_at();

create trigger event_exceptions_set_server_timestamps_on_insert
before insert on public.event_exceptions
for each row execute function public.set_updated_at();

create trigger event_attendees_set_server_timestamps_on_insert
before insert on public.event_attendees
for each row execute function public.set_updated_at();

create trigger event_attachments_set_server_timestamps_on_insert
before insert on public.event_attachments
for each row execute function public.set_updated_at();

create trigger todos_set_server_timestamps_on_insert
before insert on public.todos
for each row execute function public.set_updated_at();

create trigger stickers_set_server_timestamps_on_insert
before insert on public.stickers
for each row execute function public.set_updated_at();
