-- App login handoffs, fix #4: bind each handoff code to the app instance that started
-- sign-in (PKCE-style, RFC 7636). Before opening the Custom Tab the app generates a random
-- verifier that never leaves the phone and sends only code_challenge =
-- base64url(SHA-256(verifier)) with /auth/google; the OAuth callback stores it here, and
-- /auth/app-handoff releases the parked session only to a caller presenting the matching
-- verifier. Before this, the code alone was a bearer token: any browser that opened
-- /auth/app-handoff?code=… within the 60 s TTL got the session (login CSRF).
-- Nullable on purpose: rows written for older app versions (and any pre-migration row)
-- carry no challenge and keep the old code-only behaviour — see src/lib/auth/appHandoff.ts.
-- The table stays service-role only; RLS and grants from 0021 are unchanged.
alter table public.app_login_handoffs
  add column if not exists code_challenge text
  check (code_challenge is null or char_length(code_challenge) = 43);
