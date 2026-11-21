-- Scheduled social posts (/admin/social): posts queued for a future time, published by the social cron
-- (/api/cron/social) to TARGET's Facebook Page and/or Instagram. Additive only.
--   * a row is either a finished post (message) or an AI brief (auto_generate + topic): when the brief
--     form is used, the text is written at publish time by Gemini with the owner's stored key (0023)
--   * lifecycle: pending -> publishing -> published | failed; pending -> cancelled. The publishing step
--     is claimed atomically by the cron (status compare-and-swap), so a post can never go out twice
--   * results holds the per-target outcome ({target, ok, id?, url?, error?}[]) with provider errors
--     already mapped to safe text by the publisher; no token or API key is ever stored in this table
--   * RLS on; the owner can read and delete only their own rows. All writes happen on the server with
--     the service role (admin API + cron), like social_ai_keys (0023)

create table if not exists public.social_scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null default '' check (char_length(message) <= 2200),
  link text check (link is null or char_length(link) <= 2000),
  image_url text check (image_url is null or char_length(image_url) <= 2000),
  targets text[] not null check (cardinality(targets) between 1 and 2 and targets <@ array['facebook','instagram']::text[]),
  auto_generate boolean not null default false,
  topic text check (topic is null or char_length(topic) <= 500),
  tone text check (tone is null or tone in ('announcement','tip','question')),
  scheduled_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','publishing','published','failed','cancelled')),
  results jsonb,
  error text check (error is null or char_length(error) <= 500),
  attempts integer not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (auto_generate or char_length(btrim(message)) > 0),
  check (not auto_generate or topic is not null)
);
create index if not exists social_scheduled_posts_user_idx on public.social_scheduled_posts(user_id, created_at desc);
create index if not exists social_scheduled_posts_due_idx on public.social_scheduled_posts(scheduled_at) where status = 'pending';

alter table public.social_scheduled_posts enable row level security;
drop policy if exists "read own scheduled social posts" on public.social_scheduled_posts;
create policy "read own scheduled social posts" on public.social_scheduled_posts for select using (auth.uid() = user_id);
drop policy if exists "delete own scheduled social posts" on public.social_scheduled_posts;
create policy "delete own scheduled social posts" on public.social_scheduled_posts for delete using (auth.uid() = user_id);

revoke all on public.social_scheduled_posts from anon, authenticated;
grant select on public.social_scheduled_posts to authenticated;
grant delete on public.social_scheduled_posts to authenticated;
