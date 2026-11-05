-- Admin panel (/admin, 2026-11-05).
-- Both tables are server-only: RLS is on with NO policies and every browser role is revoked, so only the
-- service-role key (used by /admin pages and /api/admin routes after the ADMIN_EMAILS check) can read or write them.

-- ---------------------------------------------------------------- site-wide admin settings
-- One row per setting. Keys used by the app:
--   announcement      {"enabled": bool, "text": string}            banner at the top of /app
--   maintenance       {"enabled": bool, "message": string}         /app closed for everyone except admins
--   features          {"browser": bool, "email_send": bool, "checkout": bool, "booking": bool,
--                      "scheduled": bool, "custom_providers": bool}  kill-switches (missing key = on)
--   cron:scheduled    {"at": iso, "ran": int, "by": "cron"|"admin"} last run of /api/cron/scheduled
--   cron:proactive    {"at": iso, "scanned": int, "by": ...}        last run of /api/cron/proactive
create table if not exists public.admin_settings (
  key text primary key check (char_length(key) between 1 and 60),
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.admin_settings enable row level security;
revoke all on public.admin_settings from anon, authenticated;

-- ---------------------------------------------------------------- admin audit log
-- Every admin write (disable/enable a user, revoke a share link, change a setting, run cron, CSV export).
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text not null default '' check (char_length(actor_email) <= 320),
  action text not null check (char_length(action) between 1 and 60),
  target_type text check (target_type is null or char_length(target_type) <= 40),
  target_id text check (target_id is null or char_length(target_id) <= 120),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_recent_idx on public.admin_audit_log(created_at desc);
create index if not exists admin_audit_log_action_idx on public.admin_audit_log(action, created_at desc);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;
