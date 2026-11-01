-- Capabilities 6-10: generated files, public Pages, the secure vault, and browser jobs.

-- Files TARGET creates for the user (PDF, CSV, text...). Bytes live in the private chat-attachments bucket.
create table if not exists public.generated_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  mime text not null check (char_length(mime) between 3 and 100),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  storage_path text not null unique check (char_length(storage_path) between 3 and 400),
  created_at timestamptz not null default now()
);
create index if not exists generated_files_user_idx on public.generated_files(user_id, created_at desc);
alter table public.generated_files enable row level security;
drop policy if exists "own generated files" on public.generated_files;
create policy "own generated files" on public.generated_files for select using (auth.uid() = user_id);
drop policy if exists "delete own generated files" on public.generated_files;
create policy "delete own generated files" on public.generated_files for delete using (auth.uid() = user_id);

-- Pages: small public pages (itinerary, invite, notes) at /p/<slug>. Markdown only, never raw HTML.
create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9-]{6,80}$'),
  title text not null check (char_length(title) between 1 and 120),
  markdown text not null check (char_length(markdown) between 1 and 60000),
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pages_user_idx on public.pages(user_id, created_at desc);
alter table public.pages enable row level security;
drop policy if exists "own pages" on public.pages;
create policy "own pages" on public.pages for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Vault: the user's own logins, cards and keys, AES-GCM encrypted by the server. The value column is
-- never readable by the browser (column grant) and never returned by any API.
create table if not exists public.vault_secrets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('login','card','api_key','note')),
  label text not null check (char_length(label) between 1 and 80),
  site text check (site is null or char_length(site) <= 200),
  preview text not null default '' check (char_length(preview) <= 80),
  secret_box text not null check (char_length(secret_box) between 10 and 20000),
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists vault_user_idx on public.vault_secrets(user_id, created_at desc);
alter table public.vault_secrets enable row level security;
drop policy if exists "own vault rows" on public.vault_secrets;
create policy "own vault rows" on public.vault_secrets for select using (auth.uid() = user_id);
drop policy if exists "delete own vault rows" on public.vault_secrets;
create policy "delete own vault rows" on public.vault_secrets for delete using (auth.uid() = user_id);
revoke select on public.vault_secrets from anon, authenticated;
grant select (id, user_id, kind, label, site, preview, last_used_at, created_at) on public.vault_secrets to authenticated;
grant delete on public.vault_secrets to authenticated;

-- Browser jobs: the AI plans steps, the user approves anything that clicks or types, and a trusted
-- headless-browser worker (worker/browser-worker.mjs, run outside Vercel) executes them.
create table if not exists public.browser_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal text not null check (char_length(goal) between 1 and 500),
  start_url text not null check (char_length(start_url) between 8 and 2000),
  steps jsonb not null default '[]'::jsonb,
  status text not null default 'needs_approval' check (status in ('needs_approval','queued','running','done','failed','cancelled')),
  result text check (result is null or char_length(result) <= 20000),
  error text check (error is null or char_length(error) <= 500),
  conversation_id uuid references public.conversations(id) on delete set null,
  claimed_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists browser_jobs_user_idx on public.browser_jobs(user_id, created_at desc);
create index if not exists browser_jobs_queue_idx on public.browser_jobs(status, created_at) where status = 'queued';
alter table public.browser_jobs enable row level security;
drop policy if exists "own browser jobs" on public.browser_jobs;
create policy "own browser jobs" on public.browser_jobs for select using (auth.uid() = user_id);
