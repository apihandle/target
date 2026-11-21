-- Blogger autopilot (/app/social): TARGET itself writes and posts to the user's connected Blogger blog
-- on the social cron's cadence (every 4 hours — see vercel.json), with no human in the loop. Additive only.
--   * one settings row per user: an on/off switch plus the topic/niche the posts should be about.
--     Which blog the posts go to stays in social_blogger_settings (0025) — never duplicated here —
--     and the Gemini key that writes the posts stays sealed in social_ai_keys (0023)
--   * a row is just a preference: no token, key or other secret ever lands in this table
--   * RLS on; the owner can read and delete only their own row. All writes happen on the server with
--     the service role (user API + cron), like social_blogger_settings (0025)

create table if not exists public.social_autopilot_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  topic text check (topic is null or char_length(topic) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.social_autopilot_settings enable row level security;
drop policy if exists "read own autopilot settings" on public.social_autopilot_settings;
create policy "read own autopilot settings" on public.social_autopilot_settings for select using (auth.uid() = user_id);
drop policy if exists "delete own autopilot settings" on public.social_autopilot_settings;
create policy "delete own autopilot settings" on public.social_autopilot_settings for delete using (auth.uid() = user_id);

revoke all on public.social_autopilot_settings from anon, authenticated;
grant select on public.social_autopilot_settings to authenticated;
grant delete on public.social_autopilot_settings to authenticated;
