begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id)
values
  ('00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000b2');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);

insert into public.profiles (id, display_name)
values ('00000000-0000-4000-8000-0000000000a1', 'RLS A');

insert into public.user_preferences (user_id)
values ('00000000-0000-4000-8000-0000000000a1');

insert into public.calendars (id, owner_id, name, is_default)
values (
  '10000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000a1',
  'A calendar',
  true
);

insert into public.events (
  owner_id,
  calendar_id,
  title,
  is_all_day,
  start_date,
  end_date
)
values (
  '00000000-0000-4000-8000-0000000000a1',
  '10000000-0000-4000-8000-0000000000a1',
  'cascade event',
  true,
  date '2026-08-01',
  date '2026-08-01'
);

insert into public.todos (owner_id, calendar_id, title, due_date)
values (
  '00000000-0000-4000-8000-0000000000a1',
  '10000000-0000-4000-8000-0000000000a1',
  'cascade todo',
  date '2026-08-01'
);

insert into public.stickers (owner_id, calendar_id, sticker_date, glyph)
values (
  '00000000-0000-4000-8000-0000000000a1',
  '10000000-0000-4000-8000-0000000000a1',
  date '2026-08-01',
  '🌱'
);

select is(
  (select count(*)::integer from public.calendars),
  1,
  'owner can read their own calendar'
);

do $$
begin
  begin
    insert into public.calendars (owner_id, name)
    values ('00000000-0000-4000-8000-0000000000b2', 'forged calendar');
    raise exception 'cross-owner insert unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
select pass('owner cannot insert a row for another user');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);

select is(
  (select count(*)::integer from public.calendars),
  0,
  'second user cannot read the first user calendar'
);

do $$
declare
  changed_count integer;
begin
  update public.calendars
  set name = 'forged update'
  where id = '10000000-0000-4000-8000-0000000000a1';
  get diagnostics changed_count = row_count;
  if changed_count <> 0 then
    raise exception 'second user updated first user calendar';
  end if;

  begin
    insert into public.events (
      owner_id,
      calendar_id,
      title,
      is_all_day,
      start_date,
      end_date
    )
    values (
      '00000000-0000-4000-8000-0000000000b2',
      '10000000-0000-4000-8000-0000000000a1',
      'cross-owner child',
      true,
      date '2026-08-01',
      date '2026-08-01'
    );
    raise exception 'cross-owner child insert unexpectedly succeeded';
  exception
    when foreign_key_violation then null;
  end;
end;
$$;
select pass('second user cannot update or attach child rows to another owner calendar');

reset role;

delete from auth.users
where id = '00000000-0000-4000-8000-0000000000a1';

select is(
  (
    select sum(row_count)::integer
    from (
      select count(*) as row_count from public.calendars where owner_id = '00000000-0000-4000-8000-0000000000a1'
      union all
      select count(*) from public.events where owner_id = '00000000-0000-4000-8000-0000000000a1'
      union all
      select count(*) from public.todos where owner_id = '00000000-0000-4000-8000-0000000000a1'
      union all
      select count(*) from public.stickers where owner_id = '00000000-0000-4000-8000-0000000000a1'
    ) as owned_rows
  ),
  0,
  'deleting an auth user cascades through calendars and owned child rows'
);

select * from finish();
rollback;
