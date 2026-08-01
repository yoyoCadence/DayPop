-- DayPop private MVP access policy.
-- No anon role receives table privileges. Every authenticated write must keep
-- the row owned by auth.uid(); composite foreign keys enforce child ownership.

revoke all on table public.profiles from anon;
revoke all on table public.user_preferences from anon;
revoke all on table public.calendars from anon;
revoke all on table public.events from anon;
revoke all on table public.event_exceptions from anon;
revoke all on table public.event_attendees from anon;
revoke all on table public.event_attachments from anon;
revoke all on table public.todos from anon;
revoke all on table public.stickers from anon;

grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.user_preferences to authenticated;
grant select, insert, update, delete on table public.calendars to authenticated;
grant select, insert, update, delete on table public.events to authenticated;
grant select, insert, update, delete on table public.event_exceptions to authenticated;
grant select, insert, update, delete on table public.event_attendees to authenticated;
grant select, insert, update, delete on table public.event_attachments to authenticated;
grant select, insert, update, delete on table public.todos to authenticated;
grant select, insert, update, delete on table public.stickers to authenticated;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

create policy profiles_select_own
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

create policy profiles_update_own
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy profiles_delete_own
on public.profiles
for delete
to authenticated
using ((select auth.uid()) = id);

create policy user_preferences_select_own
on public.user_preferences
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy user_preferences_insert_own
on public.user_preferences
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy user_preferences_update_own
on public.user_preferences
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy user_preferences_delete_own
on public.user_preferences
for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy calendars_select_own
on public.calendars
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy calendars_insert_own
on public.calendars
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy calendars_update_own
on public.calendars
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy calendars_delete_own
on public.calendars
for delete
to authenticated
using ((select auth.uid()) = owner_id);

create policy events_select_own
on public.events
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy events_insert_own
on public.events
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy events_update_own
on public.events
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy events_delete_own
on public.events
for delete
to authenticated
using ((select auth.uid()) = owner_id);

create policy event_exceptions_select_own
on public.event_exceptions
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy event_exceptions_insert_own
on public.event_exceptions
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy event_exceptions_update_own
on public.event_exceptions
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy event_exceptions_delete_own
on public.event_exceptions
for delete
to authenticated
using ((select auth.uid()) = owner_id);

create policy event_attendees_select_own
on public.event_attendees
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy event_attendees_insert_own
on public.event_attendees
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy event_attendees_update_own
on public.event_attendees
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy event_attendees_delete_own
on public.event_attendees
for delete
to authenticated
using ((select auth.uid()) = owner_id);

create policy event_attachments_select_own
on public.event_attachments
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy event_attachments_insert_own
on public.event_attachments
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy event_attachments_update_own
on public.event_attachments
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy event_attachments_delete_own
on public.event_attachments
for delete
to authenticated
using ((select auth.uid()) = owner_id);

create policy todos_select_own
on public.todos
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy todos_insert_own
on public.todos
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy todos_update_own
on public.todos
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy todos_delete_own
on public.todos
for delete
to authenticated
using ((select auth.uid()) = owner_id);

create policy stickers_select_own
on public.stickers
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy stickers_insert_own
on public.stickers
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy stickers_update_own
on public.stickers
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy stickers_delete_own
on public.stickers
for delete
to authenticated
using ((select auth.uid()) = owner_id);
