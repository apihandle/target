# Store checkout (browser agent)

TARGET can buy something on a real store for the user. It never pays without a tap.

## Flow
1. The user asks to buy/order (server-checked: the model can't start a checkout on its own). The chat calls `target__checkout` with the store, start URL, items, and optionally a vault login (`login_secret_id`) and a vault card (`payment_secret_id`).
2. **Prepare job** (runs at once, nothing is paid): the browser adds the items, walks through checkout and stops on the page with the final pay / place order button. It reports `ready_to_pay` with the items, total and payment method **as the page shows them**.
   - The card is not readable by this job at all (not in `allowed_secrets`).
   - The server refuses, whatever the model says: pressing a final pay button, typing card fields, pressing Enter on a page with a pay button, and a `ready_to_pay` whose total is not on the page.
   - At the pay step the worker sends the browser state (cookies + localStorage = the cart) and the page URL. It is sealed with the server key, bound to the user and the job.
3. **Approval card** in chat: items, total, payment method, delivery. Button: *Place order*.
4. **Pay job** (only after the tap): a new browser restores the cart, opens the pay page, fills the card from the vault if the page asks (`fill_secret`, never from chat), and presses the final button **once**, only while the page shows the approved total.
   - A different total -> stops, nothing is paid, and the chat says the new total and asks again.
   - No visible total -> stops.
   - A second press is refused.
5. The outcome (order number / confirmation) is posted in chat; the sealed cart is wiped.

## Limits
- Card fields inside payment iframes (Stripe, Razorpay pop-ups) aren't reachable by the page snapshot; those checkouts stop with a clear reason.
- Captcha, OTP by SMS, 3-D Secure screens need the user; the job stops and says so (email OTPs are read from connected Gmail).
- Carts held only in server memory of a single tab may not survive the hand-over to the pay job; the job then fails with "cart is empty" and nothing is paid.

## Tests
- `src/__tests__/checkout.test.tsx`: guard, totals, tool, full worker-API flow.
- `src/__tests__/checkout-live.test.ts` (skipped unless `LIVE_CHECKOUT=1`): real saucedemo.com in a local Chromium with a scripted chooser in place of the AI. Reaches the pay page, is refused on *Finish*, shows the card ($32.39, SauceCard #31337), then a fresh browser restores the cart and reaches the same pay page. It never presses Finish.

# Bookings (reservations / appointments)

Same two steps, with the final confirm button instead of pay. Tool: `target__book` (business, booking page URL, what, when, details the user gave, optional vault login / deposit card).

1. Only when the user asked to book and chose the place and the time (or a rule like "any time after 6"). The agent never picks another time: if nothing fits it fails and lists the nearest slots.
2. **Prepare job**: finds the slot, fills the details, stops before the final confirm. It reports `ready_to_confirm` with what, when, details and price as the page shows; the server checks the date/time (and price) are on the page. Final buttons ("Confirm booking", "Book appointment", "Complete reservation", and "Book now"/"Reserve" on a page with a details form) are refused here.
3. **Approval card** (`reservation`): what, when, details, price. Button: *Confirm booking*.
4. **Confirm job** (after the tap): restores the session, refills cleared fields, and presses the final button once, only while the page still shows the approved date/time (and price). A gone/changed slot stops it ("slot isn't on the page any more") and nothing is booked.

Live test: CURA Healthcare demo (katalon-demo-cura.herokuapp.com, demo login printed on its page) — facility, date and comment filled, refused on *Book Appointment*, card shows 10/12/2026, the confirm job is back on the form signed in. It never presses Book Appointment.

# Sign-in truth and Cloudflare checks

- A sign-in is only reported as done when the page proves it (`src/lib/loginCheck.ts`): the login form is gone or a
  logged-in marker (Log out, My account, Dashboard...) is on the page, it is not a login URL, no Cloudflare check is
  pending, and the browser's own report doesn't say it failed. Otherwise the worker API turns the model's `done` into
  `fail` with `CLOUDFLARE_BLOCKED:` / `NOT_SIGNED_IN:` and the real reason. The chat headline (✓ / ⚠️) is rendered from the
  `site_login` tool status (`ok`, `status`, `reason`), never from the model's text.
- Cloudflare / Turnstile (`src/lib/server/cloudWorker.ts`): the worker detects challenge pages and Turnstile boxes on
  login forms (challenge iframes, `cf-turnstile-response` token), waits, reloads at most twice, then retries the job on
  the next cloud browser in its stealth mode (order Steel > Browserless > Hyperbrowser > Anchor > Browserbase, at most
  3 sessions per job). When the browser has an interactive live view, it does not fail: it pauses, the chat panel says
  "Complete the check, then tap Continue", and it waits up to 5 minutes (the user may finish the check in the live view on
  their own device). Only after that does the job fail with `CLOUDFLARE_BLOCKED` and an honest line. Without a live
  view the old path stays (stealth retries, then `CLOUDFLARE_BLOCKED`).
- Free tiers (checked 2026-11-04): Steel `stealthConfig` works, `solveCaptcha` needs a paid balance; Hyperbrowser
  `useStealth` works, `solveCaptchas` is paid only; Browserless accepts `stealth=true` but its shared IPs get
  Cloudflare's block page on some sites; Anchor's solver needs its paid proxy. With a paid plan, switch the solver on
  with `STEEL_SOLVE_CAPTCHA=1`, `HYPERBROWSER_SOLVE_CAPTCHAS=1`, `BROWSERLESS_SOLVE_CAPTCHAS=1` or `ANCHOR_SOLVE_CAPTCHA=1`.

# Live browser view and Take control

- While a browser job runs (sign-in, auto jobs, checkout, account creation) the chat shows a live panel
  (`src/components/BrowserLiveCard.tsx`, polling `GET /api/browser-jobs/live`): the provider's interactive live view in an
  iframe where one exists, else a screenshot refreshed every ~2 s, plus the current URL, the step log and Stop. Full width
  on phones; tap to expand to full screen. When the job ends it shows the final screenshot and a truthful status.
- Live views (`src/lib/liveView.ts`, checked 2026-11-04 with the real keys on free tiers): Steel `debugUrl` +
  `?interactive=true` (works, frameable), Hyperbrowser `liveUrl` (noVNC, works, frameable), Anchor `live_view_url`
  (session create refused: "Insufficient credits balance"), Browserbase debug URL (no key configured), Browserless
  `Browserless.liveURL` CDP command (not verified: the saved token was refused). Only allow-listed https hosts are framed.
- Take control: `POST /api/browser-jobs/{id}/control` `{action: take|continue|stop}`. Take pauses the agent and the user
  clicks/types in the live view (up to 5 min); Continue hands back and the agent reads the page again. The worker pauses
  on its own (`need_user`) for a Cloudflare check or a captcha it can't pass. Pause/take state: `browser_jobs.control`
  (`agent | paused | user | stop`), `paused_until`; state machine `nextControl()`.
- Long pauses: a Vercel worker run lasts ~270 s. When a paused job's run is nearly over, the open provider session
  (Steel, Hyperbrowser, Anchor, Browserbase) is handed to the next run (`browser_jobs.resume`, job back to `queued`, the
  worker kicks itself); the page stays as the user left it. Browserless sessions can't be resumed.
- Migration `0017_browser_live.sql` (applied on production 2026-11-04).
