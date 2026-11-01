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
 * Captchas: the worker never breaks them. It sends a screenshot to the owner's phone, they tap or type on it,
 * and the worker repeats those taps on the real page. Sign-ins are remembered: cookies for sites where the
 * task logged in (or the owner helped) are saved encrypted in TARGET and loaded next time.
 *
 * Secrets: vault values are fetched one field at a time, only for a running job that lists that item,
 * typed straight into the page and never logged or sent to the AI.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

const BASE = (process.env.TARGET_URL || "https://gettarget.vercel.app").replace(/\/$/, "");
const SECRET = process.env.SESSION_WORKER_SECRET || "";
const POLL_MS = Number(process.env.POLL_MS || 5000);
const WORKER_ID = (process.env.WORKER_ID || process.env.SPACE_ID || process.env.RENDER_SERVICE_NAME || "default").replace(/[^\w.-]/g, "-").slice(0, 60);
// Code runs as the unprivileged "nobody" user so it can't read this process's secret (/proc/<pid>/environ).
const ROOT = typeof process.getuid === "function" && process.getuid() === 0;
const CODE = process.env.ENABLE_CODE === "1" && (ROOT || process.env.ALLOW_UNSAFE_CODE === "1");
if (process.env.ENABLE_CODE === "1" && !CODE) console.warn("Code/video jobs are off: run the worker in Docker (as root) so code can drop to an unprivileged user.");
if (SECRET.length < 32) { console.error("Set SESSION_WORKER_SECRET (32+ chars, same as on Vercel)."); process.exit(1); }
// Hosts like Hugging Face Spaces need an open web port: answer a tiny health check on PORT when it is set.
if (process.env.PORT) createServer((_q, r) => { r.writeHead(200, { "content-type": "text/plain" }); r.end("TARGET worker running"); }).listen(Number(process.env.PORT), "0.0.0.0");
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

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A short, slightly random pause between actions, the way a person moves through a page. */
const human = (min = 350, max = 1100) => sleep(min + Math.floor(Math.random() * (max - min)));
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

// ------------------------------------------------------------------ remembered sign-ins
async function sessionApi(method, query, body) {
  const r = await fetch(`${BASE}/api/site-sessions/worker${query ? `?${new URLSearchParams(query)}` : ""}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return r.ok ? r.json().catch(() => ({})) : null;
}
async function loadCookies(ctx, userId, host) {
  if (!userId || !host) return false;
  const j = await sessionApi("GET", { user_id: userId, site: host }).catch(() => null);
  if (!j?.cookies?.length) return false;
  await ctx.addCookies(j.cookies.map((c) => ({ ...c, expires: c.expires > 0 ? c.expires : -1 }))).catch(() => {});
  return true;
}
async function saveCookies(ctx, userId, hosts) {
  if (!userId) return;
  const all = await ctx.cookies().catch(() => []);
  for (const host of [...hosts].slice(0, 5)) {
    const mine = all.filter((c) => host === c.domain.replace(/^\./, "") || host.endsWith(`.${c.domain.replace(/^\./, "")}`) || c.domain.replace(/^\./, "").endsWith(`.${host}`));
    if (mine.length) await sessionApi("POST", null, { user_id: userId, site: host, via: "other", cookies: mine.slice(0, 150) }).catch(() => {});
  }
}

async function openBrowser(job) {
  // Plain Chromium that looks like a normal Chrome window (no "controlled by automation" flag).
  const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled", "--no-default-browser-check"] });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
  // Never let a page reach the worker's own network.
  await ctx.route("**/*", (route) => { try { safeUrl(route.request().url()); return route.continue(); } catch { return route.abort(); } });
  // Sites to remember: ones we already had a sign-in for, plus any we log in to or get help on during this task.
  const remember = new Set();
  const start = hostOf(job.start_url);
  if (await loadCookies(ctx, job.user_id, start)) remember.add(start);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  return { browser, ctx, page, remember };
}

// ------------------------------------------------------------------ fixed steps
async function runSteps(job, page, remember) {
  const out = [];
  await page.goto(safeUrl(job.start_url), { waitUntil: "domcontentloaded" });
  for (const s of job.steps || []) {
    if (s.action === "goto") await page.goto(safeUrl(s.url), { waitUntil: "domcontentloaded" });
    else if (s.action === "click") await page.click(s.selector);
    else if (s.action === "fill") await page.fill(s.selector, s.value);
    else if (s.action === "fill_secret") {
      const { value } = await api({ action: "secret", job_id: job.id, secret_id: s.secret_id, field: s.field });
      await page.fill(s.selector, value);
      remember.add(hostOf(page.url()));
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

/** A captcha that is actually showing: a visible challenge frame, or a "verify you're human" page. */
const CAPTCHA_FRAME = /recaptcha|hcaptcha|challenges\.cloudflare\.com|turnstile|arkoselabs|funcaptcha|geo\.captcha-delivery/i;
const CAPTCHA_TEXT = /(verify (that )?you('| a)re (a )?human|i'?m not a robot|are you a robot|complete the security check|press (&|and) hold|unusual traffic from your computer|type the (characters|text) (you see|in the image))/i;
async function captchaShowing(page) {
  const frames = await page.evaluate(() => [...document.querySelectorAll("iframe")].filter((f) => {
    const r = f.getBoundingClientRect(); const st = getComputedStyle(f);
    return r.width >= 100 && r.height >= 60 && st.visibility !== "hidden" && st.display !== "none" && r.bottom > 0 && r.top < innerHeight;
  }).map((f) => f.src || "")).catch(() => []);
  const text = await page.evaluate(() => (document.body ? document.body.innerText.slice(0, 4000) : "")).catch(() => "");
  return frames.some((u) => CAPTCHA_FRAME.test(u)) || CAPTCHA_TEXT.test(text);
}

const HELP_MS = 5 * 60 * 1000;
/** Show the page to the owner and repeat their taps until they press Done (or 5 minutes pass). */
async function askUser(job, page, reason) {
  const vp = page.viewportSize() || { width: 1280, height: 900 };
  const shoot = async () => {
    for (const quality of [55, 30, 15]) {
      const b = (await page.screenshot({ type: "jpeg", quality }).catch(() => null))?.toString("base64");
      if (b && b.length < 390000) return b;
    }
    return null;
  };
  await api({ action: "help", job_id: job.id, reason, screenshot: await shoot(), w: vp.width, h: vp.height });
  console.log(`waiting for the owner: ${reason.slice(0, 80)}`);
  let after = 0, fresh = null, lastShot = Date.now();
  const end = Date.now() + HELP_MS;
  while (Date.now() < end) {
    await sleep(1500);
    if (!fresh && Date.now() - lastShot > 6000) { fresh = await shoot(); lastShot = Date.now(); } // the page may change by itself
    const r = await api({ action: "help_poll", job_id: job.id, after, ...(fresh ? { screenshot: fresh } : {}) });
    fresh = null;
    if (!r.waiting) return;
    for (const i of r.inputs || []) {
      after = i.seq;
      try {
        if (i.t === "done") { await api({ action: "help_end", job_id: job.id }); return; }
        if (i.t === "tap") await page.mouse.click(Math.round(i.x * vp.width), Math.round(i.y * vp.height), { delay: 60 + Math.floor(Math.random() * 80) });
        else if (i.t === "type") await page.keyboard.type(String(i.text).slice(0, 200), { delay: 70 });
        else if (i.t === "key") await page.keyboard.press(i.key);
      } catch (e) { console.log(`help input failed: ${String(e.message).slice(0, 80)}`); }
    }
    if (r.inputs?.length) { await sleep(1200); fresh = await shoot(); lastShot = Date.now(); }
  }
  await api({ action: "help_end", job_id: job.id }).catch(() => {});
  throw Object.assign(new Error("The check on the page wasn't solved within 5 minutes"), { final: true });
}

async function runAuto(job, page, remember) {
  await page.goto(safeUrl(job.start_url), { waitUntil: "domcontentloaded" });
  let asks = 0;
  const help = async (reason) => {
    if (++asks > 3) throw Object.assign(new Error("The site kept asking for a human check"), { final: true });
    remember.add(hostOf(page.url()));
    await askUser(job, page, reason);
    await human(800, 1500);
  };
  for (let n = 0; n < (job.max_steps || 20) + 2; n++) {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await human(700, 1400);
    if (await captchaShowing(page)) { await help("Solve the \"I'm not a robot\" check on this page"); continue; }
    const { action: a } = await api({ action: "next", job_id: job.id, snapshot: await snapshot(page) });
    const el = (i) => page.locator(`[data-target-i="${i}"]`).first();
    const type = async (loc, v) => { if (String(v).length <= 60) { await loc.fill(""); await loc.pressSequentially(String(v), { delay: 45 + Math.floor(Math.random() * 40) }); } else await loc.fill(v); };
    try {
      if (a.do === "done") return `${a.result}\n\nFinal page: ${await page.title()} (${page.url()})`;
      if (a.do === "fail") throw Object.assign(new Error(a.reason), { final: true });
      if (a.do === "ask_user") { await help(a.reason || "Finish the check on this page"); continue; }
      if (a.do === "click") await el(a.i).click();
      else if (a.do === "fill") await type(el(a.i), a.value);
      else if (a.do === "select") await el(a.i).selectOption({ label: a.value }).catch(() => el(a.i).selectOption(a.value));
      else if (a.do === "fill_secret") {
        const { value } = await api({ action: "secret", job_id: job.id, secret_id: a.secret_id, field: a.field });
        await type(el(a.i), value);
        remember.add(hostOf(page.url())); // logged in here: keep the sign-in for next time
      } else if (a.do === "press") await page.keyboard.press(a.key);
      else if (a.do === "goto") await page.goto(safeUrl(a.url), { waitUntil: "domcontentloaded" });
      else if (a.do === "scroll") await page.mouse.wheel(0, 600 + Math.floor(Math.random() * 300));
      else if (a.do === "wait") await sleep(2500);
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
      const { browser, ctx, page, remember } = await openBrowser(job);
      try {
        const result = job.mode === "auto" ? await runAuto(job, page, remember) : await runSteps(job, page, remember);
        await saveCookies(ctx, job.user_id, remember);
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
    const { job } = await api({ action: "claim", modes: MODES, worker_id: WORKER_ID });
    if (job) { await run(job); continue; }
  } catch (e) { console.log(`poll error: ${e.message}`); }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
