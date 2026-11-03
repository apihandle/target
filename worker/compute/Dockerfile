# TARGET compute worker: code sandbox (Python / Node) + video frames. Separate from the browser worker; it holds only
# COMPUTE_WORKER_SECRET (no vault access). Build from the worker/ folder:
#   docker build -t target-compute -f worker/compute/Dockerfile worker
#   docker run -d --restart=always -e COMPUTE_WORKER_SECRET=... target-compute
# Runs as root on purpose: each program is started as the unprivileged "nobody" user under prlimit limits.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg util-linux ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && pip3 install --no-cache-dir --break-system-packages pandas numpy matplotlib pillow openpyxl requests yt-dlp
WORKDIR /app
COPY compute-worker.mjs .
ENV TARGET_URL=https://gettarget.vercel.app CODE_TIMEOUT_MS=60000 CODE_MEMORY_MB=1024 CODE_CPU_SEC=60
CMD ["node", "compute-worker.mjs"]
