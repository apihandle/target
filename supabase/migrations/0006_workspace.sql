-- TARGET workspace upgrade (additive only: no tables or rows are dropped or rewritten).
-- Adds: project purpose/status/archive, tasks, activity history, approval requests,
-- user settings (memory toggle + quick actions), structured panel kinds, and
-- connected-app records with server-only token storage.

-- ---------------------------------------------------------------- projects
alter table public.projects add column if not exists description text not null default ''
  check (char_length(description) <= 1000);
alter table public.projects add column if not exists status text not null default 'active'
  check (status in ('active','paused','completed','archived'));
alter table public.projects add column if not exists archived_at timestamptz;
create index if not exists projects_user_status_idx on public.projects(user_id, status, updated_at desc);

-- ---------------------------------------------------------------- tasks
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  project_id uuid references public.projects(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 2000),
  status text not null default 'queued'
    check (status in ('queued','planning','in_progress','waiting_approval','completed','failed','cancelled')),
  progress text not null default '' check (char_length(progress) <= 300),
  error text check (error is null or char_length(error) <= 500),
  origin text not null default 'user' check (origin in ('user','assistant')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_user_idx on public.tasks(user_id, updated_at desc);
create index if not exists tasks_project_idx on public.tasks(project_id, updated_at desc);
alter table public.tasks enable row level security;
drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks
  for all using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
    and (conversation_id is null or exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()))
  );

-- ---------------------------------------------------------------- approval requests
create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  project_id uuid references public.projects(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  action_type text not null check (char_length(action_type) between 1 and 60),
  summary text not null check (char_length(summary) between 1 and 300),
  destination text not null default '' check (char_length(destination) <= 300),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','cancelled','executing','executed','failed')),
  decided_by uuid,
  decided_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  error text check (error is null or char_length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists approvals_user_idx on public.approval_requests(user_id, status, created_at desc);
alter table public.approval_requests enable row level security;
drop policy if exists "read own approvals" on public.approval_requests;
create policy "read own approvals" on public.approval_requests for select using (auth.uid() = user_id);
drop policy if exists "propose own approvals" on public.approval_requests;
-- New requests can only start as 'pending'; nobody can insert a pre-approved action.
create policy "propose own approvals" on public.approval_requests for insert
  with check (auth.uid() = user_id and status = 'pending' and decided_by is null and decided_at is null and executed_at is null);
drop policy if exists "decide own approvals" on public.approval_requests;
create policy "decide own approvals" on public.approval_requests for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- (no delete policy: approval history is kept)

-- Guard: details are immutable after creation and status may only move along allowed transitions.
create or replace function public.approval_requests_guard() returns trigger
language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id
     or new.action_type is distinct from old.action_type
     or new.payload is distinct from old.payload
     or new.summary is distinct from old.summary
     or new.destination is distinct from old.destination
     or new.created_at is distinct from old.created_at then
    raise exception 'approval request details are immutable';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'pending'   and new.status in ('approved','rejected','cancelled'))
    or (old.status = 'approved'  and new.status in ('executing','cancelled'))
    or (old.status = 'executing' and new.status in ('executed','failed'))
    or (old.status = 'failed'    and new.status in ('approved','cancelled'))
  ) then
    raise exception 'invalid approval transition % -> %', old.status, new.status;
  end if;
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.decided_by := auth.uid();
    new.decided_at := now();
  elsif new.status in ('rejected','cancelled') and old.status is distinct from new.status then
    new.decided_by := auth.uid();
    new.decided_at := now();
  else
    new.decided_by := old.decided_by;
    new.decided_at := old.decided_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists approval_requests_guard on public.approval_requests;
create trigger approval_requests_guard before update on public.approval_requests
  for each row execute function public.approval_requests_guard();

-- ---------------------------------------------------------------- activity history
create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  project_id uuid references public.projects(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  approval_id uuid references public.approval_requests(id) on delete set null,
  category text not null check (category in ('task','approval','outcome','project','panel','connection','memory')),
  title text not null check (char_length(title) between 1 and 200),
  detail text not null default '' check (char_length(detail) <= 1000),
  status text,
  created_at timestamptz not null default now()
);
create index if not exists activity_user_idx on public.activity_events(user_id, created_at desc);
create index if not exists activity_project_idx on public.activity_events(project_id, created_at desc);
alter table public.activity_events enable row level security;
drop policy if exists "read own activity" on public.activity_events;
create policy "read own activity" on public.activity_events for select using (auth.uid() = user_id);
drop policy if exists "write own activity" on public.activity_events;
create policy "write own activity" on public.activity_events for insert with check (auth.uid() = user_id);
drop policy if exists "clear own activity" on public.activity_events;
create policy "clear own activity" on public.activity_events for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------- user settings
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  memory_enabled boolean not null default true,
  quick_actions jsonb,
  hidden_quick_actions text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- structured panels
alter table public.panels add column if not exists description text not null default ''
  check (char_length(description) <= 300);
alter table public.panels add column if not exists items jsonb not null default '[]'::jsonb;
alter table public.panels add column if not exists updated_at timestamptz not null default now();
alter table public.panels drop constraint if exists panels_kind_check;
alter table public.panels add constraint panels_kind_check
  check (kind in ('weather','countdown','crypto','ai','note','list','tracker','goal'));

-- ---------------------------------------------------------------- connected apps
-- Visible connection metadata (no secrets). Rows are written only by the server
-- (service role) after a completed OAuth exchange; users can read and remove their own.
create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (char_length(provider) between 1 and 40),
  account_label text not null default '',
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  unique (user_id, provider)
);
alter table public.connections enable row level security;
drop policy if exists "read own connections" on public.connections;
create policy "read own connections" on public.connections for select using (auth.uid() = user_id);
drop policy if exists "remove own connections" on public.connections;
create policy "remove own connections" on public.connections for delete using (auth.uid() = user_id);

-- Encrypted OAuth tokens. RLS is enabled with NO policies, so the anon and
-- authenticated roles cannot read or write this table at all; only the server's
-- service-role key can. Values are AES-256-GCM ciphertext (key: TOKEN_ENCRYPTION_KEY).
create table if not exists public.connection_secrets (
  connection_id uuid primary key references public.connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ciphertext text not null,
  updated_at timestamptz not null default now()
);
alter table public.connection_secrets enable row level security;
revoke all on public.connection_secrets from anon, authenticated;
