# TARGET features (migration 0008)

This branch adds eight features to the signed-in workspace (`/app`). The landing page, the root
layout, the Monetag tag (`AdTag`) and `public/sw.js` are unchanged.

| Feature | Where | Server pieces |
| --- | --- | --- |
| File & image upload in chat | 📎 Attach in the composer | `POST /api/attachments`, `DELETE /api/attachments/[id]`, `/api/chat` (`attachmentIds`) |
| Chat search + pin | Sidebar search box, ☆/★ on each chat | `GET /api/conversations/search?q=`, `PATCH /api/conversations/[id]` (`pinned`) |
| Share chat link | **Share** in the chat header | `GET/POST /api/conversations/[id]/shares`, `DELETE /api/shares/[id]`, public page `/share/[token]` |
| Scheduled prompts | Sidebar → **Scheduled** (`/app/scheduled`) | `GET/POST /api/scheduled`, `PATCH/DELETE /api/scheduled/[id]`, cron `GET /api/cron/scheduled` |
| Model picker | Dropdown in the composer | `GET /api/models`, `PATCH /api/settings` (`preferred_model`), `/api/chat` (`model`) |
| Voice input | 🎤 next to Send | Browser Web Speech API only (no server, no paid API) |
| Prompt templates | ✦ Templates in the composer | `GET/POST /api/templates`, `PATCH/DELETE /api/templates/[id]` |
| Mobile PWA for the app | "Install app" / "Add to Home Screen" from any `/app` page | `public/app.webmanifest`, `public/app-sw.js`, `src/app/app/layout.tsx` |

## Setup

### 1. Apply migration 0008

Requires 0006 and 0007 to be applied first. In the Supabase SQL editor (or `supabase db push`), run
`supabase/migrations/0008_features.sql`. It is additive (nothing is dropped) and safe to re-run. It:

- enables `pg_trgm` and adds trigram indexes on `conversations.title` and `messages.content` (search);
- adds `conversations.pinned` / `pinned_at`;
- creates the **private** Storage bucket `chat-attachments` (10 MB per file; PDF, PNG, JPEG, WEBP, GIF,
  TXT, CSV only) with `storage.objects` policies so a user can only read, upload and delete objects
  under their own `<user id>/` folder (no update policy: files are immutable);
- creates `attachments`, `conversation_shares`, `scheduled_jobs` and `prompt_templates`, each with RLS
  limited to the owner (`auth.uid() = user_id`) and ownership checks on referenced chats/projects;
- adds `get_shared_conversation(token_hash)`, a `security definer` function callable by `anon` that
  returns only the title and user/assistant messages (plus attachment file names) of a non-revoked share;
- adds `user_settings.preferred_model`.

Until 0008 is applied the app keeps working: the sidebar falls back to the unpinned list, built-in
templates still show, and the Scheduled page explains that the database update is missing.

If the bucket insert fails on your project (some setups restrict `storage.buckets`), create it in the
dashboard instead: Storage → New bucket → name `chat-attachments`, **Public off**, file size limit 10 MB,
allowed MIME types as above; then re-run the migration for the policies.

### 2. Environment variables

| Variable | Needed for | Notes |
| --- | --- | --- |
| `CRON_SECRET` | Scheduled prompts | ≥16 chars (`openssl rand -hex 32`). Without it the cron route returns 503 and never runs. |
| `SUPABASE_SERVICE_ROLE_KEY` | Scheduled prompts | Already required by connectors. Used only server-side by the cron route. |
| `VISION_MODELS` | Optional, image attachments | Comma list of `provider:model` (or model ids) that accept images. If unset, names containing `-vl`, `vision`, `llava`, `pixtral` etc. count as vision models. |
| `NVIDIA_MODELS`, `OPENROUTER_MODEL` | Model picker | Existing variables. The picker offers exactly these models (or the built-in defaults); the server rejects anything else. |

Set them in Vercel → Project → Settings → Environment Variables, then redeploy.

### 3. Cron

`vercel.json` registers `GET /api/cron/scheduled` at `30 2 * * *` (08:00 IST, once a day). That is the
most frequent schedule Vercel's **Hobby** plan accepts; a more frequent expression makes Hobby
deployments fail. Each invocation runs up to 3 due jobs and moves every job's `next_run_at` forward,
so a missed time is caught up on the next invocation (once, not repeatedly).

For runs close to the time users pick:

- **Vercel Pro:** change the schedule to `*/15 * * * *` (or `*/5 * * * *`).
- **Hobby:** keep the daily entry and call the endpoint from any external scheduler every 15 minutes
  with the header `Authorization: Bearer <CRON_SECRET>`. For example a GitHub Actions workflow on the
  default branch:

  ```yaml
  on: { schedule: [{ cron: "*/15 * * * *" }], workflow_dispatch: {} }
  jobs:
    run:
      runs-on: ubuntu-latest
      steps:
        - run: curl -fsS -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" https://gettarget.vercel.app/api/cron/scheduled
  ```

The route is safe to call concurrently: each job is claimed with an optimistic update on
`next_run_at`, so overlapping calls never run a job twice.

## How each feature works

### Attachments
1. The browser uploads the file straight to Storage at `<user id>/<random uuid>/<ascii name>` (this
   avoids Vercel's ~4.5 MB request-body limit; Storage policies refuse any other folder).
2. `POST /api/attachments { path, name }` downloads it with the user's own session, checks the type
   allow-list, the 10 MB limit and the file's magic bytes (a renamed binary is rejected; text must be
   UTF-8 without NUL bytes), extracts text (PDF via `unpdf`, TXT/CSV as UTF-8, capped at 100k chars) and
   stores an `attachments` row. Files that fail validation are deleted from Storage.
3. `/api/chat` accepts up to 5 `attachmentIds`. They must belong to the user, be unsent and not belong to
   another chat. File text goes into the system prompt inside `<untrusted_file>` blocks with
   instructions to treat it as data only (24k characters per request across all files in the chat).
4. Images on the current message are sent as `image_url` parts only to vision-capable models (the
   request is restricted to those, still with fallback among them). With no vision model, or an image
   over 4 MB, the model is told it can't see the image and says so instead of guessing.
5. Deleting a chat also removes its files from Storage. A chip removed before sending deletes the file.

### Search and pin
Search uses `ILIKE` (escaped) on titles and message content, backed by the trigram indexes. RLS limits
it to the user's rows and every query also filters by `user_id`. Pinned chats sort to the top of the
sidebar under **Pinned**.

### Share links
`POST /api/conversations/[id]/shares` creates a 256-bit random token and stores only its SHA-256. The
full link is shown once. `/share/[token]` is server-rendered with the anon key and calls
`get_shared_conversation`, so it never uses the service role and can't read anything but that one chat.
Revoking sets `revoked_at` (a trigger stops it from being un-revoked) and the page 404s immediately. The
page sends `noindex` (meta + `X-Robots-Tag`), `Referrer-Policy: no-referrer` and `Cache-Control: no-store`,
and strips approval/action blocks from messages. It's outside `/app` and isn't part of the landing page.
Note: the root layout's Monetag tag (unchanged) only skips `/app`, `/login` and `/auth`, so it also
loads on `/share/*` like other public pages.

### Scheduled prompts
Jobs store cadence (daily/weekly), local time, weekday and IANA timezone; `next_run_at` is computed in
that timezone (DST-aware). The cron route (service role) claims due jobs and runs each through the same
agent loop and connector tools as chat: it creates a chat, a task (`Scheduled: …`) and activity entries.
Tools that need approval become pending approval requests and the task waits in `waiting_approval`;
nothing is auto-approved. A missing connection pauses the task in `needs_connection`. Results appear in
Tasks, Activity and the run's chat. Limit: 25 jobs per user; a run stops at about 50 seconds.

### Model picker
Options are exactly the configured `NVIDIA_MODELS` / `OPENROUTER_MODEL` lists. The chosen model is tried
first and every other configured model remains the fallback, in the usual NVIDIA → OpenRouter order.
Unknown values are ignored by `/api/chat` and rejected by `PATCH /api/settings`. The last choice is saved
in `user_settings.preferred_model`.

### Voice input
Uses `SpeechRecognition` / `webkitSpeechRecognition`. The mic is hidden when the browser doesn't support
it. Transcripts are appended to the composer; nothing is sent automatically. (Chrome's implementation
sends audio to Google's speech service; Safari uses Apple's.)

### Prompt templates
Four built-ins (blog post, code review, summarize, email draft) plus up to 50 saved templates per user.
Picking one fills the composer; it never sends.

### PWA
`public/app.webmanifest` (`start_url` `/app/home`, scope `/app`) and `public/app-sw.js` are linked and
registered only from `src/app/app/layout.tsx`, i.e. only on `/app` pages. The worker is registered with
scope `/app` (not `/app/`) so the chat page, which lives at `/app` itself, is inside the installed app.
It precaches only an offline page and icons, never caches API responses or signed-in pages, and shows the
offline page when an `/app` navigation fails. `public/sw.js` (Monetag) is untouched.

## Tests
`src/__tests__/features-0008.test.tsx` (route handlers against the in-memory Supabase stand-in, which
simulates RLS and the Storage folder policy) and `src/__tests__/features-0008-ui.test.tsx`. The SQL itself
(policies, trigger, `get_shared_conversation`) is not executed by the test suite; the share tests use a
JavaScript stand-in for the function.
