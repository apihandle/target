#!/usr/bin/env node
/**
 * TARGET browser worker. Runs OUTSIDE Vercel (your PC, a VPS, Railway, Render...), polls TARGET for
 * approved browser tasks, runs them in headless Chromium and sends back what the page says.
 *
 *   npm i playwright && npx playwright install --with-deps chromium
 *   TARGET_URL=https://gettarget.vercel.app SESSION_WORKER_SECRET=... node worker/browser-worker.mjs
 *
 * Secrets: vault values are fetched one field at a time, only for a fill_secret step of a running job,
 * typed straight into the page and never logged.
 */
import { chromium } from "playwright";

const BASE = (process.env.TARGET_URL || "https://gettarget.vercel.app").replace(/\/$/, "");
const SECRET = process.env.SESSION_WORKER_SECRET || "";
const POLL_MS = Number(process.env.POLL_MS || 10000);
if (SECRET.length < 32) { console.error("Set SESSION_WORKER_SECRET (32+ chars, same as on Vercel)."); process.exit(1); }

async function api(body) {
  const r = await fetch(`${BASE}/api/browser-jobs/worker`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$)/i;
function safeUrl(u) {
  const url = new URL(u);
  if (!/^https?:$/.test(url.protocol) || PRIVATE.test(url.hostname)) throw new Error(`Blocked address: ${url.hostname}`);
  return url.href;
}

async function run(job) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const out = [];
  try {
    await page.goto(safeUrl(job.start_url), { waitUntil: "domcontentloaded" });
    for (const s of job.steps || []) {
      if (s.action === "goto") await page.goto(safeUrl(s.url), { waitUntil: "domcontentloaded" });
      else if (s.action === "click") await page.click(s.selector);
      else if (s.action === "fill") await page.fill(s.selector, s.value);
      else if (s.action === "fill_secret") {
        const { value } = await api({ action: "secret", job_id: job.id, secret_id: s.secret_id, field: s.field });
        await page.fill(s.selector, value);
      } else if (s.action === "press") await page.keyboard.press(s.key);
      else if (s.action === "wait") await page.waitForTimeout(s.ms);
      else if (s.action === "extract") out.push((s.selector ? await page.innerText(s.selector) : await page.innerText("body")).slice(0, 8000));
    }
    if (!out.length) out.push((await page.innerText("body")).slice(0, 8000));
    const result = `Final page: ${await page.title()} (${page.url()})\n\n${out.join("\n\n---\n\n")}`.replace(/\n{3,}/g, "\n\n");
    await api({ action: "finish", job_id: job.id, status: "done", result });
    console.log(`done ${job.id}`);
  } catch (e) {
    await api({ action: "finish", job_id: job.id, status: "failed", error: String(e?.message || e).slice(0, 400) }).catch(() => {});
    console.log(`failed ${job.id}: ${String(e?.message || e).slice(0, 120)}`);
  } finally {
    await browser.close();
  }
}

console.log(`TARGET browser worker polling ${BASE} every ${POLL_MS / 1000}s`);
for (;;) {
  try {
    const { job } = await api({ action: "claim" });
    if (job) { await run(job); continue; }
  } catch (e) { console.log(`poll error: ${e.message}`); }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
