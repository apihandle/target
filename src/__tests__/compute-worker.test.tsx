/**
 * Separate compute worker: own secret, off unless set, only code/video jobs, no vault actions; the sandbox runs with
 * an empty environment and limits.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fakeSupabase").FakeDb }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));
vi.mock("@/lib/server/push", () => ({ sendPushToUser: () => Promise.resolve() }));
vi.mock("@/lib/llm", () => ({ llmText: async () => "A cat jumps.", visionModels: () => [] }));

import { POST as compute } from "@/app/api/compute/worker/route";
import { POST as browser } from "@/app/api/browser-jobs/worker/route";
import { computeEnabled } from "@/lib/server/worker";

const U = "11111111-1111-4111-8111-111111111111";
const CODE = "33333333-3333-4333-8333-333333333333";
const AUTO = "44444444-4444-4444-8444-444444444444";
const C_SECRET = "c".repeat(40), B_SECRET = "b".repeat(40);
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ["COMPUTE_WORKER_SECRET", "SESSION_WORKER_SECRET"]) saved[k] = process.env[k];
  process.env.SESSION_WORKER_SECRET = B_SECRET;
  delete process.env.COMPUTE_WORKER_SECRET;
  h.db = new FakeDb({
    browser_jobs: [
      { id: CODE, user_id: U, mode: "code", goal: "math", status: "queued", language: "python", code: "print(2**10)", inputs: [], log: [], conversation_id: "c1", created_at: "2026-11-03T00:00:00Z", allowed_secrets: [] },
      { id: AUTO, user_id: U, mode: "auto", goal: "read", status: "queued", start_url: "https://example.com", inputs: {}, log: [], conversation_id: "c1", created_at: "2026-11-03T00:00:01Z", allowed_secrets: [] },
    ],
    messages: [], conversations: [{ id: "c1", user_id: U }], generated_files: [], vault_secrets: [],
  });
});
afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });

const req = (secret: string, body: Record<string, unknown>, path = "compute/worker") => new Request(`https://t.test/api/${path}`, { method: "POST", headers: { Authorization: `Bearer ${secret}` }, body: JSON.stringify(body) });

describe("compute worker endpoint", () => {
  it("is off unless COMPUTE_WORKER_SECRET is set, and checks it", async () => {
    expect(computeEnabled({})).toBe(false);
    expect((await compute(req(C_SECRET, { action: "claim" }))).status).toBe(503);
    process.env.COMPUTE_WORKER_SECRET = C_SECRET;
    expect((await compute(req(B_SECRET, { action: "claim" }))).status).toBe(401);
    expect((await compute(req(C_SECRET, { action: "claim" }))).status).toBe(200);
  });
  it("only hands out code / video jobs and has no vault or session actions", async () => {
    process.env.COMPUTE_WORKER_SECRET = C_SECRET;
    const { job } = await (await compute(req(C_SECRET, { action: "claim" }))).json();
    expect(job).toMatchObject({ id: CODE, mode: "code", code: "print(2**10)" });
    expect((await (await compute(req(C_SECRET, { action: "claim" }))).json()).job).toBeNull(); // the browser job stays
    for (const action of ["secret", "cookies", "code", "link", "save_session", "next"]) expect((await compute(req(C_SECRET, { action, job_id: CODE }))).status).toBe(400);
    Object.assign(h.db.rows("browser_jobs").find((r) => r.id === AUTO)!, { status: "running" });
    expect((await compute(req(C_SECRET, { action: "finish", job_id: AUTO, status: "done", result: "x" }))).status).toBe(409);
  });
  it("finishes a code job: result and files posted to the chat", async () => {
    process.env.COMPUTE_WORKER_SECRET = C_SECRET;
    await compute(req(C_SECRET, { action: "claim" }));
    const r = await compute(req(C_SECRET, { action: "finish", job_id: CODE, status: "done", result: "Output:\n1024", files: [{ name: "a.csv", base64: Buffer.from("x,y").toString("base64") }] }));
    expect(r.status).toBe(200);
    const j = h.db.rows("browser_jobs").find((x) => x.id === CODE)!;
    expect(j).toMatchObject({ status: "done", result: "Output:\n1024" });
    expect((j.files as { name: string }[])[0].name).toBe("a.csv");
    expect(String(h.db.rows("messages").at(-1)!.content)).toMatch(/Code run done[\s\S]*1024[\s\S]*a\.csv/);
  });
  it("with it on, the browser worker (vault access) no longer gets code jobs", async () => {
    const claim = async () => (await (await browser(req(B_SECRET, { action: "claim", modes: ["code", "video"] }, "browser-jobs/worker"))).json()).job;
    process.env.COMPUTE_WORKER_SECRET = C_SECRET;
    expect(await claim()).toBeNull();
    delete process.env.COMPUTE_WORKER_SECRET;
    expect(await claim()).toMatchObject({ id: CODE });
  });
});

// The sandbox itself (worker/compute-worker.mjs), when python3 and prlimit are available on this machine.
const { execSync } = await import("node:child_process");
const tools = (() => { try { execSync("command -v python3 && command -v prlimit", { stdio: "ignore" }); return true; } catch { return false; } })();

describe.skipIf(!tools)("sandbox", () => {
  it("runs with an empty environment, under memory and time limits", async () => {
    const w = await import("../../worker/compute-worker.mjs");
    process.env.SOME_SECRET = "s3cr3t";
    const lim = { ...w.LIMITS, memBytes: 256 * 1048576, cpuSec: 5 };
    const env = await w.runCode({ language: "python", code: "import os\nprint(sorted(os.environ))\nprint(os.environ.get('SOME_SECRET'))" }, { limits: lim });
    expect(env.result).toContain("['HOME', 'LANG', 'MPLBACKEND', 'PATH', 'PYTHONDONTWRITEBYTECODE', 'TMPDIR']");
    expect(env.result).toContain("None");
    const mem = await w.runCode({ language: "python", code: "x = bytearray(600*1024*1024)" }, { limits: lim });
    expect(mem.ok).toBe(false);
    expect(mem.result).toMatch(/memory limit 256 MB/);
    const slow = await w.runCode({ language: "python", code: "while True: pass" }, { limits: lim, timeoutMs: 2000 });
    expect(slow.result).toMatch(/stopped after 2s/);
    const files = await w.runCode({ language: "python", code: "open('out/r.txt','w').write('ok')\nprint('saved')" }, { limits: lim });
    expect(files).toMatchObject({ ok: true, files: [{ name: "r.txt" }] });
    expect(() => w.safeUrl("http://169.254.169.254/latest")).toThrow(/Blocked/);
    delete process.env.SOME_SECRET;
  }, 30000);
});
