-- Social AI keys: allow an NVIDIA key next to the Gemini one (0023). The social writer (composer
-- drafts + the Blogger autopilot) prefers the user's NVIDIA key when one is saved and falls back to
-- Gemini — Vikash's Gemini key kept being rejected by Google, so the blog writing moves to NVIDIA's
-- OpenAI-compatible API (integrate.api.nvidia.com). Additive only: the table, its RLS and its grants
-- are unchanged; the only change is the service check now also accepting 'nvidia', so a user can hold
-- one sealed row per service (unique (user_id, service) already allows that).
-- Until this runs, saving an NVIDIA key fails with the check violation and the app answers with the
-- "migration 0027 may not have run yet" message; reading an NVIDIA key simply finds no row.

alter table public.social_ai_keys drop constraint if exists social_ai_keys_service_check;
alter table public.social_ai_keys add constraint social_ai_keys_service_check check (service in ('gemini', 'nvidia'));
