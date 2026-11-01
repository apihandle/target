#!/usr/bin/env node
/**
 * TARGET worker. Runs OUTSIDE Vercel (Docker on Render/Railway/Fly/a VPS, or your PC), polls TARGET for
 * approved jobs and runs them:
 *   steps -> fixed browser steps          auto  -> smart browser: TARGET's AI picks every click from the screen
 *   code  -> Python / Node sandbox run     video -> download a video, take frames + captions for TARGET to describe
 *
 * Easiest: docker build -t target-worker worker && docker run -e SESSION_WORKER_SECRET=... target-worker
 * Without Docker: npm i playwright && npx playwright install --with-deps chromium
 *   TARGET_URL=https://gettarget.vercel.app SESSION_WORKER_SECRET=... node worker/browser-worker.mjs
 * Code and video jobs run only when ENABLE_CODE=1 (set by the Docker image, which isolates them).
 *
 * Secrets: vault values are fetched one field at a time, only for a running job that lists that item,
 * typed straight into the page and never logged or sent to the AI.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = (process.env.TARGET_URL || "https://gettarget.vercel.app").replace(/\/$/, "");
const SECRET = process.env.SESSION_WORKER_SECRET || "";
const POLL_MS = Number(process.env.POLL_MS || 5000);
// Code runs as the unprivileged "nobody" user so it can't read this process's secret (/proc/<pid>/environ).
const ROOT = typeof process.getuid === "function" && process.getuid() === 0;
const CODE = process.env.ENABLE_CODE === "1" && (ROOT || process.env.ALLOW_UNSAFE_CODE === "1");
if (process.env.ENABLE_CODE === "1" && !CODE) console.warn("Code/video jobs are off: run the worker in Docker (as root) so code can drop to an unprivileged user.");
if (SECRET.length < 32) { console.error("Set SESSION_WORKER_SECRET (32+ chars, same as on Vercel)."); process.exit(1); }
const MODES = CODE ? ["steps", "auto", "code", "video"] : ["steps", "auto"];

async function api(body) {
  const r = await fetch(`${BASE}/api/browser-jobs/worker`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$|metadata\.google\.internal$)/i;
function safeUrl(u) {
  const url = new URL(u);
  if (!/^https?:$/.test(url.protocol) || PRIVATE.test(url.hostname)) throw new Error(`Blocked address: ${url.hostname}`);
  return url.href;
}

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

async function openBrowser() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "en-IN" });
  // Never let a page reach the worker's own network.
  await ctx.route("**/*", (route) => { try { safeUrl(route.request().url()); return route.continue(); } catch { return route.abort(); } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  return { browser, page };
}

// ------------------------------------------------------------------ fixed steps
async function runSteps(job, page) {
  const out = [];
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
  return `Final page: ${await page.title()} (${page.url()})\n\n${out.join("\n\n---\n\n")}`.replace(/\n{3,}/g, "\n\n");
}

// ------------------------------------------------------------------ smart browser
/** Number every visible interactive element and return a compact list the AI can point at. */
async function snapshot(page) {
  const data = await page.evaluate(() => {
    const sel = "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=checkbox], [role=tab], [role=option], [contenteditable=true], summary, label";
    const els = [];
    let i = 0;
    document.querySelectorAll("[data-target-i]").forEach((e) => e.removeAttribute("data-target-i"));
    for (const e of document.querySelectorAll(sel)) {
      const r = e.getBoundingClientRect();
      const st = getComputedStyle(e);
      if (r.width < 2 || r.height < 2 || st.visibility === "hidden" || st.display === "none" || r.bottom < 0 || r.top > innerHeight * 2.5) continue;
      e.setAttribute("data-target-i", String(i));
      const tag = e.tagName.toLowerCase();
      const text = (e.getAttribute("aria-label") || e.innerText || e.getAttribute("placeholder") || e.getAttribute("title") || e.value || e.getAttribute("alt") || "").replace(/\s+/g, " ").trim().slice(0, 110);
      els.push({ i, tag, type: e.getAttribute("type") || undefined, text, name: (e.getAttribute("name") || "").slice(0, 70) || undefined });
      if (++i >= 180) break;
    }
    return { els, text: document.body ? document.body.innerText.replace(/\n{2,}/g, "\n").slice(0, 5500) : "" };
  });
  const shot = (await page.screenshot({ type: "jpeg", quality: 45 }).catch(() => null))?.toString("base64");
  return { url: page.url().slice(0, 2000), title: (await page.title()).slice(0, 290), text: data.text, elements: data.els, ...(shot && shot.length < 390000 ? { screenshot: shot } : {}) };
}

async function runAuto(job, page) {
  await page.goto(safeUrl(job.start_url), { waitUntil: "domcontentloaded" });
  for (let n = 0; n < (job.max_steps || 20) + 2; n++) {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(800);
    const { action: a } = await api({ action: "next", job_id: job.id, snapshot: await snapshot(page) });
    const el = (i) => page.locator(`[data-target-i="${i}"]`).first();
    try {
      if (a.do === "done") return `${a.result}\n\nFinal page: ${await page.title()} (${page.url()})`;
      if (a.do === "fail") throw Object.assign(new Error(a.reason), { final: true });
      if (a.do === "click") await el(a.i).click();
      else if (a.do === "fill") await el(a.i).fill(a.value);
      else if (a.do === "select") await el(a.i).selectOption({ label: a.value }).catch(() => el(a.i).selectOption(a.value));
      else if (a.do === "fill_secret") {
        const { value } = await api({ action: "secret", job_id: job.id, secret_id: a.secret_id, field: a.field });
        await el(a.i).fill(value);
      } else if (a.do === "press") await page.keyboard.press(a.key);
      else if (a.do === "goto") await page.goto(safeUrl(a.url), { waitUntil: "domcontentloaded" });
      else if (a.do === "scroll") await page.mouse.wheel(0, 800);
      else if (a.do === "wait") await page.waitForTimeout(2500);
    } catch (e) {
      if (e.final) throw e;
      console.log(`step failed (${a.do}): ${String(e.message).slice(0, 100)}`); // the AI sees the unchanged page and tries again
    }
  }
  throw new Error("Ran out of steps before finishing");
}

// ------------------------------------------------------------------ sandbox helpers
function sh(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const drop = ROOT ? { uid: 65534, gid: 65534 } : {};
    const p = spawn(cmd, args, { ...drop, cwd: opts.cwd, env: { PATH: process.env.PATH, HOME: opts.cwd || tmpdir(), LANG: "C.UTF-8", MPLBACKEND: "Agg" }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const cap = (s, d) => (s.length < 40000 ? s + d : s);
    p.stdout.on("data", (d) => { out = cap(out, d.toString()); });
    p.stderr.on("data", (d) => { err = cap(err, d.toString()); });
    const t = setTimeout(() => { p.kill("SIGKILL"); err += `\n[stopped after ${(opts.timeout || 60000) / 1000}s]`; }, opts.timeout || 60000);
    p.on("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
    p.on("error", (e) => { clearTimeout(t); resolve({ code: -1, out, err: String(e.message) }); });
  });
}

async function download(url, file, max = 10 * 1024 * 1024) {
  const r = await fetch(safeUrl(url), { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Couldn't download an input file (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.byteLength > max) throw new Error("An input file is too large");
  await writeFile(file, buf);
}

async function runCode(job) {
  const dir = await mkdtemp(join(tmpdir(), "tjob-"));
  try {
    for (const f of job.inputs || []) await download(f.url, join(dir, f.name.replace(/[/\\]/g, "_")));
    await mkdir(join(dir, "out"), { recursive: true });
    await chmod(dir, 0o777); await chmod(join(dir, "out"), 0o777);
    const py = job.language !== "javascript";
    const main = join(dir, py ? "main.py" : "main.mjs");
    await writeFile(main, job.code);
    const r = await sh(py ? "python3" : "node", [main], { cwd: dir, timeout: 60000 });
    const files = [];
    for (const name of (await readdir(join(dir, "out")).catch(() => [])).slice(0, 5)) {
      const p = join(dir, "out", name);
      const s = await stat(p);
      if (s.isFile() && s.size > 0 && s.size <= 8 * 1024 * 1024) files.push({ name, base64: (await readFile(p)).toString("base64") });
    }
    const text = [r.out && `Output:\n${r.out.slice(0, 15000)}`, r.err && `Errors:\n${r.err.slice(0, 5000)}`, `Exit code: ${r.code}`].filter(Boolean).join("\n\n");
    return { ok: r.code === 0, result: text, files };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function runVideo(job) {
  const dir = await mkdtemp(join(tmpdir(), "tvid-"));
  await chmod(dir, 0o777);
  try {
    const url = safeUrl(job.start_url);
    const meta = await sh("yt-dlp", ["--no-playlist", "--print", "%(title)s", "--skip-download", url], { cwd: dir, timeout: 40000 });
    const dl = await sh("yt-dlp", ["--no-playlist", "-f", "worst[height>=240]/worst", "--max-filesize", "200M", "-o", "video.%(ext)s", "--write-subs", "--write-auto-subs", "--sub-langs", "en.*,hi.*", "--sub-format", "vtt", url], { cwd: dir, timeout: 150000 });
    const names = await readdir(dir);
    const video = names.find((n) => n.startsWith("video.") && !n.endsWith(".vtt"));
    if (!video) throw new Error(`Couldn't download the video: ${dl.err.split("\n").filter(Boolean).pop()?.slice(0, 200) || "unknown error"}`);
    const vtt = names.find((n) => n.endsWith(".vtt"));
    const captions = vtt ? [...new Set((await readFile(join(dir, vtt), "utf8")).split("\n").filter((l) => l && !/-->|^WEBVTT|^Kind:|^Language:|^\d+$/.test(l)).map((l) => l.replace(/<[^>]+>/g, "").trim()))].join(" ").slice(0, 15000) : "";
    const probe = await sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", video], { cwd: dir });
    const dur = Math.max(1, Number(probe.out.trim()) || 10);
    const frames = [];
    for (let k = 1; k <= 6; k++) {
      const f = `f${k}.jpg`;
      await sh("ffmpeg", ["-y", "-ss", String((dur * k) / 7), "-i", video, "-frames:v", "1", "-vf", "scale=512:-2", "-q:v", "6", f], { cwd: dir, timeout: 30000 });
      const b = await readFile(join(dir, f)).catch(() => null);
      if (b) frames.push(b.toString("base64"));
    }
    return { title: meta.out.trim().slice(0, 290), captions, frames };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

// ------------------------------------------------------------------ loop
async function run(job) {
  const err = (e) => String(e?.message || e).slice(0, 400);
  try {
    if (job.mode === "code") {
      const r = await runCode(job);
      await api({ action: "finish", job_id: job.id, status: r.ok ? "done" : "failed", result: r.result, files: r.files, ...(r.ok ? {} : { error: r.result.slice(-400) }) });
    } else if (job.mode === "video") {
      const v = await runVideo(job);
      await api({ action: "finish", job_id: job.id, status: "done", ...v });
    } else {
      const { browser, page } = await openBrowser();
      try {
        const result = job.mode === "auto" ? await runAuto(job, page) : await runSteps(job, page);
        await api({ action: "finish", job_id: job.id, status: "done", result });
      } finally { await browser.close(); }
    }
    console.log(`done ${job.mode} ${job.id}`);
  } catch (e) {
    await api({ action: "finish", job_id: job.id, status: "failed", error: err(e) }).catch(() => {});
    console.log(`failed ${job.mode} ${job.id}: ${err(e).slice(0, 120)}`);
  }
}

console.log(`TARGET worker polling ${BASE} every ${POLL_MS / 1000}s for: ${MODES.join(", ")}`);
for (;;) {
  try {
    const { job } = await api({ action: "claim", modes: MODES });
    if (job) { await run(job); continue; }
  } catch (e) { console.log(`poll error: ${e.message}`); }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
