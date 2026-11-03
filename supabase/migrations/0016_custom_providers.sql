-- Custom AI providers (Settings → AI providers): each user's own OpenAI-compatible endpoints.
-- Additive only. Same secret pattern as connections / vault_secrets:
--   * key_box is AES-256-GCM ciphertext (CONNECTOR_ENCRYPTION_KEY), bound to the owner's user id
--   * RLS on; a user can see and delete only their own rows
--   * the browser roles can read every column EXCEPT key_box and can't insert/update at all;
--     writes happen on the server with the service role after validation (https, public address, limits)

create table if not exists public.custom_providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  base_url text not null check (char_length(base_url) between 8 and 300),
  models text[] not null default '{}' check (cardinality(models) between 1 and 20),
  key_box text not null check (char_length(key_box) between 10 and 4000),
  key_preview text not null default '' check (char_length(key_preview) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists custom_providers_user_idx on public.custom_providers(user_id, created_at);

alter table public.custom_providers enable row level security;
drop policy if exists "read own custom providers" on public.custom_providers;
create policy "read own custom providers" on public.custom_providers for select using (auth.uid() = user_id);
drop policy if exists "delete own custom providers" on public.custom_providers;
create policy "delete own custom providers" on public.custom_providers for delete using (auth.uid() = user_id);

revoke all on public.custom_providers from anon, authenticated;
grant select (id, user_id, name, base_url, models, key_preview, created_at, updated_at) on public.custom_providers to authenticated;
grant delete on public.custom_providers to authenticated;
