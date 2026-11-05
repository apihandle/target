# TARGET Turnstile solver (self-hosted, free)

Camoufox (Firefox anti-detect build) behind a tiny HTTP API, used by TARGET's browser jobs as `CF_SOLVER_URL`.

- `GET /health`
- `GET /turnstile?url=<page url>&sitekey=<0x...>[&action=&cdata=]` with header `x-auth-token: $CF_SOLVER_TOKEN` -> `{ "token": "..." }`
- `GET /clearance?url=` -> `{ cookies, userAgent }` for full-page "Just a moment" challenges (best effort)

`/turnstile` never contacts the target site: the page URL is answered locally with a bare widget page on that
origin, so only challenges.cloudflare.com is reached (sites that block the host's IP, like TimeBucks blocking AWS,
don't matter). TARGET injects the token into the real page and calls the page's callbacks.

Measured 2026-11-05 from an AWS sandbox IP: see docs/CHECKOUT.md (Cloudflare section).

Run: `CF_SOLVER_TOKEN=$(openssl rand -hex 24) python solver.py` (needs `pip install camoufox[geoip] && python -m camoufox fetch`).
Then on Vercel: `CF_SOLVER_URL=https://<host>` and the same `CF_SOLVER_TOKEN`.
