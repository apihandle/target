-- Feature 6: projects (named workspaces with standing instructions; chats grouped under them)
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 80),
  instructions text not null default '' check (char_length(instructions) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_user_idx on public.projects(user_id, updated_at desc);
alter table public.projects enable row level security;
drop policy if exists "own projects" on public.projects;
create policy "own projects" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.conversations add column if not exists project_id uuid references public.projects(id) on delete set null;
create index if not exists conversations_project_idx on public.conversations(project_id, updated_at desc);

drop policy if exists "own conversations" on public.conversations;
create policy "own conversations" on public.conversations
  for all using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
  );
