// @vitest-environment node
// Blogger autopilot (migration 0026): the /api/social/autopilot settings route (signed-in only,
// scoped to the caller's own row, save round-trip, validation) and the cron generation step
// (runBloggerAutopilot) — it queues exactly one Blogger post per opted-in user per run, only when
// every prerequisite is in place (Blogger connected, a blog chosen, an AI writer key saved — NVIDIA
// preferred, Gemini fallback), never stacks on a still-queued post, and one user's failure never
// stops the others; a set-up user whose provider call fails (or who has no key) is named in the
// run's failures with the reason, never silently skipped. The generated post then
// publishes through the ordinary queue drain in the same run. All network is a fake fetch and all
// tokens/keys below are obvious test fixtures.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));

process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64"); // test fixture key, not a secret

import { GET, POST } from "@/app/api/social/autopilot/route";
import { autopilotSettings, runBloggerAutopilot, saveAutopilotSettings } from "@/lib/server/socialAutopilot";
import { createScheduledPost, runDueScheduledPosts } from "@/lib/server/socialSchedule";
import { saveGeminiKey, saveNvidiaKey } from "@/lib/server/socialKeys";
import { saveBloggerBlog } from "@/lib/server/socialBlogger";
import { saveConnection } from "@/lib/connectors/store";
import { BLOGGER_SCOPE } from "@/lib/socialConfig";

const ME = "66666666-6666-4666-8666-666666666666";
const OTHER = "77777777-7777-4777-8777-777777777777";
const THIRD = "88888888-8888-4888-8888-888888888888";
const TOK = "ya29.TEST_AUTOPILOT_TOKEN_fixture";
const GEMINI_KEY = "AIzaTESTKEY_fixture_1234567890";
const BAD_KEY = "AIzaTESTKEY_BAD_fixture_0000000";
const NVIDIA_KEY = "nvapi-TESTKEY_fixture_1234567890";
const NVIDIA_BAD_KEY = "nvapi-TESTKEY_BAD_fixture_0000";
const ENV = { BLOGGER_OAUTH_CLIENT_ID: "blogger-client-fixture", BLOGGER_OAUTH_CLIENT_SECRET: "blogger-secret-fixture" };

const BLOG_TEXT = [
  "TITLE: Five Free AI Tools Worth Trying",
  "",
  "First paragraph about free AI tools and why they matter for everyday work and study.",
  "",
  "Second paragraph with a concrete example of putting one of the tools to work today.",
  "",
  "Third paragraph wrapping up with how to pick the right tool for the job at hand.",
].join("\n");

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const post = (body: unknown) => POST(new Request("http://t/api/social/autopilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = () => h.db.admin() as any;
const queueRows = () => h.db.rows("social_scheduled_posts");

async function connectBlogger(userId: string) {
  await saveConnection(userId, "blogger", {
    creds: { type: "oauth", access_token: TOK, refresh_token: "refresh-fixture", expires_at: Date.now() + 3_600_000, scope: BLOGGER_SCOPE },
    accountLabel: "user@example.com",
    scopes: [BLOGGER_SCOPE],
  });
}

/** Everything autopilot needs, for one user: connection + chosen blog + Gemini key + switch on. */
async function readyUser(userId: string, key: string = GEMINI_KEY, topic = "Free AI tools") {
  await connectBlogger(userId);
  await saveBloggerBlog(admin(), userId, { id: "987654321", name: "Test Blog", url: "https://testblog.example.com/" });
  await saveGeminiKey(admin(), userId, key, null);
  await saveAutopilotSettings(admin(), userId, { enabled: true, topic });
}

/** Everything autopilot needs, with an NVIDIA writer key instead of a Gemini one. */
async function readyUserNvidia(userId: string, key: string = NVIDIA_KEY, topic = "Free AI tools") {
  await connectBlogger(userId);
  await saveBloggerBlog(admin(), userId, { id: "987654321", name: "Test Blog", url: "https://testblog.example.com/" });
  await saveNvidiaKey(admin(), userId, key, null);
  await saveAutopilotSettings(admin(), userId, { enabled: true, topic });
}

/** NVIDIA answers with a well-formed blog post (OpenAI shape), unless the call carries the "bad" fixture key. */
function stubFetchNvidia() {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const f = vi.fn(async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
    const u = String(url);
    calls.push({ url: u, headers: init?.headers ?? {}, body: String(init?.body ?? "") });
    if (u.includes("integrate.api.nvidia.com")) {
      if ((init?.headers?.Authorization ?? "").includes("BAD")) return jsonRes({ detail: "invalid api key" }, 401);
      return jsonRes({ choices: [{ message: { content: BLOG_TEXT } }] });
    }
    throw new Error(`unexpected fetch ${u}`);
  });
  vi.stubGlobal("fetch", f);
  return calls;
}

/** Both providers stubbed (for mixed-key runs): NVIDIA rejects its "bad" fixture key, Gemini answers. */
function stubFetchNvidiaOrGemini() {
  const f = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
    const u = String(url);
    if (u.includes("integrate.api.nvidia.com")) {
      if ((init?.headers?.Authorization ?? "").includes("BAD")) return jsonRes({ detail: "invalid api key" }, 401);
      return jsonRes({ choices: [{ message: { content: BLOG_TEXT } }] });
    }
    if (u.includes("generativelanguage.googleapis.com")) {
      return jsonRes({ candidates: [{ content: { parts: [{ text: BLOG_TEXT }] } }] });
    }
    throw new Error(`unexpected fetch ${u}`);
  });
  vi.stubGlobal("fetch", f);
  return f;
}

/** Gemini answers with a well-formed blog post, unless the call carries the "bad" fixture key. */
function stubFetch(bloggerPublish = false) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const f = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
    const u = String(url);
    calls.push({ url: u, headers: init?.headers ?? {} });
    if (u.includes("generativelanguage.googleapis.com")) {
      if ((init?.headers?.["x-goog-api-key"] ?? "").includes("BAD")) return jsonRes({ error: { message: "boom" } }, 500);
      return jsonRes({ candidates: [{ content: { parts: [{ text: BLOG_TEXT }] } }] });
    }
    if (bloggerPublish && u.includes("/blogger/v3/")) return jsonRes({ id: "post-77", url: "https://testblog.example.com/post-77" });
    throw new Error(`unexpected fetch ${u}`);
  });
  vi.stubGlobal("fetch", f);
  return calls;
}

beforeEach(() => { h.db = new FakeDb(); h.db.as(ME); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("GET/POST /api/social/autopilot", () => {
  it("signed out → 401 for GET and POST", async () => {
    h.db.as(null);
    expect((await GET()).status).toBe(401);
    expect((await post({ enabled: true, topic: "Free AI tools" })).status).toBe(401);
  });

  it("GET before anything is saved → the off default", async () => {
    const j = await (await GET()).json();
    expect(j.autopilot).toEqual({ enabled: false, topic: "" });
  });

  it("POST saves and GET reads it back (round-trip), with the topic trimmed", async () => {
    const r = await post({ enabled: true, topic: "  Free AI tools  " });
    expect(r.status).toBe(200);
    expect((await r.json()).autopilot).toEqual({ enabled: true, topic: "Free AI tools" });
    expect((await (await GET()).json()).autopilot).toEqual({ enabled: true, topic: "Free AI tools" });
    expect(await autopilotSettings(admin(), ME)).toEqual({ enabled: true, topic: "Free AI tools" });
    // Saving again replaces the one row rather than stacking rows.
    await post({ enabled: false, topic: "" });
    expect((await (await GET()).json()).autopilot).toEqual({ enabled: false, topic: "" });
    expect(h.db.rows("social_autopilot_settings")).toHaveLength(1);
  });

  it("turning it on without a topic is a 400 and saves nothing", async () => {
    expect((await post({ enabled: true, topic: "   " })).status).toBe(400);
    expect((await post({ enabled: true })).status).toBe(400);
    expect(h.db.rows("social_autopilot_settings")).toHaveLength(0);
  });

  it("a topic over the limit is a 400", async () => {
    expect((await post({ enabled: false, topic: "x".repeat(501) })).status).toBe(400);
    expect(h.db.rows("social_autopilot_settings")).toHaveLength(0);
  });

  it("one user's settings are invisible to another user", async () => {
    await post({ enabled: true, topic: "Free AI tools" });
    h.db.as(OTHER);
    expect((await (await GET()).json()).autopilot).toEqual({ enabled: false, topic: "" });
    await post({ enabled: true, topic: "Other topic" });
    expect(await autopilotSettings(admin(), ME)).toEqual({ enabled: true, topic: "Free AI tools" });
    expect(await autopilotSettings(admin(), OTHER)).toEqual({ enabled: true, topic: "Other topic" });
  });
});

describe("runBloggerAutopilot (the cron generation step)", () => {
  it("a fully set-up user gets exactly one queued Blogger post with a real title and body", async () => {
    await readyUser(ME);
    stubFetch();
    const out = await runBloggerAutopilot(admin(), { env: ENV });
    expect(out.generated).toBe(1);
    expect(queueRows()).toHaveLength(1);
    const row = queueRows()[0];
    expect(row.user_id).toBe(ME);
    expect(row.targets).toEqual(["blogger"]);
    expect(row.title).toBe("Five Free AI Tools Worth Trying");
    expect(String(row.message)).toContain("First paragraph about free AI tools");
    expect(String(row.message)).not.toContain("TITLE:");
    expect(String(row.message)).not.toContain("<p>");
    expect(row.status).toBe("pending");
    expect(new Date(String(row.scheduled_at)).getTime()).toBeLessThanOrEqual(Date.now());
    expect(JSON.stringify(row)).not.toContain(GEMINI_KEY);
    expect(JSON.stringify(row)).not.toContain(TOK);
  });

  it("a second run while the post is still queued generates nothing (no stacking)", async () => {
    await readyUser(ME);
    stubFetch();
    expect((await runBloggerAutopilot(admin(), { env: ENV })).generated).toBe(1);
    expect((await runBloggerAutopilot(admin(), { env: ENV })).generated).toBe(0);
    expect(queueRows()).toHaveLength(1);
  });

  it("skips a user whose autopilot is off", async () => {
    await readyUser(ME);
    await saveAutopilotSettings(admin(), ME, { enabled: false, topic: "Free AI tools" });
    stubFetch();
    expect((await runBloggerAutopilot(admin(), { env: ENV })).generated).toBe(0);
    expect(queueRows()).toHaveLength(0);
  });

  it("skips a user with no blog chosen yet", async () => {
    await connectBlogger(ME);
    await saveGeminiKey(admin(), ME, GEMINI_KEY, null);
    await saveAutopilotSettings(admin(), ME, { enabled: true, topic: "Free AI tools" });
    stubFetch();
    expect((await runBloggerAutopilot(admin(), { env: ENV })).generated).toBe(0);
    expect(queueRows()).toHaveLength(0);
  });

  it("skips a user whose Blogger is not connected (blog row and key alone are not enough)", async () => {
    await saveBloggerBlog(admin(), ME, { id: "987654321", name: "Test Blog", url: "https://testblog.example.com/" });
    await saveGeminiKey(admin(), ME, GEMINI_KEY, null);
    await saveAutopilotSettings(admin(), ME, { enabled: true, topic: "Free AI tools" });
    stubFetch();
    expect((await runBloggerAutopilot(admin(), { env: ENV })).generated).toBe(0);
    expect(queueRows()).toHaveLength(0);
  });

  it("skips a user with no Gemini key saved", async () => {
    await connectBlogger(ME);
    await saveBloggerBlog(admin(), ME, { id: "987654321", name: "Test Blog", url: "https://testblog.example.com/" });
    await saveAutopilotSettings(admin(), ME, { enabled: true, topic: "Free AI tools" });
    stubFetch();
    expect((await runBloggerAutopilot(admin(), { env: ENV })).generated).toBe(0);
    expect(queueRows()).toHaveLength(0);
  });

  it("skips a user who already has a Blogger post waiting in the queue", async () => {
    await readyUser(ME);
    await createScheduledPost(admin(), ME, {
      message: "A post the user scheduled by hand", targets: ["blogger"], autoGenerate: false,
      tone: "announcement", scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    stubFetch();
    expect((await runBloggerAutopilot(admin(), { env: ENV })).generated).toBe(0);
    expect(queueRows()).toHaveLength(1);
  });

  it("one user's Gemini failure doesn't stop another user's post", async () => {
    await readyUser(ME, BAD_KEY);
    await readyUser(OTHER);
    stubFetch();
    const out = await runBloggerAutopilot(admin(), { env: ENV });
    expect(out.generated).toBe(1);
    expect(queueRows()).toHaveLength(1);
    expect(queueRows()[0].user_id).toBe(OTHER);
  });

  it("generates for several ready users in one run, one post each", async () => {
    await readyUser(ME);
    await readyUser(OTHER);
    await readyUser(THIRD);
    stubFetch();
    const out = await runBloggerAutopilot(admin(), { env: ENV });
    expect(out.generated).toBe(3);
    expect(queueRows()).toHaveLength(3);
    expect(new Set(queueRows().map((r) => r.user_id)).size).toBe(3);
  });

  it("a user with only an NVIDIA key gets a post written by NVIDIA (Bearer header, default model)", async () => {
    await readyUserNvidia(ME);
    const calls = stubFetchNvidia();
    const out = await runBloggerAutopilot(admin(), { env: ENV });
    expect(out.generated).toBe(1);
    expect(out.failures).toEqual([]);
    expect(queueRows()).toHaveLength(1);
    expect(queueRows()[0].title).toBe("Five Free AI Tools Worth Trying");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(calls[0].headers.Authorization).toBe(`Bearer ${NVIDIA_KEY}`);
    expect(JSON.parse(calls[0].body).model).toBe("meta/llama-3.3-70b-instruct");
    expect(JSON.stringify(queueRows()[0])).not.toContain(NVIDIA_KEY);
  });

  it("when both keys are saved, autopilot writes with NVIDIA and never calls Gemini", async () => {
    await readyUser(ME); // Gemini key
    await saveNvidiaKey(admin(), ME, NVIDIA_KEY, null);
    const calls = stubFetchNvidia(); // throws on any non-NVIDIA fetch, Gemini included
    const out = await runBloggerAutopilot(admin(), { env: ENV });
    expect(out.generated).toBe(1);
    expect(calls.every((c) => c.url.includes("integrate.api.nvidia.com"))).toBe(true);
  });

  it("an NVIDIA rejection is SURFACED in the run's failures, not silently skipped", async () => {
    await readyUserNvidia(ME, NVIDIA_BAD_KEY);
    await readyUser(OTHER);
    stubFetchNvidiaOrGemini();
    const out = await runBloggerAutopilot(admin(), { env: ENV });
    expect(out.generated).toBe(1); // OTHER's post still generated — one failure never stops the rest
    expect(queueRows()[0].user_id).toBe(OTHER);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0].userId).toBe(ME);
    expect(out.failures[0].error).toMatch(/NVIDIA rejected the saved API key/);
  });

  it("a set-up user with NO AI key at all is surfaced in failures too (not a quiet skip)", async () => {
    await connectBlogger(ME);
    await saveBloggerBlog(admin(), ME, { id: "987654321", name: "Test Blog", url: "https://testblog.example.com/" });
    await saveAutopilotSettings(admin(), ME, { enabled: true, topic: "Free AI tools" });
    stubFetch();
    const out = await runBloggerAutopilot(admin(), { env: ENV });
    expect(out.generated).toBe(0);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0].error).toMatch(/No AI API key is saved/);
  });

  it("a Gemini rejection is surfaced the same way (fallback provider, same reporting)", async () => {
    await readyUser(ME, BAD_KEY);
    stubFetch();
    const out = await runBloggerAutopilot(admin(), { env: ENV });
    expect(out.generated).toBe(0);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0].error).toMatch(/Gemini/);
  });

  it("end to end: the generated post is published by the same run's queue drain", async () => {
    await readyUser(ME);
    const calls = stubFetch(true);
    const gen = await runBloggerAutopilot(admin(), { env: ENV });
    expect(gen.generated).toBe(1);
    const drain = await runDueScheduledPosts(admin(), { env: ENV });
    expect(drain.ran).toBe(1);
    const row = queueRows()[0];
    expect(row.status).toBe("published");
    expect(row.results).toMatchObject([{ target: "blogger", ok: true, id: "post-77" }]);
    const publish = calls.find((c) => c.url.includes("/blogger/v3/"))!;
    expect(publish.headers.Authorization).toBe(`Bearer ${TOK}`);
    expect(JSON.stringify(row)).not.toContain(TOK);
  });
});
