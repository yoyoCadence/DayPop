begin;

create extension if not exists pgtap with schema extensions;
select plan(36);

select is(
  (select public from storage.buckets where id = 'event-attachments'),
  false,
  'event attachments bucket is private'
);

select is(
  (select file_size_limit from storage.buckets where id = 'event-attachments'),
  10485760::bigint,
  'bucket limits each object to 10 MiB'
);

select is(
  (
    select cardinality(allowed_mime_types)
    from storage.buckets
    where id = 'event-attachments'
  ),
  9,
  'bucket has the canonical nine-type MIME allowlist'
);

select ok(
  (
    select 'application/pdf' = any (allowed_mime_types)
    from storage.buckets
    where id = 'event-attachments'
  ),
  'bucket allowlist includes PDF attachments'
);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.attachment_cleanup_jobs'::regclass
  ),
  'cleanup queue has RLS enabled'
);

select ok(
  not has_table_privilege('anon', 'public.attachment_cleanup_jobs', 'select'),
  'anon cannot read cleanup jobs'
);

select ok(
  not has_table_privilege('authenticated', 'public.attachment_cleanup_jobs', 'update'),
  'authenticated cannot rewrite queued paths'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policy
    where polrelid = 'public.attachment_cleanup_jobs'::regclass
  ),
  3,
  'cleanup queue has owner select, insert and delete policies'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname like 'event_attachments_storage_%'
  ),
  3,
  'attachment objects have insert, select and delete policies'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'finalize_event_attachment_upload',
        'delete_event_attachment_with_cleanup',
        'delete_event_with_attachment_cleanup'
      )
      and not p.prosecdef
  ),
  3,
  'all attachment RPCs are security invoker'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'finalize_event_attachment_upload',
        'delete_event_attachment_with_cleanup',
        'delete_event_with_attachment_cleanup'
      )
      and p.proconfig[1] = concat('search_path=', chr(34), chr(34))
  ),
  3,
  'all attachment RPCs fix an empty search_path'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'finalize_event_attachment_upload',
        'delete_event_attachment_with_cleanup',
        'delete_event_with_attachment_cleanup'
      )
      and has_function_privilege('anon', p.oid, 'execute')
  ),
  0,
  'anon cannot execute attachment RPCs'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'finalize_event_attachment_upload',
        'delete_event_attachment_with_cleanup',
        'delete_event_with_attachment_cleanup'
      )
      and has_function_privilege('authenticated', p.oid, 'execute')
  ),
  3,
  'authenticated can execute attachment RPCs'
);

insert into auth.users (id)
values
  ('00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000b2');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
select set_config(
  'daypop.attachment_test_calendar_id',
  (
    select id::text
    from public.calendars
    where owner_id = '00000000-0000-4000-8000-0000000000a1'
      and is_default
  ),
  true
);

insert into public.events (
  id,
  owner_id,
  calendar_id,
  title,
  is_all_day,
  start_date,
  end_date
)
values (
  '00000000-0000-4000-8000-0000000000e1',
  '00000000-0000-4000-8000-0000000000a1',
  current_setting('daypop.attachment_test_calendar_id')::uuid,
  'attachment policy event',
  true,
  date '2026-08-09',
  date '2026-08-09'
);

insert into public.attachment_cleanup_jobs (owner_id, object_path)
values (
  '00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000e1/00000000-0000-4000-8000-0000000000f1'
);

select is(
  (select count(*)::integer from public.attachment_cleanup_jobs),
  1,
  'owner can stage one cleanup job before upload'
);

do $$
begin
  begin
    insert into public.attachment_cleanup_jobs (owner_id, object_path)
    values (
      '00000000-0000-4000-8000-0000000000b2',
      '00000000-0000-4000-8000-0000000000b2/00000000-0000-4000-8000-0000000000e1/00000000-0000-4000-8000-0000000000f2'
    );
    raise exception 'cross-owner cleanup job unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
select pass('owner cannot stage a cleanup job for another user');

insert into storage.objects (id, bucket_id, name, owner_id)
values (
  '00000000-0000-4000-8000-0000000000d1',
  'event-attachments',
  '00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000e1/00000000-0000-4000-8000-0000000000f1',
  '00000000-0000-4000-8000-0000000000a1'
);
select pass('owner can upload only after staging a matching cleanup job');

select is(
  (
    select count(*)::integer
    from storage.objects
    where id = '00000000-0000-4000-8000-0000000000d1'
  ),
  1,
  'owner can read a staged object before metadata finalization'
);

do $$
begin
  begin
    insert into storage.objects (id, bucket_id, name, owner_id)
    values (
      '00000000-0000-4000-8000-0000000000d2',
      'event-attachments',
      '00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000e1/00000000-0000-4000-8000-0000000000f2',
      '00000000-0000-4000-8000-0000000000a1'
    );
    raise exception 'unstaged object unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
select pass('upload without a matching cleanup job is rejected');

select is(
  (
    select id
    from public.finalize_event_attachment_upload(
      '00000000-0000-4000-8000-0000000000f1',
      '00000000-0000-4000-8000-0000000000e1',
      '00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000e1/00000000-0000-4000-8000-0000000000f1',
      'agenda.pdf',
      'application/pdf',
      6
    )
  ),
  '00000000-0000-4000-8000-0000000000f1'::uuid,
  'finalize RPC writes canonical metadata'
);

select is(
  (select count(*)::integer from public.event_attachments),
  1,
  'finalized metadata is visible to its owner'
);

select is(
  (select count(*)::integer from public.attachment_cleanup_jobs),
  0,
  'finalize RPC atomically removes the staged cleanup job'
);

select is(
  (
    select count(*)::integer
    from storage.objects
    where id = '00000000-0000-4000-8000-0000000000d1'
  ),
  1,
  'owner can read a finalized private object through metadata'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);

select is(
  (select count(*)::integer from public.event_attachments),
  0,
  'second user cannot read first user attachment metadata'
);

select is(
  (
    select count(*)::integer
    from storage.objects
    where id = '00000000-0000-4000-8000-0000000000d1'
  ),
  0,
  'second user cannot read first user private object'
);

select is(
  public.delete_event_attachment_with_cleanup(
    '00000000-0000-4000-8000-0000000000f1'
  ),
  false,
  'second user cannot queue or delete first user attachment'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);

select is(
  (select count(*)::integer from public.event_attachments),
  1,
  'cross-user delete attempt preserves metadata'
);

select is(
  public.delete_event_attachment_with_cleanup(
    '00000000-0000-4000-8000-0000000000f1'
  ),
  true,
  'owner delete RPC removes metadata and queues object cleanup'
);

select is(
  (select count(*)::integer from public.event_attachments),
  0,
  'owner delete RPC removes attachment metadata'
);

select is(
  (select count(*)::integer from public.attachment_cleanup_jobs),
  1,
  'owner delete RPC exposes one durable cleanup job'
);

select is(
  (
    select count(*)::integer
    from storage.objects
    where id = '00000000-0000-4000-8000-0000000000d1'
  ),
  1,
  'queued object remains selectable for Storage remove'
);

select ok(
  (
    select
      pg_catalog.pg_get_expr(polqual, polrelid) like '%attachment_cleanup_jobs%'
      and pg_catalog.pg_get_expr(polqual, polrelid) like '%auth.uid()%'
    from pg_catalog.pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname = 'event_attachments_storage_delete_own'
  ),
  'Storage delete policy requires both owner identity and a queued object'
);

delete from public.attachment_cleanup_jobs;
select is(
  (select count(*)::integer from public.attachment_cleanup_jobs),
  0,
  'owner can acknowledge a completed cleanup job'
);

insert into public.attachment_cleanup_jobs (owner_id, object_path)
values (
  '00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000e1/00000000-0000-4000-8000-0000000000f3'
);

insert into storage.objects (id, bucket_id, name, owner_id)
values (
  '00000000-0000-4000-8000-0000000000d3',
  'event-attachments',
  '00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000e1/00000000-0000-4000-8000-0000000000f3',
  '00000000-0000-4000-8000-0000000000a1'
);

do $$
begin
  perform public.finalize_event_attachment_upload(
    '00000000-0000-4000-8000-0000000000f3',
    '00000000-0000-4000-8000-0000000000e1',
    '00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000e1/00000000-0000-4000-8000-0000000000f3',
    'event.txt',
    'text/plain',
    5
  );
end;
$$;

select is(
  public.delete_event_with_attachment_cleanup(
    '00000000-0000-4000-8000-0000000000e1'
  ),
  true,
  'event delete RPC removes the event and queues all attachment objects'
);

select is(
  (
    select count(*)::integer
    from public.events
    where id = '00000000-0000-4000-8000-0000000000e1'
  ),
  0,
  'event delete RPC removes the event'
);

select is(
  (select count(*)::integer from public.event_attachments),
  0,
  'event delete cascade removes attachment metadata'
);

select is(
  (select count(*)::integer from public.attachment_cleanup_jobs),
  1,
  'event delete leaves its attachment object in the durable cleanup queue'
);

select * from finish();
rollback;
