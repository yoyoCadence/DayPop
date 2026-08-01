-- Calendar deletion must still be blocked while owned child rows exist, but
-- user deletion cascades through auth.users to every owner-scoped table in one
-- statement. NO ACTION performs the FK check after the statement's cascades.
alter table public.events
  drop constraint events_calendar_owner_fk,
  add constraint events_calendar_owner_fk
    foreign key (calendar_id, owner_id)
    references public.calendars (id, owner_id)
    on delete no action;

alter table public.todos
  drop constraint todos_calendar_owner_fk,
  add constraint todos_calendar_owner_fk
    foreign key (calendar_id, owner_id)
    references public.calendars (id, owner_id)
    on delete no action;

alter table public.stickers
  drop constraint stickers_calendar_owner_fk,
  add constraint stickers_calendar_owner_fk
    foreign key (calendar_id, owner_id)
    references public.calendars (id, owner_id)
    on delete no action;
