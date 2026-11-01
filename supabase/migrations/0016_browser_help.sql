-- Captcha hand-off: when the smart browser hits a captcha or "I'm not a robot" check, the worker posts a
-- screenshot here and the owner taps or types on it from their phone. The worker reads the taps in order.
alter table public.browser_jobs add column if not exists help jsonb;              -- {reason, screenshot, w, h, at} while waiting on the user
alter table public.browser_jobs add column if not exists help_inputs jsonb not null default '[]'::jsonb; -- [{seq, t, x, y, text, key}]
-- Only the server (service role) writes these; the owner reads them through /api/browser-jobs/[id]/help.
