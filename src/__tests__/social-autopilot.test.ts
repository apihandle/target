// @vitest-environment node
// Blogger autopilot (migration 0026): the /api/social/autopilot settings route (signed-in only,
// scoped to the caller's own row, save round-trip, validation) and the cron generation step
// (runBloggerAutopilot) — it queues exactly one Blogger post per opted-in user per run, only when
// every prerequisite is in place (Blogger connected, a blog chosen, a Gemini key saved), never stacks
// on a still-queued post, and one user's failure never stops the others. The generated post then
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
import { saveGeminiKey } from "@/lib/server/socialKeys";
import { saveBloggerBlog } from "@/lib/server/socialBlogger";
import { saveConnection } from "@/lib/connectors/store";
import { BLOGGER_SCOPE } from "@/lib/socialConfig";

const ME = "66666666-6666-4666-8666-666666666666";
const OTHER = "77777777-7777-4777-8777-777777777777";
const THIRD = "88888888-8888-4888-8888-888888888888";
const TOK = "ya29.TEST_AUTOPILOT_TOKEN_fixture";
const GEMINI_KEY = "AIzaTESTKEY_fixture_1234567890";
const BAD_KEY = "AIzaTESTKEY_BAD_fixture_0000000";
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
