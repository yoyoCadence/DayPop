-- DP-232: install scheduler prerequisites without creating jobs or secrets.
-- Actual reminder activation remains a separate, reviewed server operation.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
-- Keep Supabase-managed extension ownership/grants. Neither cron nor net is
-- exposed through the App's Data API; HTTP regression verifies that boundary.
