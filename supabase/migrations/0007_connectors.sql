-- TARGET connectors (additive: no table, column or row of user data is dropped).
-- Builds on 0006's `connections` / `connection_secrets`:
--   * connections.provider is renamed to connector_id (same data, same unique (user_id, connector_id) constraint)
--   * adds status, encrypted_credentials, created_at, last_used_at
--   * copies 0006 ciphertext from connection_secrets into connections.encrypted_credentials
--   * moves the old 'google_calendar' connection to the new 'google' connector
--   * browsers can never read encrypted_credentials (column-level grants + RLS)
-- Also adds: server-side OAuth state, a rate-limit counter, and the needs_connection task status.

-- ---------------------------------------------------------------- connections
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'connections' and column_name = 'provider')
     and not exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'connections' and column_name = 'connector_id') then
    alter table public.connections rename column provider to connector_id;
  end if;
end $$;

-- Fresh installs that never ran 0006's table shape still end up with the same table.
create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connector_id text not null check (char_length(connector_id) between 1 and 40),
  account_label text not null default '',
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  unique (user_id, connector_id)
);

alter table public.connections add column if not exists status text not null default 'connected';
alter table public.connections drop constraint if exists connections_status_check;
alter table public.connections add constraint connections_status_check check (status in ('connected','expired','revoked'));
alter table public.connections add column if not exists encrypted_credentials text;
alter table public.connections add column if not exists created_at timestamptz not null default now();
alter table public.connections add column if not exists last_used_at timestamptz;
update public.connections set created_at = connected_at where connected_at is not null and created_at > connected_at;

-- Copy 0006 ciphertext (same AES-256-GCM v1 format) into the new column. connection_secrets is kept, unused.
update public.connections c
   set encrypted_credentials = s.ciphertext
  from public.connection_secrets s
 where s.connection_id = c.id and s.user_id = c.user_id and c.encrypted_credentials is null;

-- The Google Calendar integration became the 'google' connector.
update public.connections c set connector_id = 'google'
 where c.connector_id = 'google_calendar'
   and not exists (select 1 from public.connections g where g.user_id = c.user_id and g.connector_id = 'google');

create index if not exists connections_user_idx on public.connections(user_id);

-- RLS: a user sees only their own rows. Writes happen on the server with the service role.
alter table public.connections enable row level security;
drop policy if exists "read own connections" on public.connections;
create policy "read own connections" on public.connections for select using (auth.uid() = user_id);
drop policy if exists "remove own connections" on public.connections;
create policy "remove own connections" on public.connections for delete using (auth.uid() = user_id);

-- Column privileges: the browser roles may read every column EXCEPT encrypted_credentials, and may not
-- insert or update at all. (`select *` from the browser therefore fails by design.)
revoke all on public.connections from anon, authenticated;
grant select (id, user_id, connector_id, status, scopes, account_label, created_at, connected_at, last_used_at)
  on public.connections to authenticated;
grant delete on public.connections to authenticated;

-- 0006 table: still RLS-on with no policies and no grants; now only a legacy fallback.
revoke all on public.connection_secrets from anon, authenticated;

-- ---------------------------------------------------------------- OAuth state (CSRF)
-- Only the SHA-256 of the state value is stored. Single use (deleted on callback), 10-minute expiry.
create table if not exists public.connector_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  connector_id text not null check (char_length(connector_id) between 1 and 40),
  code_verifier_enc text,
  return_to text check (return_to is null or char_length(return_to) <= 300),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists connector_oauth_states_expiry_idx on public.connector_oauth_states(expires_at);
alter table public.connector_oauth_states enable row level security;
revoke all on public.connector_oauth_states from anon, authenticated;

-- ---------------------------------------------------------------- rate limiting
create table if not exists public.connector_rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);
alter table public.connector_rate_limits enable row level security;
revoke all on public.connector_rate_limits from anon, authenticated;

-- Atomic fixed-window counter. Returns true while the caller is within the limit.
create or replace function public.connector_rate_hit(p_key text, p_window_seconds integer, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into public.connector_rate_limits as r (key, window_start, hits)
  values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning hits into n;
  if random() < 0.01 then
    delete from public.connector_rate_limits where window_start < now() - interval '1 day';
    delete from public.connector_oauth_states where expires_at < now() - interval '1 hour';
  end if;
  return n <= p_limit;
end $$;
revoke all on function public.connector_rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.connector_rate_hit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------- tasks: needs_connection
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check
  check (status in ('queued','planning','in_progress','waiting_approval','needs_connection','completed','failed','cancelled'));
alter table public.tasks add column if not exists needs_connector text
  check (needs_connector is null or char_length(needs_connector) <= 40);
