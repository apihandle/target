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
| Connectors | `/app/connectors` | Connect Supabase, Vercel, GitHub, Google, Figma, Canva, Slack, Notion; the agent only gets tools of connected apps |
| Activity | `/app/activity` | Timeline of tasks, approval decisions and outcomes, with filters |
| Settings | `/app/settings` | Quick actions, Connected apps, Privacy & memory |

## How approvals work

The assistant can only **propose** actions. When a reply suggests one (for example "add a task" or "add this to Google Calendar"), the server validates it against the action catalogue in `src/lib/approvals.ts` and, only if the action can really run for this user, stores a `pending` row in `approval_requests`. Actions that can't run in this version (sending email, purchases, bookings) are shown as a limitation instead of an approval.

Execution happens in exactly one place, `executeApproval` in `src/lib/server/approvals.ts`, which refuses anything that isn't owned by the caller, isn't in status `approved`, or wasn't approved by the same user. It claims the row atomically (`approved → executing`) so an action can't run twice. In the database, RLS only allows inserting `pending` requests and a trigger (migration 0006) blocks changes to an approval's details and any out-of-order status change. Every decision and outcome is written to `activity_events`.

Executable actions in this build: `create_task`, `create_project` (inside TARGET), `calendar_event` (Google, only when configured and connected) and `connector_tool` (a connector tool marked `requiresApproval`, proposed by the agent loop; see [docs/CONNECTORS.md](docs/CONNECTORS.md)).

## Connectors

Per-user connections to external accounts live in `src/lib/connectors/` (one file per connector + one line in `registry.ts`). The chat route runs a server-side tool-calling loop (`src/lib/agent.ts`) that only offers tools of connectors the user has connected; a missing connector pauses the task as `needs_connection` with a Connect button, and destructive tools go through the approval gate above. Setup, redirect URLs, security model and test plan: **[docs/CONNECTORS.md](docs/CONNECTORS.md)**. Settings → Connected apps now only lists the server-wide services (AI model, web search) and links to the Connectors page.

## Chat extras, scheduling and PWA

Attachments (PDF, images, TXT, CSV) in chat, chat search and pinning, read-only share links, scheduled prompts (Vercel Cron), a model picker, voice input, prompt templates and an installable PWA for `/app`. Setup (migration 0008, the `chat-attachments` bucket, `CRON_SECRET`, cron schedule) and how each works: **[docs/FEATURES.md](docs/FEATURES.md)**.

## Privacy

What this build does and does not protect is described in-app at **Settings → Privacy & memory**. In short: data is in Supabase Postgres, isolated per account by RLS and by server-side ownership checks; it is **not** end-to-end encrypted. Users can review, edit, clear or turn off memory and clear activity history.

## Setup

1. `npm ci`
2. Copy `.env.example` to `.env.local` and fill in values (see comments in that file).
3. Apply the SQL migrations in `supabase/migrations` **in order** (0001 → 0008) to your Supabase project, e.g. with the Supabase SQL editor or `supabase db push`. 0006 and 0007 are additive: they add columns and tables (0007 renames `connections.provider` to `connector_id`) and do not drop user data.
4. In Supabase Auth, keep `https://<your-domain>/auth/callback` in the redirect allow-list (email confirmation and Google sign-in).
5. Optional, for connectors: set `SUPABASE_SERVICE_ROLE_KEY` and `CONNECTOR_ENCRYPTION_KEY`, then register OAuth apps as described in [docs/CONNECTORS.md](docs/CONNECTORS.md). Redirect URLs have the form `https://<your-domain>/api/connectors/<id>/callback`.
6. Optional, for scheduled prompts: set `CRON_SECRET` (and `SUPABASE_SERVICE_ROLE_KEY`); see [docs/FEATURES.md](docs/FEATURES.md) for the cron schedule.
7. `npm run dev` and open http://localhost:3000

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
- `src/lib/*` – validation and domain logic (pure, unit-tested); `src/lib/server/*` – database-touching server logic; `src/lib/connectors/*` – connector registry, credential storage, OAuth and tool definitions
- `src/components/ui/*` – design system primitives; other components are feature UI
- `supabase/migrations/*` – schema, additive only

The public homepage loads a third-party ad tag (`src/components/AdTag.tsx`, rendered from the root layout) that is guarded not to run on `/app`, `/login` or `/auth`; `public/sw.js` is the ad network's site-verification file and must stay at the site root.
