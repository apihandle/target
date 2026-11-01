# TARGET worker for a free Hugging Face Space (Docker, CPU basic). Smart browser jobs only:
# Spaces run as a normal user, so code/video jobs stay off (they need root to isolate the secret).
FROM mcr.microsoft.com/playwright:v1.49.1-jammy
WORKDIR /app
RUN npm init -y >/dev/null && npm i playwright@1.49.1 && chmod -R a+rX /app
COPY browser-worker.mjs .
ENV TARGET_URL=https://gettarget.vercel.app PORT=7860 HOME=/tmp
EXPOSE 7860
CMD ["node", "browser-worker.mjs"]
