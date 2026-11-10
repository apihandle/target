# Admin panel (`/admin`)

Owner-only dashboard for TARGET: users, errors, browser jobs, scheduled prompts, share links, AI usage, user
feedback, system health, site controls and an audit log. No payments, plans, pricing, usage limits, ads or impersonation.

## Setup (once)

1. **Run the migration** `supabase/migrations/0019_admin.sql` in the Supabase SQL editor. It creates three
   server-only tables (RLS on, no policies, browser roles revoked):
   - `admin_settings`: announcement, maintenance, feature switches, cron heartbeats
   - `admin_audit_log`: every admin write
   - `user_presence`: one row per user with country code, coarse device and last-seen time (for the dashboard)
2. **Run the migration** `supabase/migrations/0020_ai_usage_feedback.sql` (after 0019). It creates:
   - `ai_usage`: one row per AI model attempt (server-only: RLS on, no policies, browser roles revoked)
   - `feedback`: messages users send from the app (RLS: a user can insert and read only their own rows, and can't
     read `admin_note`; admins change status/notes through the service role)
   Until it runs, AI usage and Feedback show an error state with this hint, and logging silently drops rows.
3. **Set `ADMIN_EMAILS`** on Vercel (Project → Settings → Environment Variables, Production), comma separated,
   e.g. `you@example.com,partner@example.com`. Redeploy. Empty or missing means nobody can open `/admin`.
4. `SUPABASE_SERVICE_ROLE_KEY` must be set (it already is in production). `CRON_SECRET` is needed for
   "Run cron now".

Then open `https://<your-domain>/admin` while signed in with one of those emails. Settings → "Admin panel" links
there too (shown only to admins).

## Access rules

- Allowed: a signed-in user whose **confirmed** email is listed in `ADMIN_EMAILS` (case-insensitive).
- Everyone else (signed out, other users, unconfirmed email) gets a plain **404** for every `/admin` page and
  `/api/admin` route. There is no login redirect, so the panel's existence isn't revealed.
- Enforced three times: the proxy (`src/proxy.ts` → `src/lib/supabase/middleware.ts`), the `/admin` layout and
  every page (`requireAdminPage()`), and every API handler (`requireAdmin()`). Tests cover anonymous and
  non-admin access for every route.
- The service-role key is used only on the server, only after the check. It's never sent to the browser or logged.
- `/admin` responses are `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
- `ADMIN_EMAIL` (singular, older) still only controls phone alerts for site errors and the old Settings → Site errors page.

## Sections

| Section | What it shows / does |
|---|---|
| Dashboard | Four stat cards with sparklines (total users + new this week, active today + active now (15 min), messages today + new chats, errors 24 h), activity line chart (messages and active users, 3h/24h/7d/30d), browser-job status donut (7 days), users by country (flags + share bars), devices & browsers, more totals, recent activity and recent errors |
| Users | Search (email or id), paginated list (email, joined, last sign-in, message count), CSV export. Detail page: account facts, country/device/last seen, counts, connected apps, recent activity, browser jobs and errors. **Disable / Enable** = Supabase auth ban (nothing is deleted; you can't disable yourself or another listed admin) |
| Errors | `error_events`, newest first, source filter + text search, message, URL and stack, CSV export |
| Browser jobs | Status filter, goal (long goals collapse), mode, duration (pick-up → finish), error, owner |
| Scheduled | Scheduled prompts (title only, never the prompt text), next/last run, last error, plus cron heartbeats |
| Share links | `/share` links with owner and dates, **Revoke**. Only a hash of each token is stored, so the link itself can't be shown |
| Activity | Everyone's `activity_events`, with a type filter |
| AI usage | Range 24h / 7d / 30d: requests (one per AI call; attempts of a raced call are grouped), failure rate (requests no model answered), latency avg / p95 and time-to-first-word avg / p95 (successful attempts), tokens when the API returned them, requests-over-time chart (requests + failed), share bars by provider, by model (the model that answered, with its failed attempts) and by feature, top 10 users by requests. Recent calls table (one row per attempt: status won/answered/lost race/error code, provider · model, feature, latency, first word, tokens, user) with filters for status, provider, feature, model and user, pagination, CSV export |
| Feedback | Messages from Settings → Send feedback and the app sidebar: status (new/seen/done) and type filters, text search, user, page it was sent from. Change status + internal note (confirm + audit). Sidebar badge = count of new. CSV export |
| Health | Live checks: Supabase, AI usage log (requests and % unanswered in 24 h, last call; "Down" only with ≥20 requests and ≥50% unanswered), Feedback (new waiting), NVIDIA NIM, OpenRouter, custom providers (counted, not called: they use users' own keys), Tavily, configured cloud browsers (Steel / Browserless / Browserbase / Hyperbrowser; Anchor is key-only), browser worker and compute worker (last job picked up), cron (last run). Env vars show only **set / missing** |
| Controls | Announcement banner (shown at the top of `/app`), maintenance mode, feature switches, Run cron now |
| Audit log | Who did what, when (filter by action). Failed attempts are marked |
| Search (top bar) | Users by email/id, browser jobs by id or goal, errors by message |

The top bar's **System OK / Degraded** pill comes from the health checks (summary cached 60 s); "Degraded"
means at least one live check is down. The bell shows errors in the last 24 h.

The dashboard's **Model usage** card (beside Devices & browsers) shows which models answered in the last 7 days.

## AI usage logging (`ai_usage`)

Every model call goes through `llm()` in `src/lib/llm.ts`; it writes one row per **attempt** with
`src/lib/aiUsage.ts`:

| Column | Meaning |
|---|---|
| `user_id` | The user the call was for (null for system work such as the for-you scan without a user) |
| `request_id` | Groups the attempts of one call (a raced call has several) |
| `provider` | `nim` (NVIDIA NIM), `openrouter`, `custom` (a user's own provider) |
| `model` | Model id |
| `feature` | `chat`, `chat_quick`, `scheduled`, `browser`, `video`, `research`, `memory`, `suggestions`, `proactive`, `panels`, `other` |
| `attempt`, `streamed` | Order the model was tried in; streaming or not |
| `input_tokens`, `output_tokens` | Only when the API returns a `usage` object (else null) |
| `latency_ms` | Start of the attempt → last byte (streams) / JSON read (plain calls) / failure |
| `ttft_ms` | Streams only: start → first visible word or tool call |
| `success`, `error_code` | `http_429`, `timeout`, `network`, `empty`, `stream_idle`, `cancelled`, … (`client_closed` = the reader stopped early after the model answered) |
| `race_won` | `true` = answered after another model was tried; `false` = cancelled because another model won; null otherwise |

- **Never stored:** prompt text, reply text, API keys, custom provider names or URLs. Rows are built from a fixed
  whitelist of fields (`sanitizeAiUsage`), so nothing else can slip in.
- **Fire-and-forget:** `logAiUsage()` returns immediately and never throws; a failed insert (DB down, migration
  not run, no service-role key) only drops the row. The insert is kept alive with `after()` when inside a request.
- Who/what: routes set it with `withAiUsage({ userId, feature }, fn)` or an explicit `usage` option on `llm()`.
- `AI_USAGE_LOG=off` turns logging off.
- Not logged: the custom provider "Test connection" and "Fetch models" buttons in Settings (they don't use `llm()`).

## Feedback (`feedback`)

- Users: Settings → **Send feedback** (form + their own messages with status, paginated), or **Send feedback** at
  the bottom of the app sidebar (dialog). Type Bug / Idea / Other, 3–2000 characters, the app path it was sent from
  (no query string). No screenshots.
- `POST /api/feedback` (signed in, **10 per hour per user**, validated, inserted with the user's own session so RLS
  applies) and `GET /api/feedback?page=` (own rows only, never `admin_note`).
- Admin: `POST /api/admin/feedback/[id]` `{ confirm: true, status?, note? }` (note ≤1000 chars, internal; the audit
  entry records the status change and the note length, not the message or note text).

## Writes: confirm + audit

Every write (disable/enable user, revoke share link, feedback status/note, announcement, maintenance, feature
switches, run cron) goes through a confirm dialog; CSV exports (users, errors, AI usage, feedback) are recorded in
the audit log. The write APIs refuse a request unless the body has `confirm: true`.
The audit entry is written **before** the change; if it can't be written (migration 0019 not run) the change is
refused. If the change then fails, a second entry with `failed: true` is added.

## Feature switches (server-enforced)

| Switch | Where the server checks it |
|---|---|
| Browser tasks | Tool calls (`browser_task`, `site_login`, `site_register`, `site_password_reset`, `checkout`, `book`), approval execution (orders, bookings, site accounts), and the browser worker queue (website jobs aren't handed out; code/video jobs still run) |
| Email send | `gmail_send`, `gmail_send_draft`, `gmail_reply`, `gmail_reply_all`, `gmail_forward`, at proposal and at approval (drafts still work) |
| Checkout / Booking | The `checkout` / `book` tools and their approval cards |
| Scheduled tasks | `POST /api/scheduled`, approving a new schedule, and the scheduled cron (skips runs, still records its heartbeat) |
| Custom AI providers | Add / edit / test / fetch-models routes; chat and scheduled runs fall back to Auto; the picker hides custom models |

Settings are cached for 15 s per server instance, so a change reaches every server within about 15 s. If the
settings table is missing or unreadable, everything stays **on** (the panel can't break the app by accident).

**Maintenance mode** rewrites `/app` to a maintenance page (HTTP 503) and answers `/api/*` with 503 for signed-in
non-admins. Admins keep full access. `/api/admin`, `/api/errors` and `/api/auth` stay open; the landing page,
`/login` and cron/worker endpoints aren't affected.

## Presence (country and device)

The proxy writes `user_presence` for signed-in users on `/app` and API requests, at most once every 5 minutes
per user per server: `country` from Vercel's `x-vercel-ip-country` header (2-letter code, or null), `device` as a
coarse "OS · Browser" label, and `last_seen_at`. **The IP address and the full user-agent string are never
stored.** Country data starts filling in after the migration runs, as people use the app.

## Files

- Migrations: `supabase/migrations/0019_admin.sql`, `supabase/migrations/0020_ai_usage_feedback.sql`
- Guard: `src/lib/server/adminCheck.ts`, `src/lib/server/adminAuth.ts`, `src/lib/supabase/middleware.ts`
- Settings + audit: `src/lib/server/adminSettings.ts`, `src/lib/server/adminWrite.ts`, `src/lib/adminConfig.ts`
- AI usage: `src/lib/aiUsage.ts` (logger), `src/lib/llm.ts` (call path), `src/lib/server/adminAiUsage.ts` (admin read model)
- Feedback: `src/lib/feedback.ts`, `src/app/api/feedback/route.ts`, `src/lib/server/adminFeedback.ts`, `src/components/Feedback*.tsx`, `src/components/MyFeedback.tsx`
- Data: `src/lib/server/adminData.ts`, `src/lib/server/adminStats.ts`, `src/lib/server/adminHealth.ts`, `src/lib/server/presence.ts`
- UI: `src/app/admin/**`, `src/components/admin/**` (plain SVG charts, no chart library, nothing loaded on other routes)
- API: `src/app/api/admin/**`
- Tests: `src/__tests__/ai-usage.test.ts`, `feedback-api.test.ts`, `feedback-ui.test.tsx`, `admin-v2.test.ts`, `admin-panel.test.ts`, `admin-killswitch.test.ts`, `admin-ui.test.tsx`, `security-boundaries.test.tsx`
