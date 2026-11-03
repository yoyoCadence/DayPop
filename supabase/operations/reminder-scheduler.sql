-- Owner-reviewed operation, never an automatic migration.
-- Render both placeholders from the existing linked project and enable/disable.
-- No literal secret belongs in this file or the rendered SQL.
do $scheduler$
declare
  project_ref constant text := '__DAYPOP_PROJECT_REF__';
  action constant text := '__DAYPOP_REMINDER_ACTION__';
  job_name constant text := 'daypop-reminder-minute-v1';
  command text;
  existing_job record;
  configuration record;
  secret_count integer;
  sender_token text;
  application_key text;
begin
  if current_user<>'postgres' then
    raise exception 'daypop_reminder_scheduler_owner_required';
  end if;
  if project_ref !~ '^[a-z0-9]{20}$' then
    raise exception 'daypop_reminder_scheduler_project_required';
  end if;
  if action not in ('enable','disable') then
    raise exception 'daypop_reminder_scheduler_action_required';
  end if;
  if to_regclass('daypop_reminders.configuration') is null then
    raise exception 'daypop_reminder_scheduler_migrations_required';
  end if;
  command := replace(format($job$-- DayPop reminder scheduler v1
select net.http_post(
  url := %L,
  headers := jsonb_build_object('Content-Type','application/json','Authorization',
    'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='daypop_reminder_token')),
  body := '{}'::jsonb,
  timeout_milliseconds := 55000
);$job$, 'https://' || project_ref || '.supabase.co/functions/v1/reminder-sender'),chr(13),'');

  select * into configuration from daypop_reminders.configuration where singleton for update;
  if not found then raise exception 'daypop_reminder_scheduler_migrations_required'; end if;
  if to_regclass('cron.job') is null then
    if action='disable' then
      update daypop_reminders.configuration set enabled=false where singleton;
      return;
    end if;
    raise exception 'daypop_reminder_scheduler_migrations_required';
  end if;
  select j.jobid,j.command as sql_command,j.schedule,j.active into existing_job
    from cron.job j where j.jobname=job_name and j.username=current_user;
  if action='disable' then
    update daypop_reminders.configuration set enabled=false where singleton;
    if existing_job.jobid is not null then
      if existing_job.sql_command=command and existing_job.schedule='* * * * *' then
        perform cron.unschedule(existing_job.jobid);
      else
        raise notice 'Reminder sending disabled; a different scheduler command was left unchanged';
      end if;
    end if;
    return;
  end if;

  if (select count(*) from pg_extension where extname in ('pg_cron','pg_net'))<>2 then
    raise exception 'daypop_reminder_scheduler_migrations_required';
  end if;
  if existing_job.jobid is not null and
     (existing_job.sql_command is distinct from command or existing_job.schedule<>'* * * * *') then
    raise exception 'daypop_reminder_scheduler_job_name_conflict';
  end if;
  select count(*),max(decrypted_secret) filter(where name='daypop_reminder_token'),
    max(decrypted_secret) filter(where name='daypop_reminder_vapid_public_key')
    into secret_count,sender_token,application_key from vault.decrypted_secrets
    where name in ('daypop_reminder_token','daypop_reminder_vapid_public_key');
  if secret_count<>2 or sender_token is null or length(sender_token) not between 43 and 256
     or sender_token !~ '^[A-Za-z0-9_-]+$'
     or application_key is null or application_key !~ '^B[A-Za-z0-9_-]{86}$' then
    raise exception 'daypop_reminder_scheduler_secrets_required';
  end if;
  if configuration.public_key is not null and configuration.public_key<>application_key then
    raise exception 'daypop_reminder_scheduler_key_rotation_requires_review';
  end if;
  if not configuration.enabled or configuration.public_key is null then
    update daypop_reminders.configuration set enabled=true,public_key=application_key where singleton;
  end if;
  if existing_job.jobid is null then
    perform cron.schedule(job_name,'* * * * *',command);
  elsif not existing_job.active then
    perform cron.alter_job(existing_job.jobid,active:=true);
  end if;
end;
$scheduler$;
