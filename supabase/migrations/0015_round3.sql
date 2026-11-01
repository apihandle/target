-- Round 3: Python/JS can run in the user's own browser when no worker is online, and the worker reports that it is alive.

-- browser_code = a code job that the signed-in user's browser runs (Pyodide), not the hosted worker.
alter table public.browser_jobs drop constraint if exists browser_jobs_mode_check;
alter table public.browser_jobs add constraint browser_jobs_mode_check check (mode in ('steps','auto','code','video','browser_code'));

-- One row per worker; updated every time it asks for a job. Server (service role) only: RLS on, no policies.
create table if not exists public.worker_heartbeats (
  id text primary key,
  modes text[] not null default '{}',
  seen_at timestamptz not null default now()
);
alter table public.worker_heartbeats enable row level security;
