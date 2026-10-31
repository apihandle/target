-- Saved website sessions (cookies) for accounts TARGET signs in to or registers for the user,
-- for example a site the user joined with their Google/Gmail account.
-- Cookies are AES-256-GCM encrypted by the server (same key as connectors). The browser roles can list
-- and delete their own rows but can never read the encrypted cookies.
create table if not exists public.site_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  domain text not null check (char_length(domain) between 3 and 253),
  account_email text not null default '' check (char_length(account_email) <= 320),
  via text not null default 'email' check (via in ('google', 'email', 'password', 'other')),
  encrypted_cookies text not null,
  cookie_count int not null default 0,
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (user_id, domain, account_email)
);
create index if not exists site_sessions_user_idx on public.site_sessions(user_id);
create index if not exists site_sessions_expiry_idx on public.site_sessions(expires_at);

alter table public.site_sessions enable row level security;
drop policy if exists "read own site sessions" on public.site_sessions;
create policy "read own site sessions" on public.site_sessions for select using (auth.uid() = user_id);
drop policy if exists "remove own site sessions" on public.site_sessions;
create policy "remove own site sessions" on public.site_sessions for delete using (auth.uid() = user_id);

revoke all on public.site_sessions from anon, authenticated;
grant select (id, user_id, domain, account_email, via, cookie_count, status, expires_at, created_at, updated_at, last_used_at)
  on public.site_sessions to authenticated;
grant delete on public.site_sessions to authenticated;
