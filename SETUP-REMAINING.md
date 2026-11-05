# TARGET: remaining setup (handoff, 2026-11-01)

Repo is private. Secret values are never stored in this repo. Generate them locally (e.g. `openssl rand -hex 32`) and set them in Vercel / GitHub only.
Live site: https://gettarget.vercel.app (Vercel project for apihandle/target, auto-deploys main).

## 1. Vercel > Project > Settings > Environment Variables (Production, Preview, Development)

Add or update (safe to overwrite):

| Name | Value |
|---|---|
| CRON_SECRET | <set in Vercel; never commit> |
| SESSION_WORKER_SECRET | <set in Vercel; never commit> |

Add ONLY if the name does not exist yet (changing an existing value breaks saved logins / push subscriptions):

| Name | Value |
|---|---|
| CONNECTOR_ENCRYPTION_KEY | <set in Vercel; never commit> |
| NEXT_PUBLIC_VAPID_PUBLIC_KEY | <set in Vercel; never commit> |
| VAPID_PRIVATE_KEY | <set in Vercel; never commit> |

(Add both VAPID keys together, or neither.)

Also needed from the owner: SUPABASE_SERVICE_ROLE_KEY (Supabase > Project Settings > API), ADMIN_EMAIL (owner's sign-in email). Optional: TAVILY_API_KEY (free key at tavily.com), POLLINATIONS_KEY (AI photo edits).

Admin panel (/admin, 2026-11-05): add ADMIN_EMAILS = the owner's sign-in email(s), comma separated (e.g. the owner's Gmail). Without it /admin is a 404 for everyone. See docs/ADMIN.md.

Then Deployments > latest Production > Redeploy.

## 2. GitHub > apihandle/target > Settings > Secrets and variables > Actions

New repository secret: CRON_SECRET = same value as on Vercel (above). Used by .github/workflows/scheduled-prompts.yml and proactive.yml.

## 3. Supabase > SQL Editor

Done: migrations 0001 through 0016 are applied on the production project (0016 = custom AI providers, applied 2026-11-03, #33). For a future migration: run every file in supabase/migrations/ that has not been run yet, in number order.

## 4. Worker (free): Hugging Face Space

1. huggingface.co > New Space. Name target-worker, SDK Docker > Blank, hardware CPU basic (free), Private.
2. Upload worker/hf-space/Dockerfile and worker/browser-worker.mjs to the Space root, commit.
3. Space Settings > Variables and secrets > New secret: SESSION_WORKER_SECRET = same value as on Vercel.
4. Wait until the Space shows Running and the page says "TARGET worker running".

On the free Space only browser jobs run (steps/auto). Code and video jobs need a root container (worker/Dockerfile on a paid host).

## 5. Check

- https://gettarget.vercel.app loads and sign-in works.
- Settings > Browser tasks: a test task gets picked up by the worker.

## Migration 0019 (admin panel, 2026-11-05)

Run `supabase/migrations/0019_admin.sql` in Supabase > SQL editor. It adds admin_settings, admin_audit_log and user_presence (all server-only). Until it runs, /admin still opens but Controls refuse changes (nothing can be audited), and country/device/active-now stay empty. Nothing else in the app is affected.
