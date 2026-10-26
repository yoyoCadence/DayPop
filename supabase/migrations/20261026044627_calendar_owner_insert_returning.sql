-- DP-209: the owner is present on the row being checked. Do not require the
-- STABLE calendar_access() helper to re-read a just-inserted calendar from the
-- calling statement's older snapshot (INSERT/UPSERT ... RETURNING).
-- Non-owners still need the existing membership + explicit-share predicate.
-- https://www.postgresql.org/docs/17/xfunc-volatility.html
alter policy calendars_read_authorized on public.calendars
using ((select auth.uid()) = owner_id or daypop_family.calendar_access(id) is not null);
