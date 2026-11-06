-- App login handoffs: a Supabase session created by the Google OAuth callback in Chrome
-- (Custom Tab) is parked here, encrypted, behind a one-time code so the Android app's
-- WebView can claim it via /auth/app-handoff. Written and consumed only by the service
-- role (see src/lib/auth/appHandoff.ts). Codes expire 60 seconds after creation and are
-- deleted when consumed.
create table if not exists public.app_login_handoffs (
  code_hash text primary key,
  session_enc text not null,
  next text check (next is null or char_length(next) <= 300),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists app_login_handoffs_expiry_idx on public.app_login_handoffs(expires_at);
alter table public.app_login_handoffs enable row level security;
revoke all on public.app_login_handoffs from anon, authenticated;
