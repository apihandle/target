-- Round 2 capabilities: smart browser + code sandbox + video jobs on the worker, order approvals,
-- proactive suggestions from Gmail/Calendar, and full HTML Pages.

-- ---------------------------------------------------------------- worker jobs (browser_jobs grows modes)
alter table public.browser_jobs add column if not exists mode text not null default 'steps';
alter table public.browser_jobs drop constraint if exists browser_jobs_mode_check;
alter table public.browser_jobs add constraint browser_jobs_mode_check check (mode in ('steps','auto','code','video'));
alter table public.browser_jobs add column if not exists allowed_secrets uuid[] not null default '{}';
alter table public.browser_jobs add column if not exists max_steps integer not null default 20 check (max_steps between 1 and 40);
alter table public.browser_jobs add column if not exists language text check (language is null or language in ('python','javascript'));
alter table public.browser_jobs add column if not exists code text check (code is null or char_length(code) <= 50000);
alter table public.browser_jobs add column if not exists inputs jsonb not null default '[]'::jsonb;
alter table public.browser_jobs add column if not exists log jsonb not null default '[]'::jsonb;
alter table public.browser_jobs add column if not exists files jsonb not null default '[]'::jsonb;
-- Code jobs have no start page.
alter table public.browser_jobs alter column start_url drop not null;
alter table public.browser_jobs drop constraint if exists browser_jobs_start_url_check;
alter table public.browser_jobs add constraint browser_jobs_start_url_check check (start_url is null or char_length(start_url) between 8 and 2000);

-- ---------------------------------------------------------------- proactive suggestions ("For you" on Home)
create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'other' check (kind in ('bill','travel','deadline','event','delivery','other')),
  title text not null check (char_length(title) between 1 and 140),
  detail text not null default '' check (char_length(detail) <= 400),
  prompt text not null check (char_length(prompt) between 1 and 600),
  due_at timestamptz,
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 120),
  status text not null default 'open' check (status in ('open','dismissed','done')),
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index if not exists suggestions_user_idx on public.suggestions(user_id, status, created_at desc);
alter table public.suggestions enable row level security;
drop policy if exists "read own suggestions" on public.suggestions;
create policy "read own suggestions" on public.suggestions for select using (auth.uid() = user_id);
drop policy if exists "update own suggestions" on public.suggestions;
create policy "update own suggestions" on public.suggestions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Opt-out switch for the daily scan (on by default once Google is connected).
alter table public.user_settings add column if not exists proactive_enabled boolean not null default true;
alter table public.user_settings add column if not exists proactive_scanned_at timestamptz;

-- ---------------------------------------------------------------- full HTML Pages
alter table public.pages add column if not exists format text not null default 'markdown';
alter table public.pages drop constraint if exists pages_format_check;
alter table public.pages add constraint pages_format_check check (format in ('markdown','html'));
alter table public.pages add column if not exists html text check (html is null or char_length(html) <= 300000);

-- ---------------------------------------------------------------- storage: let generated files of these types in
update storage.buckets set allowed_mime_types = array[
  'application/pdf','image/png','image/jpeg','image/webp','image/gif','text/plain','text/csv',
  'text/markdown','text/html','application/json','audio/mpeg','video/mp4',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream'
] where id = 'chat-attachments';
