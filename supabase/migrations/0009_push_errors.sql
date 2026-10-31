-- 0009: phone push notifications (PWA web push) and error tracking.

-- ---------------------------------------------------------------- push subscriptions
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  endpoint text not null unique check (char_length(endpoint) between 10 and 1000),
  p256dh text not null check (char_length(p256dh) between 10 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- error events
-- Written only by the server (service role). No user policies: nobody reads these through the API.
create table if not exists public.error_events (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('client','server','cron')),
  message text not null check (char_length(message) <= 500),
  stack text check (stack is null or char_length(stack) <= 4000),
  url text check (url is null or char_length(url) <= 500),
  fingerprint text not null check (char_length(fingerprint) <= 64),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists error_events_recent_idx on public.error_events(created_at desc);
create index if not exists error_events_fp_idx on public.error_events(fingerprint, created_at desc);
alter table public.error_events enable row level security;
