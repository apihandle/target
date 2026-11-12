# TARGET — app map

TARGET is a personal AI assistant: a Next.js 16 web app plus a native Android assistant. It chats and remembers, searches the web, runs code, creates files/pages, connects outside accounts, and can browse, sign in, book or check out on real sites — asking before risky actions. It also schedules work, sends push alerts, and installs as a PWA.

## Architecture

| Layer | What it is |
|---|---|
| Web | Next.js 16.4 App Router, React 19, TypeScript, Tailwind. App shell under `src/app/app`, marketing/auth in `src/app`, admin in `src/app/admin`, public share/page/site routes. |
| API | Route handlers under `src/app/api`: chat streaming, attachments, memories, projects, panels, tasks, scheduled, approvals, browser jobs, checkout, connectors, vault, files, pages, shares, push, proactive, admin, cron. |
| Data | Supabase Postgres + RLS + Auth + private Storage bucket `chat-attachments` (10 MB). 34 tables: `activity_events, admin_audit_log, admin_settings, ai_usage, app_login_handoffs, approval_requests, attachments, browser_jobs, connections, connection_secrets, connector_oauth_states, connector_rate_limits, conversations, conversation_shares, custom_providers, error_events, feedback, generated_files, memories, messages, pages, panels, projects, prompt_templates, push_subscriptions, scheduled_jobs, site_sessions, suggestions, tasks, user_presence, user_settings, vault_secrets, work_links, work_views` (see `supabase/migrations`). |
| AI | NVIDIA NIM primary, OpenRouter fallback (`src/lib/llm.ts`); per-user OpenAI-compatible provider (`src/lib/customProvider.ts`); tools in `src/lib/builtins`, skills/playbooks in `src/lib/skills.ts` + `src/lib/playbooks.ts`. |
| Media/tools | Tavily search (`src/lib/search.ts`), Pollinations images, QuickChart, Openverse, unpdf; worker-side yt-dlp/ffmpeg/Pillow. |
| Workers | `worker/browser-worker.mjs` (Playwright cloud browser), `worker/compute-worker.mjs` (isolated Python/Node/media sandbox); reached through `src/lib/server/autoBrowser.ts`, `cloudWorker.ts`, `remoteBrowser.ts`; deploy on Render/HF Space/Docker. |
| Android | Kotlin + Compose WebView shell in `target-app/`: bridge, native voice/assistant, wake word, accessibility, notifications, calls/SMS/WhatsApp, routines, vision, offline queue, biometrics, self-update, Google PKCE handoff. |
| Deploy/CI | Vercel + Supabase; GitHub Actions for lint/tsc/test/build, Android build, and scheduled cron pings. |

## Features that exist

| Feature | Files |
|---|---|
| Marketing site, auth page, legal pages | `src/app/page.tsx`, `src/components/Hero.tsx`, `Features.tsx`, `Privacy.tsx`, `src/app/login`, `src/app/privacy`, `src/app/terms` |
| Email/password signup+login, Google OAuth, Turnstile, session keeper, Android app-return handoff | `src/components/AuthForm.tsx`, `src/lib/auth/*`, `src/app/auth/*`, `src/lib/supabase/*`, `supabase/migrations/0021_*`, `0022_*` |
| Streaming chat, stop, retry, edit/resend, model picker, web-search toggle, voice input, spoken replies, attachments | `src/app/api/chat/route.ts`, `src/components/Chat.tsx`, `VoiceButton.tsx`, `ModelPicker.tsx`, `src/lib/llm.ts`, `ai.ts`, `quick.ts` |
| Chat history, search, pin/rename/delete, share links, public snapshot | `src/components/Sidebar.tsx`, `src/app/app/page.tsx`, `src/app/api/conversations`, `src/app/api/conversations/[id]/shares`, `src/app/share/[token]` |
| Templates, playbooks, skills, quick actions | `src/lib/templates.ts`, `playbooks.ts`, `skills.ts`, `settings.ts`, `src/app/api/templates`, `src/app/app/settings/quick-actions` |
| Long-term memory (auto-extract + explicit, review/edit/clear, toggle) | `src/lib/memory.ts`, `src/components/MemoryManager.tsx`, `src/app/app/memory`, `src/app/api/memories`, `src/app/app/settings/privacy` |
| Projects with instructions, tasks, chats, activity | `src/lib/projects.ts`, `src/app/app/projects`, `src/app/api/projects` |
| Tasks and lifecycle | `src/lib/tasks.ts`, `src/app/api/tasks`, `src/app/app/home` |
| Panels: weather, countdown, crypto, AI, note, list, tracker, goal | `src/lib/panels.ts`, `panels-server.ts`, `src/app/app/panels`, `src/app/api/panels` |
| Home dashboard, For You suggestions, proactive scans | `src/app/app/home`, `src/lib/server/proactive.ts`, `src/app/api/cron/proactive`, `src/app/api/suggestions` |
| Scheduled prompts/reminders (once/interval/daily/weekly, timezone, cron) | `src/lib/schedule.ts`, `src/app/app/scheduled`, `src/app/api/scheduled`, `src/app/api/cron/scheduled` |
| Activity timeline + approval inbox (approve/reject, task-mode gate) | `src/app/app/activity`, `src/components/ApprovalCard.tsx`, `src/lib/approvals.ts`, `src/lib/server/approvals.ts`, `src/app/api/approvals` |
| File uploads (PDF/image/TXT/CSV, magic-byte checks, text extraction, vision) | `src/lib/attachments.ts`, `src/app/api/attachments`, `src/app/app/settings/files` |
| Generated files (PDF/CSV/Markdown/etc.) and download | `src/lib/builtins/helpers.ts`, `src/app/api/files`, `generated_files` |
| Public Pages (Markdown) and Sites (HTML) with visibility controls | `src/lib/builtins/siteAccount.ts`, `src/app/p/[slug]`, `src/app/site/[slug]`, `src/app/api/pages`, `src/app/app/settings/pages` |
| Web search with sources, URL reader, YouTube transcripts | `src/lib/search.ts`, `urlReader.ts`, `src/lib/builtins/round2.ts` |
| Built-in tools: image gen, image search, charts, files, pages, video analysis, parallel research | `src/lib/builtins/tools.ts`, `round2.ts`, `helpers.ts` |
| Code interpreter / sandbox + media processing | `worker/compute-worker.mjs`, `src/lib/server/cloudWorker.ts`, `docs/COMPUTE-WORKER.md` |
| Browser agent: cloud browsers, fixed steps, live view/take control, HITL, saved site sessions, Cloudflare handling | `src/lib/server/autoBrowser.ts`, `remoteBrowser.ts`, `worker/browser-worker.mjs`, `src/app/api/browser-jobs`, `src/app/app/settings/browser`, `docs/CHECKOUT.md` |
| Website sign-in/sign-up/password-reset flows and OTP cards | `src/lib/builtins/signin.ts`, `siteAccount.ts`, `src/lib/loginCheck.ts`, `src/lib/server/siteSessions.ts`, `src/components/LoginCard.tsx`, `OtpCard.tsx` |
| Checkout and booking (prepare/pay, cards from vault, review gates) | `src/lib/checkout.ts`, `src/lib/server/checkoutRun.ts`, `src/lib/builtins/round2.ts`, `docs/CHECKOUT.md` |
| Encrypted vault for logins, cards, API keys, notes | `src/lib/builtins/vault.ts`, `src/app/api/vault`, `src/app/app/settings/vault` |
| Connectors: Google (Gmail/Calendar/Drive/Sheets/Docs/Contacts), GitHub, Supabase, Vercel, Figma, Canva, Slack, Notion | `src/lib/connectors/*`, `src/app/app/connectors`, `src/app/api/connectors`, `docs/CONNECTORS.md` |
| Custom OpenAI-compatible providers (add, test, list models, encrypted key) | `src/lib/customProvider.ts`, `src/app/app/settings/ai-providers`, `src/app/api/custom-providers`, `docs/CUSTOM-PROVIDER.md` |
| PWA, offline fallback, service worker, web push/VAPID | `public/app.webmanifest`, `public/app-sw.js`, `src/app/app/layout.tsx`, `src/lib/server/push.ts`, `src/app/app/settings/notifications` |
| Privacy/security: RLS ownership, AES-GCM secrets, SSRF guards, rate limits, CSP, admin gate | `supabase/migrations`, `src/lib/crypto.ts`, `src/lib/ssrf.ts`, `src/lib/rateLimit.ts`, `src/middleware.ts`, `src/lib/admin.ts` |
| Admin panel: users, errors, jobs, scheduled, shares, activity, AI usage, feedback, health, controls, audit, CSV export | `src/app/admin`, `src/app/api/admin`, `src/lib/server/admin*.ts`, `docs/ADMIN.md` |
| Feedback and site error reporting | `src/app/app/settings/feedback`, `src/app/app/settings/errors`, `src/app/api/feedback`, `src/app/api/errors` |
| Android assistant: wake word, native voice loop, device/app control, calls/SMS/WhatsApp, media/system, accessibility screen reading, notification read/reply, call announce/answer, alarms/calendar, routines, camera vision, offline queue, biometric lock, self-update, Google sign-in handoff | `target-app/app/src/main/java/app/target/assistant/**`, `target-app/README.md`, `PLAN.md`, `V02-PROGRESS.md` |

## Half-done or broken

- Checkout payment iframes and 3-D Secure/OTP pause are not finished (tracked as #24/#25 in `docs/CHECKOUT.md`); live checkout/booking is only exercised by a gated e2e test.
- Real-model checkout/booking tests (#26), Canva/Figma connectors (#27), Notion/Slack OAuth (#28), compute-worker deploy (#29), HF Space browser-worker refresh (#30), and external cron pinger (#31) remain open.
- Android real-device items are untested: call announce/answer and real WhatsApp send/reply. `target-app/README.md` still says Google sign-in is absent, but the PKCE handoff is implemented (`AppLinks.kt`, `HandoffVerifier.kt`, `MainActivity.kt`, `/auth/app-handoff`, `/auth/app-return`).
- Web auth has no password reset or magic link (only email/password and Google); Android has no iOS counterpart.
- Web voice is turn-based (SpeechRecognition + speechSynthesis), not a realtime duplex voice mode.
- Uploads accept only PDF/PNG/JPEG/WEBP/GIF/TXT/CSV; no Office documents, audio, or video upload/transcription.

## Verification (run in this repo)

```
npm ci            PASS — 632 packages installed; 14 vulnerabilities (11 moderate, 1 high, 2 critical)
npm test          PASS — Test Files 76 passed | 1 skipped (77); Tests 918 passed | 2 skipped (920)
npm run build     PASS — with placeholder Supabase env; Next compiled in 547ms, TypeScript 2.7s, 17/17 static pages
npx tsc --noEmit  PASS — exit 0
npx eslint src    PASS — exit 0; 1 warning: src/components/Hero.tsx:56 (react-hooks/purity)
```

Skipped tests: `compute-worker.test.tsx` (worker tools unavailable), `checkout-live.test.ts` (needs `LIVE_CHECKOUT=1` + Chromium), `compute-worker-isolation.test.ts` (worker/Linux unavailable). Build used `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co` and an anon-key placeholder because no production secrets were available.
