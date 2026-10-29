-- Feature 5: long-term memory
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  content text not null check (char_length(content) between 1 and 500),
  source text not null default 'manual' check (source in ('manual','chat','explicit')),
  created_at timestamptz not null default now()
);
create index if not exists memories_user_idx on public.memories(user_id, created_at desc);
alter table public.memories enable row level security;
drop policy if exists "own memories" on public.memories;
create policy "own memories" on public.memories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
