-- Live browser view in chat + take control (2026-11-04).
-- live: the provider's interactive live-view URL ({provider, url, interactive}); frame: the latest screenshot (base64 JPEG),
-- the fallback view and the final picture; control: who drives the browser (agent / paused waiting for the user / user / stop);
-- resume: {provider, id} of a cloud session a paused job left open for the next worker run (no secrets).
alter table public.browser_jobs add column if not exists live jsonb;
alter table public.browser_jobs add column if not exists frame text;
alter table public.browser_jobs add column if not exists frame_url text;
alter table public.browser_jobs add column if not exists frame_at timestamptz;
alter table public.browser_jobs add column if not exists control text;
alter table public.browser_jobs add column if not exists control_reason text;
alter table public.browser_jobs add column if not exists paused_until timestamptz;
alter table public.browser_jobs add column if not exists resume jsonb;

alter table public.browser_jobs drop constraint if exists browser_jobs_control_check;
alter table public.browser_jobs add constraint browser_jobs_control_check check (control is null or control in ('agent','paused','user','stop'));
alter table public.browser_jobs drop constraint if exists browser_jobs_frame_check;
alter table public.browser_jobs add constraint browser_jobs_frame_check check (frame is null or char_length(frame) <= 400000);
alter table public.browser_jobs drop constraint if exists browser_jobs_frame_url_check;
alter table public.browser_jobs add constraint browser_jobs_frame_url_check check (frame_url is null or char_length(frame_url) <= 2000);
alter table public.browser_jobs drop constraint if exists browser_jobs_control_reason_check;
alter table public.browser_jobs add constraint browser_jobs_control_reason_check check (control_reason is null or char_length(control_reason) <= 200);
-- RLS is unchanged: owners can read their own jobs; all writes go through the server (service role).
