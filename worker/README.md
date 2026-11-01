# TARGET browser worker

Vercel can't run a real browser, so website tasks (forms, sign-ups, JavaScript pages) run here.

1. On any always-on machine with Node 18+:
   ```bash
   npm i playwright && npx playwright install --with-deps chromium
   TARGET_URL=https://gettarget.vercel.app SESSION_WORKER_SECRET=<same 32+ char secret as Vercel> node worker/browser-worker.mjs
   ```
2. In TARGET, ask for a website task. Steps that click or type wait in **Settings → Browser tasks** until you approve.
3. Results show on that page, with a phone notification.

Safety: private/internal addresses are blocked, vault values are fetched one field at a time only for an approved, running task that lists them, and nothing secret is logged.
