-- DP-028 follow-up: INSERT ... ON CONFLICT invokes extra RLS visibility
-- checks on attachment_cleanup_jobs. A successful upload finalization removes
-- its staging job atomically, and delete retries no longer have metadata to
-- enqueue, so these delete RPCs never need conflict handling.

create or replace function public.delete_event_attachment_with_cleanup(
  p_attachment_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  insert into public.attachment_cleanup_jobs (owner_id, bucket_id, object_path)
  select attachment.owner_id, 'event-attachments', attachment.object_path
  from public.event_attachments attachment
  where attachment.id = p_attachment_id
    and attachment.owner_id = (select auth.uid());

  delete from public.event_attachments attachment
  where attachment.id = p_attachment_id
    and attachment.owner_id = (select auth.uid());

  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;

create or replace function public.delete_event_with_attachment_cleanup(
  p_event_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  insert into public.attachment_cleanup_jobs (owner_id, bucket_id, object_path)
  select attachment.owner_id, 'event-attachments', attachment.object_path
  from public.event_attachments attachment
  where attachment.event_id = p_event_id
    and attachment.owner_id = (select auth.uid());

  delete from public.events event
  where event.id = p_event_id
    and event.owner_id = (select auth.uid());

  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;
