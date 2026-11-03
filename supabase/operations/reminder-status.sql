-- Read-only metadata. Never select decrypted secrets, HTTP headers or payloads.
select c.enabled,
  case when c.public_key is not null then left(encode(extensions.digest(c.public_key,'sha256'),'hex'),12) end as public_key_fingerprint,
  c.last_tick,c.last_error,
  (select count(*) from cron.job where jobname='daypop-reminder-minute-v1' and username=current_user) as job_count,
  (select count(*) from cron.job where jobname='daypop-reminder-minute-v1' and username=current_user and active) as active_job_count,
  (select r.status from cron.job_run_details r join cron.job j using(jobid)
    where j.jobname='daypop-reminder-minute-v1' and j.username=current_user order by r.start_time desc limit 1) as last_cron_status
from daypop_reminders.configuration c where c.singleton;
