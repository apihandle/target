-- Feature 7: Home panels (glanceable, auto-refreshing cards)
create table if not exists public.panels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('weather','countdown','crypto','ai','note')),
  title text not null check (char_length(title) between 1 and 80),
  config jsonb not null default '{}'::jsonb,
  data jsonb,
  error text,
  refreshed_at timestamptz,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists panels_user_idx on public.panels(user_id, position, created_at);
alter table public.panels enable row level security;
drop policy if exists "own panels" on public.panels;
create policy "own panels" on public.panels
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
