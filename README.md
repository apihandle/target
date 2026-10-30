# TARGET

TARGET is a personal AI workspace: chat with an assistant, organize longer efforts into Projects, track tasks, review and approve actions before anything happens outside the app, keep glanceable Panels, and connect supported apps.

Live site: https://gettarget.vercel.app

## Stack

- Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS
- Supabase: Auth (email/password + Google) and Postgres with row-level security on every table
- AI: NVIDIA NIM first, OpenRouter as fallback (`src/lib/llm.ts`), streamed through `/api/chat`; model keys stay on the server
- Web search: Tavily (`src/lib/search.ts`)
- Tests: Vitest + Testing Library (`src/__tests__`), plus two Playwright checks for the landing page (`tests/*.py`)

## Workspace areas

| Area | Route | Notes |
| --- | --- | --- |
| Home | `/app/home` | Quick actions, approvals waiting for you, open tasks, panels, recent activity |
| Chat | `/app` | Streaming replies, Stop, Retry, history, project/task context, web search toggle |
| Projects | `/app/projects` | Purpose, status, archive/restore, tasks, conversations, activity |
| Panels | `/app/panels` | List, task tracker, goal, note, countdown (manual) and weather, crypto, AI (live data) |
| Activity | `/app/activity` | Timeline of tasks, approval decisions and outcomes, with filters |
| Settings | `/app/settings` | Quick actions, Connected apps, Privacy & memory |

## How approvals work

The assistant can only **propose** actions. When a reply suggests one (for example "add a task" or "add this to Google Calendar"), the server validates it against the action catalogue in `src/lib/approvals.ts` and, only if the action can really run for this user, stores a `pending` row in `approval_requests`. Actions that can't run in this version (sending email, purchases, bookings) are shown as a limitation instead of an approval.

Execution happens in exactly one place, `executeApproval` in `src/lib/server/approvals.ts`, which refuses anything that isn't owned by the caller, isn't in status `approved`, or wasn't approved by the same user. It claims the row atomically (`approved → executing`) so an action can't run twice. In the database, RLS only allows inserting `pending` requests and a trigger (migration 0006) blocks changes to an approval's details and any out-of-order status change. Every decision and outcome is written to `activity_events`.

Executable actions in this build: `create_task`, `create_project` (inside TARGET) and `calendar_event` (Google Calendar, only when configured and connected).

## Connected apps

Integrations are adapters registered in `src/lib/integrations/registry.ts`; the UI only reads that registry. A provider whose server environment variables are missing shows **Setup required**. "Connected" is shown only when a row exists in `connections` after a completed OAuth flow.

Google Calendar uses the OAuth 2.0 web-server flow (`/api/integrations/google_calendar/connect` → `/callback`) with scopes `openid email https://www.googleapis.com/auth/calendar.events`. State is HMAC-signed and bound to the user plus an httpOnly nonce cookie. Tokens are encrypted with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`) and stored in `connection_secrets`, which has RLS enabled with no policies, so only the server's service-role key can read it. Disconnect revokes the token with Google (best effort) and deletes it.

## Privacy

What this build does and does not protect is described in-app at **Settings → Privacy & memory**. In short: data is in Supabase Postgres, isolated per account by RLS and by server-side ownership checks; it is **not** end-to-end encrypted. Users can review, edit, clear or turn off memory and clear activity history.

## Setup

1. `npm ci`
2. Copy `.env.example` to `.env.local` and fill in values (see comments in that file).
3. Apply the SQL migrations in `supabase/migrations` **in order** (0001 → 0006) to your Supabase project, e.g. with the Supabase SQL editor or `supabase db push`. 0006 is additive: it adds columns and new tables and does not drop or rewrite existing data.
4. In Supabase Auth, keep `https://<your-domain>/auth/callback` in the redirect allow-list (email confirmation and Google sign-in).
5. Optional, for Google Calendar: create an OAuth client (Web application) in Google Cloud, enable the Google Calendar API, add `https://<your-domain>/api/integrations/google_calendar/callback` as an authorized redirect URI, then set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. While the app is in Google's "testing" mode only listed test users can connect.
6. `npm run dev` and open http://localhost:3000

## Scripts

```bash
npm run dev     # local dev server
npm run lint    # ESLint (next/core-web-vitals + typescript)
npx tsc --noEmit
npm test        # Vitest
npm run build
```

## Project layout

- `src/app/api/*` – route handlers; each one checks the session and filters by `user_id` in addition to RLS
- `src/lib/*` – validation and domain logic (pure, unit-tested); `src/lib/server/*` – database-touching server logic; `src/lib/integrations/*` – provider adapters
- `src/components/ui/*` – design system primitives; other components are feature UI
- `supabase/migrations/*` – schema, additive only

The public homepage loads a third-party ad tag (`src/components/AdTag.tsx`, rendered from the root layout) that is guarded not to run on `/app`, `/login` or `/auth`; `public/sw.js` is the ad network's site-verification file and must stay at the site root.
