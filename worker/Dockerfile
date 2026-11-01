# TARGET worker: smart browser + Python/Node code sandbox + video frames, in one container.
# Deploy on Render / Railway / Fly.io / any VPS. Set SESSION_WORKER_SECRET (same as Vercel) and TARGET_URL.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy
RUN apt-get update && apt-get install -y --no-install-recommends python3-pip ffmpeg && rm -rf /var/lib/apt/lists/* \
 && pip3 install --no-cache-dir pandas numpy matplotlib pillow openpyxl requests yt-dlp
WORKDIR /app
RUN npm init -y >/dev/null && npm i playwright@1.49.1
COPY browser-worker.mjs .
ENV ENABLE_CODE=1 TARGET_URL=https://gettarget.vercel.app
CMD ["node", "browser-worker.mjs"]
