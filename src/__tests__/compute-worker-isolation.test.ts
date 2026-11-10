/**
 * Fix #1: compute-worker job isolation.
 *  - each job dir is a random mkdtemp dir under the worker's private base, mode 0o700 (never the old 0o777)
 *  - a child that escapes its process group with setsid is still killed by the /proc sweep after the job
 *  - leftover dirs/processes from crashed jobs are swept before a new job, without touching anything else
 *  - the sandbox environment is a fixed allowlist: nothing the worker inherited can leak into a job
 */
import { describe, it, expect } from "vitest";
import { execSync, spawn } from "node:child_process";
import { mkdtemp, stat } from "node:fs/promises";
import { basename, join } from "node:path";

const w = await import("../../worker/compute-worker.mjs");

const tools = (() => { try { execSync("command -v python3 && command -v prlimit", { stdio: "ignore" }); return true; } catch { return false; } })();
const linux = process.platform === "linux";

const mode = async (p: string) => (await stat(p)).mode & 0o777;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function expectDead(pid: number, ms = 3000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (!alive(pid)) return; await new Promise((r) => setTimeout(r, 50)); }
  expect(alive(pid)).toBe(false);
}

describe("job dirs (fix #1)", () => {
  it("are random mkdtemp dirs under the private base, mode 0o700", async () => {
    const dirs = [await w.createJobDir(), await w.createJobDir(), await w.createJobDir()];
    try {
      expect(await mode(w.JOB_TMP_BASE)).toBe(0o700);
      for (const d of dirs) {
        expect(d.startsWith(w.JOB_TMP_BASE)).toBe(true);
        expect(basename(d)).toMatch(/^cjob-[A-Za-z0-9_-]{6,}$/);
        expect(await mode(d)).toBe(0o700);
      }
      // random suffixes: three dirs, three different names, none a sequential counter
      expect(new Set(dirs).size).toBe(3);
      expect(new Set(dirs.map((d) => basename(d).slice(-6))).size).toBe(3);
    } finally { for (const d of dirs) await w.destroyJobDir(d); }
  });

  it("sandbox env is an allowlist: inherited secrets never reach a job, TMPDIR is the job dir", () => {
    process.env.COMPUTE_WORKER_SECRET = "s".repeat(40);
    try {
      const env = w.sandboxEnv("/some/job-dir");
      expect(env.TMPDIR).toBe("/some/job-dir");
      expect(env.HOME).toBe("/some/job-dir");
      expect("COMPUTE_WORKER_SECRET" in env).toBe(false);
      expect(Object.keys(env).sort()).toEqual(["HOME", "LANG", "MPLBACKEND", "PATH", "PYTHONDONTWRITEBYTECODE", "TMPDIR"]);
    } finally { delete process.env.COMPUTE_WORKER_SECRET; }
  });
});

describe.skipIf(!tools || !linux)("process sweep (fix #1)", () => {
  it("kills a setsid-detached child a job leaves behind, even after it chdirs away", async () => {
    const code = [
      "import subprocess",
      "p = subprocess.Popen(['sleep', '60'], start_new_session=True, cwd='/', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)",
      "open('out/escapee.pid', 'w').write(str(p.pid))",
      "print('spawned')",
    ].join("\n");
    const r = await w.runCode({ language: "python", code }, {});
    expect(r.ok).toBe(true);
    const f = r.files.find((x: { name: string }) => x.name === "escapee.pid");
    expect(f).toBeTruthy();
    const pid = Number(Buffer.from(f!.base64, "base64").toString());
    expect(Number.isInteger(pid)).toBe(true);
    await expectDead(pid); // the job finished normally — its escapee must not survive it
  }, 30000);

  it("kills a setsid escapee even when the job itself has to be timed out", async () => {
    const code = [
      "import subprocess, time",
      "p = subprocess.Popen(['sleep', '60'], start_new_session=True, cwd='/', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)",
      "open('out/escapee.pid', 'w').write(str(p.pid))",
      "time.sleep(60)",
    ].join("\n");
    const r = await w.runCode({ language: "python", code }, { timeoutMs: 1500 });
    expect(r.result).toMatch(/stopped after 2s|stopped after 1s/);
    const f = r.files.find((x: { name: string }) => x.name === "escapee.pid");
    expect(f).toBeTruthy();
    const pid = Number(Buffer.from(f!.base64, "base64").toString());
    await expectDead(pid);
  }, 30000);

  it("concurrent jobs get distinct private dirs and see only their own files", async () => {
    const mk = (tag: string) => [
      "import os, stat, time",
      `open('${tag}-only.txt', 'w').write('${tag}')`,
      "time.sleep(0.5)",
      "print(os.getcwd())",
      "print(oct(stat.S_IMODE(os.stat('.').st_mode)))",
      "print(sorted(x for x in os.listdir('.') if x.endswith('-only.txt')))",
    ].join("\n");
    const [a, b] = await Promise.all([
      w.runCode({ language: "python", code: mk("aaa") }, {}),
      w.runCode({ language: "python", code: mk("bbb") }, {}),
    ]);
    expect(a.ok).toBe(true); expect(b.ok).toBe(true);
    expect(a.result).toContain("0o700"); expect(b.result).toContain("0o700");
    expect(a.result).toContain("aaa-only.txt"); expect(a.result).not.toContain("bbb-only.txt");
    expect(b.result).toContain("bbb-only.txt"); expect(b.result).not.toContain("aaa-only.txt");
    const cwdA = a.result.split("\n").find((l: string) => l.includes("cjob-"))!;
    const cwdB = b.result.split("\n").find((l: string) => l.includes("cjob-"))!;
    expect(cwdA).not.toBe(cwdB);
  }, 30000);

  it("cleanupStaleJobs kills a crashed job's leftover process and removes its dir", async () => {
    await w.ensureJobBase();
    const stale = await mkdtemp(join(w.JOB_TMP_BASE, "cjob-")); // not registered active = crashed job's leftover
    const sleeper = spawn("sleep", ["60"], { cwd: stale, env: { ...process.env, TMPDIR: stale, HOME: stale }, stdio: "ignore" });
    try {
      expect(alive(sleeper.pid!)).toBe(true);
      await w.cleanupStaleJobs(0); // staleMs 0: treat this leftover as old enough (the default is 15 min)
      await expectDead(sleeper.pid!);
      await expect(stat(stale)).rejects.toThrow();
    } finally { if (sleeper.pid && alive(sleeper.pid)) process.kill(sleeper.pid, "SIGKILL"); }
  }, 30000);
});
