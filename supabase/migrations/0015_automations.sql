-- Automations: scheduled prompts may run smart browser tasks without a per-run approval (owner opt-in).
alter table public.scheduled_jobs add column if not exists allow_browser boolean not null default false;
