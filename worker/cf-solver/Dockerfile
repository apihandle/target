# TARGET Turnstile solver (Camoufox). Free on Render: New > Web Service > this repo, Docker, root dir worker/cf-solver.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb libgtk-3-0 libdbus-glib-1-2 libasound2 libx11-xcb1 libxt6 fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "camoufox[geoip]==0.5.9" && python -m camoufox fetch
WORKDIR /app
COPY solver.py .
ENV PORT=8080 PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["python", "solver.py"]
