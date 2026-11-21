-- Social posting (/admin/social): the signed-in user's own AI service keys for drafting posts
-- (v1: Gemini). Additive only. Same secret pattern as custom_providers (0016) / connections:
--   * key_box is AES-256-GCM ciphertext (CONNECTOR_ENCRYPTION_KEY), bound to the owner's user id
--   * RLS on; a user can see and delete only their own rows
--   * the browser roles can read every column EXCEPT key_box and can't insert/update at all;
--     writes happen on the server with the service role after validation

create table if not exists public.social_ai_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  service text not null check (service in ('gemini')),
  key_box text not null check (char_length(key_box) between 10 and 4000),
  key_preview text not null default '' check (char_length(key_preview) <= 40),
  model text check (model is null or char_length(model) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, service)
);
create index if not exists social_ai_keys_user_idx on public.social_ai_keys(user_id, created_at);

alter table public.social_ai_keys enable row level security;
drop policy if exists "read own social ai keys" on public.social_ai_keys;
create policy "read own social ai keys" on public.social_ai_keys for select using (auth.uid() = user_id);
drop policy if exists "delete own social ai keys" on public.social_ai_keys;
create policy "delete own social ai keys" on public.social_ai_keys for delete using (auth.uid() = user_id);

revoke all on public.social_ai_keys from anon, authenticated;
grant select (id, user_id, service, key_preview, model, created_at, updated_at) on public.social_ai_keys to authenticated;
grant delete on public.social_ai_keys to authenticated;
