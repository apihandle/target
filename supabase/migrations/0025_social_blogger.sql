-- Blogger as a third social destination (/admin/social, AlphaPost-style): the admin connects their own
-- Google account in-app (the "blogger" connector — OAuth tokens are sealed in `connections`, migration
-- 0007, like every provider secret) and picks which of their blogs posts go to. Additive only.
--   * social_blogger_settings holds that one non-secret choice per user (blog id + display name + URL).
--     It is a setting, not a credential: no token ever lands in this table
--   * social_scheduled_posts (0024) learns the new target: 'blogger' joins the allowed targets (up to
--     three destinations per post), and a nullable `title` column carries the optional explicit blog
--     title (the publisher falls back to the post's first line when it is null)
--   * RLS on; the owner can read and delete only their own settings row. All writes happen on the
--     server with the service role (admin API), like social_ai_keys (0023)

create table if not exists public.social_blogger_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  blog_id text not null check (char_length(blog_id) between 1 and 100),
  blog_name text not null default '' check (char_length(blog_name) <= 200),
  blog_url text check (blog_url is null or char_length(blog_url) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.social_blogger_settings enable row level security;
drop policy if exists "read own blogger settings" on public.social_blogger_settings;
create policy "read own blogger settings" on public.social_blogger_settings for select using (auth.uid() = user_id);
drop policy if exists "delete own blogger settings" on public.social_blogger_settings;
create policy "delete own blogger settings" on public.social_blogger_settings for delete using (auth.uid() = user_id);

revoke all on public.social_blogger_settings from anon, authenticated;
grant select on public.social_blogger_settings to authenticated;
grant delete on public.social_blogger_settings to authenticated;

-- Scheduled posts: allow the blogger target (three destinations max) and an optional explicit title.
alter table public.social_scheduled_posts drop constraint if exists social_scheduled_posts_targets_check;
alter table public.social_scheduled_posts add constraint social_scheduled_posts_targets_check
  check (cardinality(targets) between 1 and 3 and targets <@ array['facebook','instagram','blogger']::text[]);
alter table public.social_scheduled_posts add column if not exists title text
  check (title is null or char_length(title) <= 200);
