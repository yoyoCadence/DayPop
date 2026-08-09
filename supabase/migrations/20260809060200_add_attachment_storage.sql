-- DP-028: private event attachments with owner-only Storage access.
--
-- Storage object deletion and public metadata deletion cannot share one
-- transaction. attachment_cleanup_jobs is therefore a durable compensation
-- queue: delete RPCs enqueue paths in the same transaction that removes the
-- metadata/event, and the authenticated client removes the object then the
-- queue row. A SELECT policy hides jobs while live metadata still references
-- the path, so a failed best-effort queue-row delete can never remove a valid
-- attachment later.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'event-attachments',
  'event-attachments',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'application/pdf',
    'text/plain',
    'text/calendar'
  ]::text[]
);

alter table public.event_attachments
  add constraint event_attachments_size_supported
    check (size_bytes between 1 and 10485760),
  add constraint event_attachments_mime_type_supported
    check (
      mime_type = any (array[
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'image/heic',
        'image/heif',
        'application/pdf',
        'text/plain',
        'text/calendar'
      ]::text[])
    ),
  add constraint event_attachments_file_name_trimmed
    check (file_name = btrim(file_name)),
  add constraint event_attachments_canonical_object_path
    check (
      object_path = owner_id::text || '/' || event_id::text || '/' || id::text
    );

create table public.attachment_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  bucket_id text not null default 'event-attachments',
  object_path text not null,
  created_at timestamptz not null default now(),
  constraint attachment_cleanup_jobs_bucket
    check (bucket_id = 'event-attachments'),
  constraint attachment_cleanup_jobs_object_path_unique
    unique (owner_id, object_path),
  constraint attachment_cleanup_jobs_canonical_path
    check (
      object_path ~ (
        '^' || owner_id::text ||
        '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' ||
        '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
    )
);

create index attachment_cleanup_jobs_owner_created_idx
  on public.attachment_cleanup_jobs (owner_id, created_at);

alter table public.attachment_cleanup_jobs enable row level security;

revoke all on table public.attachment_cleanup_jobs from anon;
revoke all on table public.attachment_cleanup_jobs from authenticated;
grant select, delete on table public.attachment_cleanup_jobs to authenticated;
grant insert (owner_id, bucket_id, object_path)
  on table public.attachment_cleanup_jobs to authenticated;

create policy attachment_cleanup_jobs_select_orphan_own
on public.attachment_cleanup_jobs
for select
to authenticated
using (
  (select auth.uid()) = owner_id
  and not exists (
    select 1
    from public.event_attachments attachment
    where attachment.owner_id = attachment_cleanup_jobs.owner_id
      and attachment.object_path = attachment_cleanup_jobs.object_path
  )
);

create policy attachment_cleanup_jobs_insert_own
on public.attachment_cleanup_jobs
for insert
to authenticated
with check (
  (select auth.uid()) = owner_id
  and bucket_id = 'event-attachments'
  and (storage.foldername(object_path))[1] = owner_id::text
);

create policy attachment_cleanup_jobs_delete_own
on public.attachment_cleanup_jobs
for delete
to authenticated
using ((select auth.uid()) = owner_id);

create policy event_attachments_storage_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'event-attachments'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ (
    '^' || (select auth.uid())::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  and exists (
    select 1
    from public.events event
    where event.owner_id = (select auth.uid())
      and event.id::text = (storage.foldername(name))[2]
  )
  and exists (
    select 1
    from public.attachment_cleanup_jobs job
    where job.owner_id = (select auth.uid())
      and job.bucket_id = storage.objects.bucket_id
      and job.object_path = storage.objects.name
  )
);

create policy event_attachments_storage_select_own
on storage.objects
for select
to authenticated
using (
  bucket_id = 'event-attachments'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (
    exists (
      select 1
      from public.event_attachments attachment
      where attachment.owner_id = (select auth.uid())
        and attachment.object_path = storage.objects.name
    )
    or exists (
      select 1
      from public.attachment_cleanup_jobs job
      where job.owner_id = (select auth.uid())
        and job.bucket_id = storage.objects.bucket_id
        and job.object_path = storage.objects.name
    )
  )
);

create policy event_attachments_storage_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'event-attachments'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.attachment_cleanup_jobs job
    where job.owner_id = (select auth.uid())
      and job.bucket_id = storage.objects.bucket_id
      and job.object_path = storage.objects.name
  )
);

create function public.finalize_event_attachment_upload(
  p_id uuid,
  p_event_id uuid,
  p_object_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns public.event_attachments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  finalized public.event_attachments;
  deleted_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Delete the compensation row first, then insert metadata in the same DB
  -- transaction. If validation, RLS or the FK rejects metadata, PostgreSQL
  -- rolls the deletion back and the uploaded object remains cleanable.
  delete from public.attachment_cleanup_jobs job
  where job.owner_id = (select auth.uid())
    and job.bucket_id = 'event-attachments'
    and job.object_path = p_object_path;

  get diagnostics deleted_count = row_count;
  if deleted_count <> 1 then
    raise exception 'attachment cleanup job is missing' using errcode = '23514';
  end if;

  insert into public.event_attachments (
    id,
    owner_id,
    event_id,
    object_path,
    file_name,
    mime_type,
    size_bytes
  )
  values (
    p_id,
    (select auth.uid()),
    p_event_id,
    p_object_path,
    p_file_name,
    p_mime_type,
    p_size_bytes
  )
  returning * into finalized;

  return finalized;
end;
$$;

create function public.delete_event_attachment_with_cleanup(p_attachment_id uuid)
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
    and attachment.owner_id = (select auth.uid())
  on conflict (owner_id, object_path) do nothing;

  delete from public.event_attachments attachment
  where attachment.id = p_attachment_id
    and attachment.owner_id = (select auth.uid());

  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;

create function public.delete_event_with_attachment_cleanup(p_event_id uuid)
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
    and attachment.owner_id = (select auth.uid())
  on conflict (owner_id, object_path) do nothing;

  delete from public.events event
  where event.id = p_event_id
    and event.owner_id = (select auth.uid());

  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;

revoke all on function public.delete_event_attachment_with_cleanup(uuid) from public;
revoke all on function public.delete_event_attachment_with_cleanup(uuid) from anon;
grant execute on function public.delete_event_attachment_with_cleanup(uuid) to authenticated;

revoke all on function public.delete_event_with_attachment_cleanup(uuid) from public;
revoke all on function public.delete_event_with_attachment_cleanup(uuid) from anon;
grant execute on function public.delete_event_with_attachment_cleanup(uuid) to authenticated;

revoke all on function public.finalize_event_attachment_upload(
  uuid, uuid, text, text, text, bigint
) from public;
revoke all on function public.finalize_event_attachment_upload(
  uuid, uuid, text, text, text, bigint
) from anon;
grant execute on function public.finalize_event_attachment_upload(
  uuid, uuid, text, text, text, bigint
) to authenticated;
