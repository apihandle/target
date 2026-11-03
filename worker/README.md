# TARGET worker

Vercel can't run a browser or code, so these jobs run here:

- **Smart browser**: TARGET's AI looks at each page and decides every click and keystroke (sign-ups, forms, orders).
- **Fixed browser steps**: read JavaScript pages, run exact steps.
- **Code sandbox**: Python (pandas, Pillow, matplotlib) or Node, 60 seconds, files saved to `out/` come back as downloads. Photo edits (crop, resize, filters) use this too.
- **Video**: downloads a video link, takes 6 frames and captions; TARGET describes it.

## Run it 24x7 (recommended: Render)

1. render.com > New > Blueprint > pick this repo (it reads `render.yaml`).
2. Add `SESSION_WORKER_SECRET` (the same 32+ character value as on Vercel). Deploy.

Any Docker host works the same way:
```bash
docker build -t target-worker worker
docker run -d --restart=always -e SESSION_WORKER_SECRET=... target-worker
```

## Without Docker (browser jobs only)
```bash
npm i playwright && npx playwright install --with-deps chromium
TARGET_URL=https://gettarget.vercel.app SESSION_WORKER_SECRET=... node worker/browser-worker.mjs
```
Code and video jobs stay off here, because code must run as a separate unprivileged user.

## Safety
- Anything that clicks or types waits for your approval (an Approve button in chat or Settings, Browser tasks). Store checkouts stop at the pay step and show an approval card (items, total, payment as the page shows them); the pay button is pressed only after the tap, once, and only at that total.
- Private and internal addresses are blocked for pages and every request they make.
- Vault values are fetched one field at a time, only for a running job that lists that item; they are typed into the page and never logged or shown to the AI.
- Code runs as user `nobody` with a clean environment, so it can't read the worker's secret.
