-- TARGET features (additive only: nothing is dropped or rewritten). Requires 0006 and 0007.
-- Adds:
--   * chat attachments: private Storage bucket "chat-attachments" (per-user folders) + attachments table
--   * conversation pin + trigram indexes for history search
--   * read-only share links (token stored only as a SHA-256 hash) + a narrow public lookup function
--   * scheduled prompts (recurring jobs run by the cron route through the agent/tasks system)
--   * remembered model choice (user_settings.preferred_model)
--   * user-saved prompt templates

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------- conversations: pin + search
alter table public.conversations add column if not exists pinned boolean not null default false;
alter table public.conversations add column if not exists pinned_at timestamptz;
create index if not exists conversations_user_pinned_idx on public.conversations(user_id, pinned desc, updated_at desc);
create index if not exists conversations_title_trgm_idx on public.conversations using gin (title extensions.gin_trgm_ops);
create index if not exists messages_content_trgm_idx on public.messages using gin (content extensions.gin_trgm_ops);
create index if not exists messages_user_idx on public.messages(user_id, created_at desc);

-- ---------------------------------------------------------------- attachments
-- Private bucket. 10 MB per object; only the allow-listed types. Objects live under "<user id>/...".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-attachments', 'chat-attachments', false, 10485760,
        array['application/pdf','image/png','image/jpeg','image/webp','image/gif','text/plain','text/csv'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- A signed-in user can only read, upload and delete objects inside their own top-level folder.
drop policy if exists "chat attachments: read own" on storage.objects;
create policy "chat attachments: read own" on storage.objects for select to authenticated
  using (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "chat attachments: upload own" on storage.objects;
create policy "chat attachments: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "chat attachments: delete own" on storage.objects;
create policy "chat attachments: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
-- (no update policy: uploaded files are immutable; upload with upsert=false)

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  conversation_id uuid references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  storage_path text not null unique check (char_length(storage_path) between 3 and 400),
  name text not null check (char_length(name) between 1 and 200),
  mime text not null check (mime in ('application/pdf','image/png','image/jpeg','image/webp','image/gif','text/plain','text/csv')),
  kind text not null check (kind in ('pdf','image','text','csv')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  extracted_text text check (extracted_text is null or char_length(extracted_text) <= 100000),
  created_at timestamptz not null default now()
);
create index if not exists attachments_user_idx on public.attachments(user_id, created_at desc);
create index if not exists attachments_conv_idx on public.attachments(conversation_id, created_at);
alter table public.attachments enable row level security;
drop policy if exists "own attachments" on public.attachments;
create policy "own attachments" on public.attachments
  for all using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and split_part(storage_path, '/', 1) = auth.uid()::text
    and (conversation_id is null or exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()))
    and (message_id is null or exists (select 1 from public.messages m where m.id = message_id and m.user_id = auth.uid()))
  );

-- ---------------------------------------------------------------- share links
create table if not exists public.conversation_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists conversation_shares_conv_idx on public.conversation_shares(conversation_id, created_at desc);
alter table public.conversation_shares enable row level security;
drop policy if exists "read own shares" on public.conversation_shares;
create policy "read own shares" on public.conversation_shares for select using (auth.uid() = user_id);
drop policy if exists "create own shares" on public.conversation_shares;
create policy "create own shares" on public.conversation_shares for insert
  with check (auth.uid() = user_id and revoked_at is null
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()));
drop policy if exists "revoke own shares" on public.conversation_shares;
create policy "revoke own shares" on public.conversation_shares for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "delete own shares" on public.conversation_shares;
create policy "delete own shares" on public.conversation_shares for delete using (auth.uid() = user_id);

-- Only revoked_at may change, and a revoked link can't be revived.
create or replace function public.conversation_shares_guard() returns trigger
language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id or new.conversation_id is distinct from old.conversation_id
     or new.token_hash is distinct from old.token_hash or new.created_at is distinct from old.created_at then
    raise exception 'share details are immutable';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'share link already revoked';
  end if;
  return new;
end $$;
drop trigger if exists conversation_shares_guard on public.conversation_shares;
create trigger conversation_shares_guard before update on public.conversation_shares
  for each row execute function public.conversation_shares_guard();

-- Public read-only lookup used by /share/[token]. Takes the SHA-256 (hex) of the token, returns only
-- that conversation's title and its user/assistant messages (plus attachment names), or null when the
-- link is unknown or revoked. No user ids, emails, project data or file contents are returned.
create or replace function public.get_shared_conversation(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s record;
  result jsonb;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select cs.conversation_id into s from public.conversation_shares cs
   where cs.token_hash = p_token_hash and cs.revoked_at is null;
  if not found then return null; end if;
  select jsonb_build_object(
    'title', c.title,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'role', m.role, 'content', m.content, 'created_at', m.created_at,
               'attachments', coalesce((select jsonb_agg(jsonb_build_object('name', a.name, 'kind', a.kind) order by a.created_at)
                                          from public.attachments a where a.message_id = m.id), '[]'::jsonb))
             order by m.created_at)
        from (select * from public.messages
               where conversation_id = c.id and role in ('user','assistant')
               order by created_at limit 500) m
    ), '[]'::jsonb)
  ) into result
  from public.conversations c where c.id = s.conversation_id;
  return result;
end $$;
revoke all on function public.get_shared_conversation(text) from public;
grant execute on function public.get_shared_conversation(text) to anon, authenticated;

-- ---------------------------------------------------------------- scheduled prompts
create table if not exists public.scheduled_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  project_id uuid references public.projects(id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  prompt text not null check (char_length(prompt) between 1 and 4000),
  cadence text not null check (cadence in ('daily','weekly')),
  weekday smallint check (weekday is null or weekday between 0 and 6),
  time_of_day text not null check (time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone text not null default 'Asia/Kolkata' check (char_length(timezone) between 1 and 64),
  status text not null default 'active' check (status in ('active','paused')),
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_status text check (last_status is null or char_length(last_status) <= 40),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  last_task_id uuid references public.tasks(id) on delete set null,
  run_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((cadence = 'weekly') = (weekday is not null))
);
create index if not exists scheduled_jobs_user_idx on public.scheduled_jobs(user_id, created_at desc);
create index if not exists scheduled_jobs_due_idx on public.scheduled_jobs(next_run_at) where status = 'active';
alter table public.scheduled_jobs enable row level security;
drop policy if exists "own scheduled jobs" on public.scheduled_jobs;
create policy "own scheduled jobs" on public.scheduled_jobs
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())));

-- ---------------------------------------------------------------- model choice
alter table public.user_settings add column if not exists preferred_model text
  check (preferred_model is null or char_length(preferred_model) <= 200);

-- ---------------------------------------------------------------- prompt templates
create table if not exists public.prompt_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null check (char_length(title) between 1 and 60),
  prompt text not null check (char_length(prompt) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists prompt_templates_user_idx on public.prompt_templates(user_id, created_at desc);
alter table public.prompt_templates enable row level security;
drop policy if exists "own prompt templates" on public.prompt_templates;
create policy "own prompt templates" on public.prompt_templates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
