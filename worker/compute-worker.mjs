#!/usr/bin/env node
/**
 * TARGET compute worker: runs code and video jobs ONLY, separate from the browser worker.
 *   code  -> Python / Node in a sandbox (own temp dir, unprivileged user, CPU / memory / file-size / process limits,
 *            wall-clock timeout, empty environment: no secrets, no TARGET credentials)
 *   video -> download a video link, take frames + captions; TARGET describes them
 * Photo edits with exact numbers (crop, resize, filters) arrive as code jobs built by TARGET (a fixed Pillow script).
 *
 * It holds only COMPUTE_WORKER_SECRET, which can claim and finish code/video jobs and nothing else (no vault,
 * no sessions, no codes). Off unless that secret is set on Vercel and here.
 *
 *   docker build -t target-compute -f worker/compute/Dockerfile worker
 *   docker run -d --restart=always -e COMPUTE_WORKER_SECRET=... target-compute
 */
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

export const LIMITS = {
  wallMs: Number(process.env.CODE_TIMEOUT_MS || 60000),
  cpuSec: Number(process.env.CODE_CPU_SEC || 60),
  memBytes: Number(process.env.CODE_MEMORY_MB || 1024) * 1024 * 1024,
  fileBytes: 50 * 1024 * 1024,
  procs: 64,
  outBytes: 40000,
};

const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$|metadata\.google\.internal$)/i;
export function safeUrl(u) {
  const url = new URL(u);
  if (!/^https?:$/.test(url.protocol) || PRIVATE.test(url.hostname)) throw new Error(`Blocked address: ${url.hostname}`);
  return url.href;
}

const ROOT = typeof process.getuid === "function" && process.getuid() === 0;

/** The only environment a sandboxed program sees. Nothing from this process (no secrets). */
export function sandboxEnv(cwd) {
  return { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: cwd, TMPDIR: cwd, LANG: "C.UTF-8", MPLBACKEND: "Agg", PYTHONDONTWRITEBYTECODE: "1" };
}

/**
 * Run one program under limits: prlimit (address space, CPU seconds, file size, process count), the unprivileged
 * "nobody" user when we are root, optional no-network (unshare -n, needs CAP_SYS_ADMIN), and a wall-clock kill.
 */
export function sandboxed(cmd, args, { cwd, timeoutMs = LIMITS.wallMs, limits = LIMITS, memLabelMb, noNetwork = process.env.CODE_NO_NETWORK === "1", hasPrlimit = true } = {}) {
  return new Promise((resolve) => {
    let argv = [cmd, ...args];
    if (hasPrlimit) argv = ["prlimit", `--as=${limits.memBytes}`, `--cpu=${limits.cpuSec}`, `--fsize=${limits.fileBytes}`, `--nproc=${limits.procs}`, "--", ...argv];
    if (noNetwork) argv = ["unshare", "-n", "--", ...argv];
    const drop = ROOT ? { uid: 65534, gid: 65534 } : {};
    const p = spawn(argv[0], argv.slice(1), { ...drop, cwd, env: sandboxEnv(cwd), stdio: ["ignore", "pipe", "pipe"], detached: true });
    let out = "", err = "", killed = false;
    const cap = (s, d) => (s.length < limits.outBytes ? (s + d).slice(0, limits.outBytes) : s);
    p.stdout.on("data", (d) => { out = cap(out, d.toString()); });
    p.stderr.on("data", (d) => { err = cap(err, d.toString()); });
    const t = setTimeout(() => { killed = true; try { process.kill(-p.pid, "SIGKILL"); } catch { p.kill("SIGKILL"); } }, timeoutMs);
    p.on("close", (code, signal) => {
      clearTimeout(t);
      if (killed) err += `\n[stopped after ${Math.round(timeoutMs / 1000)}s]`;
      else if (signal === "SIGXCPU" || signal === "SIGKILL") err += `\n[stopped: CPU limit]`;
      if (/MemoryError|Cannot allocate memory|heap out of memory|std::bad_alloc/.test(err)) err += `\n[stopped: memory limit ${memLabelMb ?? Math.round(limits.memBytes / 1048576)} MB]`;
      resolve({ code: code ?? -1, out, err });
    });
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

/** A code job: inputs downloaded into a fresh folder, the program run sandboxed, files in out/ returned (max 5). */
export async function runCode(job, opts = {}) {
  const dir = await mkdtemp(join(tmpdir(), "cjob-"));
  try {
    for (const f of Array.isArray(job.inputs) ? job.inputs : []) await download(f.url, join(dir, String(f.name).replace(/[/\\]/g, "_")));
    await mkdir(join(dir, "out"), { recursive: true });
    await chmod(dir, 0o777); await chmod(join(dir, "out"), 0o777);
    const py = job.language !== "javascript";
    const main = join(dir, py ? "main.py" : "main.mjs");
    await writeFile(main, String(job.code ?? ""));
    // Node reserves ~1 GB of address space just to start, so JS gets a heap cap (the real memory limit) and a roomier
    // address-space limit; Python gets the address-space limit itself.
    const lim = opts.limits ?? LIMITS;
    const args = py ? [main] : [`--max-old-space-size=${Math.max(64, Math.floor(lim.memBytes / 1048576))}`, main];
    const limits = py ? lim : { ...lim, memBytes: Math.max(lim.memBytes * 2, 2048 * 1048576) };
    const r = await sandboxed(py ? "python3" : "node", args, { cwd: dir, ...opts, limits, memLabelMb: Math.round(lim.memBytes / 1048576) });
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

/** A video job: title, captions (the transcript, when the site has one) and 6 evenly spaced frames. */
export async function runVideo(job) {
  const dir = await mkdtemp(join(tmpdir(), "cvid-"));
  await chmod(dir, 0o777);
  const run = (cmd, args, timeoutMs) => sandboxed(cmd, args, { cwd: dir, timeoutMs, limits: { ...LIMITS, memBytes: 2048 * 1048576, fileBytes: 250 * 1048576, cpuSec: 300 } });
  try {
    const url = safeUrl(job.start_url);
    const meta = await run("yt-dlp", ["--no-playlist", "--print", "%(title)s", "--skip-download", url], 40000);
    const dl = await run("yt-dlp", ["--no-playlist", "-f", "worst[height>=240]/worst", "--max-filesize", "200M", "-o", "video.%(ext)s", "--write-subs", "--write-auto-subs", "--sub-langs", "en.*,hi.*", "--sub-format", "vtt", url], 150000);
    const names = await readdir(dir);
    const video = names.find((n) => n.startsWith("video.") && !n.endsWith(".vtt"));
    if (!video) throw new Error(`Couldn't download the video: ${dl.err.split("\n").filter(Boolean).pop()?.slice(0, 200) || "unknown error"}`);
    const vtt = names.find((n) => n.endsWith(".vtt"));
    const captions = vtt ? [...new Set((await readFile(join(dir, vtt), "utf8")).split("\n").filter((l) => l && !/-->|^WEBVTT|^Kind:|^Language:|^\d+$/.test(l)).map((l) => l.replace(/<[^>]+>/g, "").trim()))].join(" ").slice(0, 15000) : "";
    const probe = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", video], 30000);
    const dur = Math.max(1, Number(probe.out.trim()) || 10);
    const frames = [];
    for (let k = 1; k <= 6; k++) {
      const f = `f${k}.jpg`;
      await run("ffmpeg", ["-y", "-ss", String((dur * k) / 7), "-i", video, "-frames:v", "1", "-vf", "scale=512:-2", "-q:v", "6", f], 30000);
      const b = await readFile(join(dir, f)).catch(() => null);
      if (b) frames.push(b.toString("base64"));
    }
    return { title: meta.out.trim().slice(0, 290), captions, frames };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

// ------------------------------------------------------------------ loop
async function main() {
  const BASE = (process.env.TARGET_URL || "https://gettarget.vercel.app").replace(/\/$/, "");
  const SECRET = process.env.COMPUTE_WORKER_SECRET || "";
  const POLL_MS = Number(process.env.POLL_MS || 5000);
  if (SECRET.length < 32) { console.error("Set COMPUTE_WORKER_SECRET (32+ chars, same as on Vercel)."); process.exit(1); }
  if (!ROOT && process.env.ALLOW_UNSAFE_CODE !== "1") { console.error("Run as root in the container so code can drop to the unprivileged 'nobody' user (or set ALLOW_UNSAFE_CODE=1 for local tests)."); process.exit(1); }
  const hasPrlimit = (await sandboxed("prlimit", ["--version"], { cwd: tmpdir(), hasPrlimit: false, timeoutMs: 5000 })).code === 0;
  if (!hasPrlimit) console.warn("prlimit not found: memory/CPU limits are off (install util-linux).");
  if (process.env.PORT) createServer((_q, r) => { r.writeHead(200, { "content-type": "text/plain" }); r.end("TARGET compute worker running"); }).listen(Number(process.env.PORT), "0.0.0.0");
  const api = async (body) => {
    const r = await fetch(`${BASE}/api/compute/worker`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  };
  console.log(`TARGET compute worker polling ${BASE} every ${POLL_MS / 1000}s (code ${LIMITS.wallMs / 1000}s / ${LIMITS.memBytes / 1048576} MB)`);
  for (;;) {
    try {
      const { job } = await api({ action: "claim" });
      if (job) {
        try {
          if (job.mode === "code") {
            const r = await runCode(job, { hasPrlimit });
            await api({ action: "finish", job_id: job.id, status: r.ok ? "done" : "failed", result: r.result, files: r.files, ...(r.ok ? {} : { error: r.result.slice(-400) }) });
          } else if (job.mode === "video") {
            await api({ action: "progress", job_id: job.id, line: "Downloading the video" }).catch(() => {});
            await api({ action: "finish", job_id: job.id, status: "done", ...(await runVideo(job)) });
          }
          console.log(`done ${job.mode} ${job.id}`);
        } catch (e) {
          await api({ action: "finish", job_id: job.id, status: "failed", error: String(e?.message || e).slice(0, 400) }).catch(() => {});
          console.log(`failed ${job.mode} ${job.id}`);
        }
        continue;
      }
    } catch (e) { console.log(`poll error: ${e.message}`); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
