-- AI usage logging + user feedback (admin panel v2, 2026-11-05). Run AFTER 0019_admin.sql.

-- ---------------------------------------------------------------- ai_usage (server-only)
-- One row per model ATTEMPT made by the central LLM call path (src/lib/llm.ts), written fire-and-forget with the
-- service-role key. A raced call (NVIDIA NIM / OpenRouter) writes one row per model it started: the winner
-- (race_won = true), any model cancelled because another won (race_won = false, error_code 'cancelled') and any
-- model that failed (success = false). Attempts of one call share request_id.
-- NEVER stored: prompt or response text, API keys, custom provider names or URLs.
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  request_id uuid,
  provider text not null check (provider in ('nim', 'openrouter', 'custom')),
  model text not null check (char_length(model) between 1 and 160),
  feature text not null default 'other' check (feature ~ '^[a-z0-9_]{1,32}$'),
  attempt smallint check (attempt is null or attempt between 0 and 100),
  streamed boolean not null default false,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  ttft_ms integer check (ttft_ms is null or ttft_ms >= 0),
  success boolean not null,
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,40}$'),
  -- true = won a race against at least one other model; false = cancelled because another model won;
  -- null = no race decided this attempt (single model, custom provider, or the attempt failed on its own).
  race_won boolean
);
create index if not exists ai_usage_recent_idx on public.ai_usage(created_at desc);
create index if not exists ai_usage_user_idx on public.ai_usage(user_id, created_at desc);
create index if not exists ai_usage_provider_idx on public.ai_usage(provider, created_at desc);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;
-- The identity sequence is only used by the service role.
do $$ begin
  execute 'revoke all on sequence public.ai_usage_id_seq from anon, authenticated';
exception when undefined_table then null; end $$;

-- ---------------------------------------------------------------- feedback
-- Written by signed-in users from /app (POST /api/feedback, rate-limited, length-capped). A user can insert and
-- read their OWN rows only (never admin_note); status and admin_note are changed by admins through /api/admin
-- (service role). Screenshots are not collected.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 3 and 2000),
  category text not null default 'other' check (category in ('bug', 'idea', 'other')),
  page_path text check (page_path is null or (char_length(page_path) <= 200 and page_path like '/%')),
  status text not null default 'new' check (status in ('new', 'seen', 'done')),
  admin_note text check (admin_note is null or char_length(admin_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists feedback_recent_idx on public.feedback(created_at desc);
create index if not exists feedback_status_idx on public.feedback(status, created_at desc);
create index if not exists feedback_user_idx on public.feedback(user_id, created_at desc);
alter table public.feedback enable row level security;

drop policy if exists "feedback_insert_own" on public.feedback;
create policy "feedback_insert_own" on public.feedback for insert to authenticated
  with check (user_id = auth.uid() and status = 'new' and admin_note is null);
drop policy if exists "feedback_select_own" on public.feedback;
create policy "feedback_select_own" on public.feedback for select to authenticated
  using (user_id = auth.uid());
-- No update/delete policies: users can't change status or notes.

-- Column grants: users never read admin_note (an internal note) and can only set these four columns on insert.
revoke all on public.feedback from anon, authenticated;
grant select (id, user_id, message, category, page_path, status, created_at, updated_at) on public.feedback to authenticated;
grant insert (user_id, message, category, page_path) on public.feedback to authenticated;
