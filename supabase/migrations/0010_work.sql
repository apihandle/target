-- 0010: Work page. Ad links anyone can open; signed-in users earn coins for each view.
-- Coins are written only by the server (service role), so nobody can grant themselves coins from the browser.

create table if not exists public.work_links (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80),
  url text not null check (char_length(url) between 10 and 1000 and url ~ '^https://'),
  coins integer not null default 1 check (coins between 1 and 1000),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.work_links enable row level security;
drop policy if exists "anyone reads active work links" on public.work_links;
create policy "anyone reads active work links" on public.work_links for select using (active);

create table if not exists public.work_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  link_id uuid not null references public.work_links(id) on delete cascade,
  started_at timestamptz not null default now(),
  claimed_at timestamptz,
  coins integer not null default 0 check (coins >= 0)
);
create index if not exists work_views_user_link_idx on public.work_views(user_id, link_id, started_at desc);
create index if not exists work_views_user_claimed_idx on public.work_views(user_id, claimed_at desc) where claimed_at is not null;
alter table public.work_views enable row level security;
drop policy if exists "read own work views" on public.work_views;
create policy "read own work views" on public.work_views for select using (auth.uid() = user_id);

-- Balance = sum of claimed coins.
create or replace function public.work_balance(p_user uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(coins), 0)::bigint from public.work_views where user_id = p_user and claimed_at is not null
$$;
revoke all on function public.work_balance(uuid) from public, anon, authenticated;
