# AI handoff: open tasks and repo conventions

Tasks that the previous agent could not do or verify from its sandbox are GitHub issues labelled
[`ai-handoff`](https://github.com/apihandle/target/issues?q=is%3Aissue+label%3Aai-handoff). Each issue is
self-contained: context, files, acceptance criteria, how to test, constraints. Pick one, do it, close it with
the commit hash.

## Open tasks
| # | Task | Needs |
|---|---|---|
| [#24](https://github.com/apihandle/target/issues/24) | Checkout: fill card fields inside payment iframes (Stripe Elements, Razorpay Checkout) | code + Chromium |
| [#25](https://github.com/apihandle/target/issues/25) | Checkout: pause for 3-D Secure / bank OTP / SMS OTP and continue after the user answers | code |
| [#26](https://github.com/apihandle/target/issues/26) | Real-model end-to-end tests for checkout and booking | model API key + Chromium |
| [#27](https://github.com/apihandle/target/issues/27) | Connectors: make Canva and Figma work end to end | owner's Canva/Figma developer accounts |
| [#28](https://github.com/apihandle/target/issues/28) | Connectors: register Notion and Slack OAuth apps and verify | owner's Notion/Slack developer accounts |
| [#29](https://github.com/apihandle/target/issues/29) | Deploy the compute worker (target-compute) to Render | owner's Render account |
| [#30](https://github.com/apihandle/target/issues/30) | Update the Hugging Face Space browser worker | write access to the HF Space |
| [#31](https://github.com/apihandle/target/issues/31) | On-time scheduled prompts: external cron pinger | cron-job.org or Cloudflare account |
| ~~[#32](https://github.com/apihandle/target/issues/32)~~ | Done 2026-11-03: audited, no test data left | - |
| ~~[#33](https://github.com/apihandle/target/issues/33)~~ | Done 2026-11-03: 0016 applied, RLS + grants verified | - |
| ~~[#34](https://github.com/apihandle/target/issues/34)~~ | Done 2026-11-03: verified live with OpenRouter (6feee9d) | - |

## The project in one paragraph
TARGET is a personal AI app (Next.js 16 App Router + React 19, Supabase auth/DB, deployed on Vercel from `main`,
functions in `bom1`). Chat: `src/app/api/chat/route.ts` → `src/lib/llm.ts` (NVIDIA NIM + OpenRouter models raced
for a fast first word; or the user's own custom provider, `docs/CUSTOM-PROVIDER.md`). Connectors (OAuth):
`src/lib/connectors/*`, `docs/CONNECTORS.md`. Approvals for anything that acts outside the chat:
`src/lib/approvals.ts`, `src/lib/server/approvals.ts`. Browser agent (sign-in, checkout, booking):
`src/lib/server/autoBrowser.ts`, `src/lib/server/cloudWorker.ts`, `worker/browser-worker.mjs`, `docs/CHECKOUT.md`.
Compute worker: `docs/COMPUTE-WORKER.md`. Setup for the owner: `SETUP-REMAINING.md`. Features: `docs/FEATURES.md`.

## Rules (non-negotiable)
- Keep the Monetag tag (zone **12150496**, `src/components/AdTag.tsx`) and `public/sw.js` unchanged. No ads in the signed-in app.
- **No payments, plans, pricing or usage limits for TARGET itself.** Abuse rate limits (`src/lib/connectors/rateLimit.ts`) are fine.
- **Never commit or print secrets.** Real keys go in Vercel env, GitHub Actions secrets, or the worker host's secrets.
- Don't break sign-in, connectors, approvals, checkout/booking, or AI speed.
- UI text is English; don't change the UI language. Chat replies follow the user's language (Hinglish when they write Hinglish).
- Anything that sends, buys, books, deletes or posts goes through an approval card the user taps; the server enforces it.
- Secrets in the DB: AES-256-GCM with `CONNECTOR_ENCRYPTION_KEY` (`src/lib/connectors/crypto.ts`), RLS on, column grants that hide ciphertext from browser roles, writes via the service role on the server only.
- User-supplied URLs fetched by the server must be SSRF-guarded (`src/lib/server/safeFetch.ts` or `src/lib/urlReader.ts`).

## How to run the checks
```bash
npm ci
npx eslint src                 # 0 errors (about 23 old warnings are known)
npx tsc --noEmit -p .
npx vitest run                 # live tests are skipped unless LIVE_CHECKOUT=1 (needs CHROMIUM_PATH)
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder npx next build
```
CI (`.github/workflows/ci.yml`) runs the same on every push/PR to `main` and `wip/**`.

## Deploy model
- One commit per item, with a descriptive message.
- All checks green → push to `main`; Vercel deploys it. Confirm the Vercel commit status is `success`
  (GitHub API: `GET /repos/apihandle/target/commits/<sha>/status`).
- Not green, or not finished → push to `wip/<item>` instead and say what's left.
- New tables need a numbered migration in `supabase/migrations/` (next free number) with RLS; the owner runs it in the Supabase SQL editor (note it in the issue/PR).
- Update `STATUS.md`-style notes in the issue when closing: commit hash, checks, what the owner must do (env vars, migrations).
- If something loops more than twice, stop and leave a note instead of retrying.

## Tests
Vitest + jsdom, files in `src/__tests__/*.test.ts(x)`. Route handlers are tested end to end against an in-memory
Supabase stand-in that simulates RLS and column grants: `src/__tests__/helpers/fakeSupabase.ts`
(`new FakeDb(seed).as(userId)`, `.admin()` for the service role). Mock `@/lib/supabase/server` and
`@/lib/supabase/admin` as in `src/__tests__/custom-provider.test.ts`.
