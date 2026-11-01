-- One-time reminders and every-N-hours schedules for scheduled prompts.
alter table public.scheduled_jobs add column if not exists run_on text check (run_on is null or run_on ~ '^\d{4}-\d{2}-\d{2}$');
alter table public.scheduled_jobs add column if not exists interval_hours smallint check (interval_hours is null or interval_hours between 1 and 168);
alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_cadence_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_cadence_check check (cadence in ('daily','weekly','once','interval'));
alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_status_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_status_check check (status in ('active','paused','done'));
