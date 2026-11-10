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
import { chmod, chown, mkdtemp, readdir, readFile, readlink, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Fix #1: per-job supervisor (subreaper + descendant tracking) wrapped around every program run in a job dir. */
const SUPERVISOR = (() => { try { return fileURLToPath(new URL("./job-supervisor.py", import.meta.url)); } catch { return join(process.cwd(), "worker", "job-supervisor.py"); } })();

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

/** The unprivileged user sandboxed programs are dropped to when the worker runs as root. */
const DROP_UID = 65534, DROP_GID = 65534; // "nobody" / "nogroup"

/**
 * Fix #1 (job isolation): every job gets its own directory under one worker-owned base, instead of loose
 * folders directly in the shared system /tmp. The base and every job dir are mode 0o700 and owned by the
 * user the job itself runs as, so no other local user (and no other job running as a different uid) can
 * traverse into a job dir, and job dir names carry a random mkdtemp suffix — never a sequential counter.
 * Override the base with COMPUTE_JOB_TMPDIR (e.g. a dedicated mount) without changing any code.
 */
export const JOB_TMP_BASE = process.env.COMPUTE_JOB_TMPDIR || join(tmpdir(), "target-compute-jobs");

/** Job dirs currently in use by this worker process; anything else found in the base is a crashed job's leftover. */
const activeJobDirs = new Set();

let supervisorSrc = null;
/**
 * Copy the supervisor into the job dir and return its path there. Running the copy matters: the worker's
 * own filesystem path may not be traversable by the dropped job user, while the job dir is the job user's
 * own 0o700 directory. The copy is placed before any job code runs and the supervisor loads it into memory
 * at exec, so job code modifying the on-disk copy afterwards cannot affect the running supervisor.
 */
export async function placeSupervisor(dir) {
  if (supervisorSrc == null) supervisorSrc = await readFile(SUPERVISOR, "utf8");
  const p = join(dir, ".job-supervisor.py");
  await writeFile(p, supervisorSrc);
  await chmod(p, 0o644).catch(() => {});
  return p;
}

async function ownAndLock(p) {
  // When root, hand the path to the job user so the sandboxed program can use its own dir at 0o700;
  // a root-owned 0o700 dir (the old code "fixed" that with 0o777) is what made every job world-readable.
  if (ROOT) await chown(p, DROP_UID, DROP_GID).catch(() => {});
  await chmod(p, 0o700);
}

export async function ensureJobBase() {
  await mkdir(JOB_TMP_BASE, { recursive: true });
  await ownAndLock(JOB_TMP_BASE);
  return JOB_TMP_BASE;
}

/** Create one job's private directory: random mkdtemp name under the base, mode 0o700, registered as active. */
export async function createJobDir(prefix = "cjob-") {
  await ensureJobBase();
  const dir = await mkdtemp(join(JOB_TMP_BASE, prefix));
  await ownAndLock(dir); // mkdtemp already uses 0o700; chmod again explicitly so the mode is never assumed
  activeJobDirs.add(dir);
  return dir;
}

const within = (p, dir) => p === dir || p.startsWith(dir + sep);

/**
 * Fix #1 (process sweep): find every live process that belongs to one of `dirs` — its cwd is inside a job
 * dir, it inherited the job's environment (sandboxEnv sets HOME/TMPDIR to the job dir, and a detached or
 * setsid child keeps its env even after chdir-ing away), or it descends from a process already matched
 * (which covers children whose cwd/env could not be read). Linux /proc only; returns an empty set elsewhere.
 * Never returns this worker's own pid.
 */
export async function collectJobPids(dirs, { rootPid = null, procRoot = "/proc" } = {}) {
  const targets = (Array.isArray(dirs) ? dirs : [dirs]).filter(Boolean);
  const found = new Set();
  if (!targets.length || process.platform !== "linux") return found;
  const entries = await readdir(procRoot).catch(() => []);
  const ppidOf = new Map();
  for (const name of entries) {
    const pid = Number(name);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    const st = await readFile(join(procRoot, name, "stat"), "utf8").catch(() => "");
    if (st) {
      const rest = st.slice(st.lastIndexOf(")") + 2).split(" ");
      const ppid = Number(rest[1]); // fields after comm: state, ppid, ...
      if (Number.isInteger(ppid)) ppidOf.set(pid, ppid);
    }
    let belongs = rootPid != null && pid === rootPid;
    if (!belongs) {
      const cwd = (await readlink(join(procRoot, name, "cwd")).catch(() => "")).replace(/ \(deleted\)$/, "");
      belongs = !!cwd && targets.some((d) => within(cwd, d));
    }
    if (!belongs) {
      const env = await readFile(join(procRoot, name, "environ")).catch(() => null);
      if (env) {
        const parts = env.toString("utf8").split("\0");
        belongs = targets.some((d) => parts.includes(`TMPDIR=${d}`) || parts.includes(`HOME=${d}`));
      }
    }
    if (belongs) found.add(pid);
  }
  // Descendant closure: a setsid escapee is reparented, so ppid alone misses it — but its children keep
  // pointing at it, and the escapee itself is caught above by cwd/env. Walk down from everything matched.
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, ppid] of ppidOf) if (!found.has(pid) && found.has(ppid)) { found.add(pid); grew = true; }
  }
  return found;
}

/**
 * SIGKILL every process belonging to `dirs` (see collectJobPids) and briefly confirm they are gone.
 * Returns the pids that could not be confirmed dead. Only ever signals pids matched to a job dir.
 */
export async function sweepJobProcesses(dirs, { rootPid = null, settleMs = 600 } = {}) {
  let left = [...(await collectJobPids(dirs, { rootPid }))];
  const deadline = Date.now() + settleMs;
  for (;;) {
    for (const pid of left) { try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ } }
    if (!left.length || Date.now() >= deadline) return left;
    await new Promise((r) => setTimeout(r, 50));
    left = [...(await collectJobPids(dirs, { rootPid }))];
  }
}

/**
 * Fix #1 (stale sweep): before a new job starts, kill and remove leftover job dirs from earlier crashed
 * jobs. Only dirs inside JOB_TMP_BASE that this process is not actively running are touched, and the
 * process sweep behind it only matches processes keyed to those dirs — nothing outside the base is touched.
 */
export async function cleanupStaleJobs(staleMs = Number(process.env.COMPUTE_STALE_MS || 15 * 60 * 1000)) {
  await ensureJobBase();
  const names = await readdir(JOB_TMP_BASE).catch(() => []);
  for (const name of names) {
    if (!/^(cjob|cvid)-/.test(name)) continue;
    const dir = join(JOB_TMP_BASE, name);
    if (activeJobDirs.has(dir)) continue;
    // Age guard: a dir this process is not tracking could still be a live job of ANOTHER worker process
    // sharing the base (or a parallel test process). Only a dir untouched for staleMs — far longer than
    // any single job may run — is treated as a crashed job's leftover.
    const s = await stat(dir).catch(() => null);
    if (!s || !s.isDirectory() || Date.now() - s.mtimeMs < staleMs) continue;
    await sweepJobProcesses([dir]).catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Sweep a finished job's leftover processes, then remove its dir and unregister it. */
export async function destroyJobDir(dir, rootPid = null) {
  if (!dir) return;
  await sweepJobProcesses([dir], { rootPid }).catch(() => {});
  activeJobDirs.delete(dir);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

/**
 * The only environment a sandboxed program sees: a fixed allowlist built from scratch (process.env is
 * never spread into it, so COMPUTE_WORKER_SECRET and anything else the worker inherited cannot leak into
 * a job). HOME and TMPDIR both point inside the job's own private 0o700 directory, so a job's temp files
 * land in its own dir — and the inherited HOME/TMPDIR values double as the marker the process sweep uses
 * to find a job's setsid/detached escapees in /proc.
 */
export function sandboxEnv(cwd) {
  return { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: cwd, TMPDIR: cwd, LANG: "C.UTF-8", MPLBACKEND: "Agg", PYTHONDONTWRITEBYTECODE: "1" };
}

/**
 * Run one program under limits: prlimit (address space, CPU seconds, file size, process count), the unprivileged
 * "nobody" user when we are root, optional no-network (unshare -n, needs CAP_SYS_ADMIN), and a wall-clock kill.
 */
export function sandboxed(cmd, args, { cwd, timeoutMs = LIMITS.wallMs, limits = LIMITS, memLabelMb, noNetwork = process.env.CODE_NO_NETWORK === "1", hasPrlimit = true, supervisor = null } = {}) {
  return new Promise((resolve) => {
    let argv = [cmd, ...args];
    // Fix #1: inside a private job dir, run the program under the job-supervisor.py copy placed in that
    // dir (a child subreaper that tracks and kills every descendant, including setsid escapees, before it
    // exits). It is the innermost wrapper, so prlimit/unshare limits apply to it and are inherited by the
    // whole job tree.
    if (supervisor && cwd && within(cwd, JOB_TMP_BASE)) argv = ["python3", supervisor, ...argv];
    if (hasPrlimit) argv = ["prlimit", `--as=${limits.memBytes}`, `--cpu=${limits.cpuSec}`, `--fsize=${limits.fileBytes}`, `--nproc=${limits.procs}`, "--", ...argv];
    if (noNetwork) argv = ["unshare", "-n", "--", ...argv];
    const drop = ROOT ? { uid: DROP_UID, gid: DROP_GID } : {};
    const p = spawn(argv[0], argv.slice(1), { ...drop, cwd, env: sandboxEnv(cwd), stdio: ["ignore", "pipe", "pipe"], detached: true });
    let out = "", err = "", killed = false;
    const cap = (s, d) => (s.length < limits.outBytes ? (s + d).slice(0, limits.outBytes) : s);
    p.stdout.on("data", (d) => { out = cap(out, d.toString()); });
    p.stderr.on("data", (d) => { err = cap(err, d.toString()); });
    // On timeout give the supervisor a brief grace period on SIGTERM to kill the job's whole tracked
    // tree itself, then SIGKILL the group as a backstop (the post-close sweep below is the third layer).
    let killTimer = null;
    const t = setTimeout(() => {
      killed = true;
      try { process.kill(-p.pid, "SIGTERM"); } catch { p.kill("SIGTERM"); }
      killTimer = setTimeout(() => { try { process.kill(-p.pid, "SIGKILL"); } catch { p.kill("SIGKILL"); } }, 400);
    }, timeoutMs);
    // Fix #1: killing the process group misses children that called setsid (they form a new group) and
    // detached grandchildren. After the root process exits — normally, by limit or by timeout — sweep every
    // survivor still keyed to this job's dir (cwd / inherited TMPDIR+HOME / descent) before reporting done.
    // Only for runs whose cwd is a private job dir: never sweep keyed to a shared dir such as tmpdir().
    const sweepLeftovers = () => (cwd && within(cwd, JOB_TMP_BASE) ? sweepJobProcesses([cwd], { rootPid: p.pid }).catch(() => {}) : Promise.resolve());
    p.on("close", async (code, signal) => {
      clearTimeout(t); if (killTimer) clearTimeout(killTimer);
      await sweepLeftovers();
      if (killed) err += `\n[stopped after ${Math.round(timeoutMs / 1000)}s]`;
      else if (signal === "SIGXCPU" || signal === "SIGKILL") err += `\n[stopped: CPU limit]`;
      if (/MemoryError|Cannot allocate memory|heap out of memory|std::bad_alloc/.test(err)) err += `\n[stopped: memory limit ${memLabelMb ?? Math.round(limits.memBytes / 1048576)} MB]`;
      resolve({ code: code ?? -1, out, err });
    });
    p.on("error", async (e) => { clearTimeout(t); if (killTimer) clearTimeout(killTimer); await sweepLeftovers(); resolve({ code: -1, out, err: String(e.message) }); });
  });
}

async function download(url, file, max = 10 * 1024 * 1024) {
  const r = await fetch(safeUrl(url), { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Couldn't download an input file (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.byteLength > max) throw new Error("An input file is too large");
  await writeFile(file, buf);
  // The worker may run with a restrictive umask (files land 0o660 root-owned, unreadable by the dropped
  // job user); a job's own input files are not secret from the job, so make them explicitly readable.
  await chmod(file, 0o644).catch(() => {});
}

/** A code job: inputs downloaded into a fresh folder, the program run sandboxed, files in out/ returned (max 5). */
export async function runCode(job, opts = {}) {
  await cleanupStaleJobs();
  const dir = await createJobDir("cjob-");
  const supervisor = await placeSupervisor(dir);
  try {
    for (const f of Array.isArray(job.inputs) ? job.inputs : []) await download(f.url, join(dir, String(f.name).replace(/[/\\]/g, "_")));
    await mkdir(join(dir, "out"), { recursive: true });
    await ownAndLock(join(dir, "out")); // 0o700 owned by the job user — never the old world-writable 0o777
    const py = job.language !== "javascript";
    const main = join(dir, py ? "main.py" : "main.mjs");
    await writeFile(main, String(job.code ?? ""));
    await chmod(main, 0o644).catch(() => {}); // readable by the dropped job user regardless of worker umask
    // Node reserves ~1 GB of address space just to start, so JS gets a heap cap (the real memory limit) and a roomier
    // address-space limit; Python gets the address-space limit itself.
    const lim = opts.limits ?? LIMITS;
    const args = py ? [main] : [`--max-old-space-size=${Math.max(64, Math.floor(lim.memBytes / 1048576))}`, main];
    const limits = py ? lim : { ...lim, memBytes: Math.max(lim.memBytes * 2, 2048 * 1048576) };
    const r = await sandboxed(py ? "python3" : "node", args, { cwd: dir, ...opts, limits, memLabelMb: Math.round(lim.memBytes / 1048576), supervisor });
    const files = [];
    for (const name of (await readdir(join(dir, "out")).catch(() => [])).slice(0, 5)) {
      const p = join(dir, "out", name);
      const s = await stat(p);
      if (s.isFile() && s.size > 0 && s.size <= 8 * 1024 * 1024) files.push({ name, base64: (await readFile(p)).toString("base64") });
    }
    const text = [r.out && `Output:\n${r.out.slice(0, 15000)}`, r.err && `Errors:\n${r.err.slice(0, 5000)}`, `Exit code: ${r.code}`].filter(Boolean).join("\n\n");
    return { ok: r.code === 0, result: text, files };
  } finally { await destroyJobDir(dir); }
}

/** A video job: title, captions (the transcript, when the site has one) and 6 evenly spaced frames. */
export async function runVideo(job) {
  await cleanupStaleJobs();
  const dir = await createJobDir("cvid-");
  const supervisor = await placeSupervisor(dir);
  const run = (cmd, args, timeoutMs) => sandboxed(cmd, args, { cwd: dir, timeoutMs, limits: { ...LIMITS, memBytes: 2048 * 1048576, fileBytes: 250 * 1048576, cpuSec: 300 }, supervisor });
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
  } finally { await destroyJobDir(dir); }
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
