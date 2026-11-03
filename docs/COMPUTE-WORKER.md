# Compute worker (code, photo edits, video)

Off by default. Turn it on by setting `COMPUTE_WORKER_SECRET` on Vercel and on the worker.

## Why a separate worker
The browser worker holds `SESSION_WORKER_SECRET`, which can read vault items for running browser jobs. Running user
code next to it is a risk. The compute worker holds only `COMPUTE_WORKER_SECRET`, and its endpoint
(`/api/compute/worker`) can do three things: claim a code/video job, add a progress line, finish it. No vault, no saved
sessions, no codes, no links. When it is enabled, the browser worker endpoint stops handing out code/video jobs.

```
chat tool (run_code / edit_image ops / analyze_video)
   -> browser_jobs row (mode code | video, status queued)        <- same queue as before, no migration
   -> compute worker polls POST /api/compute/worker {claim}      (Bearer COMPUTE_WORKER_SECRET)
   -> runs it sandboxed, POST {finish} with output / files / frames
   -> TARGET stores files (private downloads), describes video frames, posts the result into the chat
```

## Sandbox (code jobs)
- Fresh temp folder per job, deleted after; inputs are short-lived signed links to files from the same chat.
- Runs as user `nobody` (the container runs as root only to drop privileges) under `prlimit`:
  memory `CODE_MEMORY_MB` (default 1024; Node gets the same as its heap cap), CPU `CODE_CPU_SEC` (60), file size 50 MB,
  64 processes; wall clock `CODE_TIMEOUT_MS` (60000) kills the whole process group.
- Environment is only `PATH, HOME, TMPDIR, LANG, MPLBACKEND`: no secrets, not even the worker's own.
- Output capped (40 KB), up to 5 files from `out/` (8 MB each) come back as downloads.
- `CODE_NO_NETWORK=1` runs programs without network (`unshare -n`, needs a host that allows it). Default: network on
  (so `requests` works); private / metadata addresses are blocked for input downloads.

## Video
`yt-dlp` downloads the lowest usable quality (max 200 MB) with captions (en / hi), `ffmpeg` takes 6 frames; TARGET's vision
model describes frames + captions (transcript). Normal YouTube videos with speech still use the faster `youtube_transcript`.

## Photo edits
- Exact edits (crop, resize, rotate, flip, black and white, brightness, contrast, blur, format): TARGET builds a fixed
  Pillow script from validated numbers and sends it as a code job (the model never writes that code).
- Creative edits (remove objects, change background): the image API already configured, Pollinations (`POLLINATIONS_KEY`,
  model `POLLINATIONS_EDIT_MODEL`, default `kontext`). Without that key only exact edits work.

## Setup
1. Make a secret: `openssl rand -hex 32` (not the same as `SESSION_WORKER_SECRET`).
2. Vercel -> Settings -> Environment Variables: `COMPUTE_WORKER_SECRET=<it>` -> redeploy.
3. Run the worker on any Docker host that runs containers as root (Render, Railway, Fly.io, a VPS):
   - Render: New > Blueprint > this repo -> service `target-compute` -> set `COMPUTE_WORKER_SECRET`.
   - Docker: `docker build -t target-compute -f worker/compute/Dockerfile worker && docker run -d --restart=always -e COMPUTE_WORKER_SECRET=... target-compute`
   Hugging Face Spaces run as a normal user, so the worker refuses to start there (it can't drop privileges).
4. Test in chat: "python se 2**100 nikaalo" -> a code run result; attach a photo and "isko 500px wide kar do".

To turn it off, remove `COMPUTE_WORKER_SECRET` from Vercel: code/video jobs go back to any worker started with `ENABLE_CODE=1`.
