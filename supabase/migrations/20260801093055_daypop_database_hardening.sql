-- The Dashboard's automatic-RLS option installs this event-trigger helper in
-- public. It must continue serving the event trigger, but it must not be exposed
-- as a callable Data API RPC.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- Composite foreign keys require indexes in the same leading-column order.
-- Owner-first indexes from the core migration remain useful for owner-scoped
-- application queries; these indexes protect parent updates and deletes.
create index events_calendar_owner_fk_idx
  on public.events (calendar_id, owner_id);

create index event_exceptions_event_owner_fk_idx
  on public.event_exceptions (event_id, owner_id);

create index event_exceptions_replacement_owner_fk_idx
  on public.event_exceptions (replacement_event_id, owner_id)
  where replacement_event_id is not null;

create index event_attendees_event_owner_fk_idx
  on public.event_attendees (event_id, owner_id);

create index event_attachments_event_owner_fk_idx
  on public.event_attachments (event_id, owner_id);

create index todos_calendar_owner_fk_idx
  on public.todos (calendar_id, owner_id);

create index todos_parent_owner_calendar_fk_idx
  on public.todos (parent_id, owner_id, calendar_id)
  where parent_id is not null;

create index stickers_calendar_owner_fk_idx
  on public.stickers (calendar_id, owner_id);
