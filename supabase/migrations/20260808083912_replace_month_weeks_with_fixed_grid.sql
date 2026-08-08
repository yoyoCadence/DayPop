-- DP-018: replace the ambiguous 4/5/6 row count with a semantic preference,
-- and persist the canonical visual theme separately from light/dark behaviour.
-- Existing rows keep their saved `theme`; ALTER DEFAULT only affects new rows.

alter table public.user_preferences
  add column theme_id text not null default 'manga',
  add column fixed_six_week_grid boolean;

update public.user_preferences
set fixed_six_week_grid = (month_weeks = 6);

alter table public.user_preferences
  alter column fixed_six_week_grid set not null,
  alter column fixed_six_week_grid set default false,
  alter column theme set default 'light',
  drop constraint user_preferences_month_weeks,
  drop column month_weeks,
  add constraint user_preferences_theme_id
    check (theme_id in ('manga', 'minimal', 'warm', 'business', 'vivid', 'pixel'));

comment on column public.user_preferences.fixed_six_week_grid is
  'true keeps six visible week rows; false adapts to the current month (4-6 rows)';

comment on column public.user_preferences.theme_id is
  'canonical DayPop visual theme; light/dark/system remains in theme';
