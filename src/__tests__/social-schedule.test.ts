// @vitest-environment node
// Scheduled social posts (migration 0024): validation, the queue operations, and the cron runner —
// due selection, the atomic claim (a double fire never double-posts), status transitions, AI
// auto-generation at publish time (the owner's writer key: NVIDIA preferred, Gemini fallback),
// stale-run recovery and cancel. All network is a fake fetch and all tokens/keys below are obvious
// test fixtures — no real Graph API or AI provider call is ever made.
import { describe, it, expect, beforeAll } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64"); // test fixture key, not a secret

import {
  cancelScheduledPost, claimScheduledPost, createScheduledPost, listScheduledPosts,
  runDueScheduledPosts, scheduledPostProblem, type ScheduledPostInput,
} from "@/lib/server/socialSchedule";
import { saveGeminiKey, saveNvidiaKey } from "@/lib/server/socialKeys";

const PAGE_TOKEN = "TEST_PAGE_TOKEN_fixture";
const GEMINI_KEY = "AIzaTESTKEY_fixture_1234567890";
const ENV = {
  META_FACEBOOK_PAGE_ID: "61596456491904",
  META_FACEBOOK_PAGE_ACCESS_TOKEN: PAGE_TOKEN,
  META_INSTAGRAM_USER_ID: "17841400000000000",
};
const U = "33333333-3333-4333-8333-333333333333";

const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();
const baseInput = (over: Partial<ScheduledPostInput> = {}): ScheduledPostInput => ({
  message: "Scheduled hello",
  targets: ["facebook"],
  autoGenerate: false,
  tone: "announcement",
  scheduledAt: inMs(60_000),
  ...over,
});

type Call = { url: string; method: string; body: string; headers: Record<string, string> };
function fakeFetch(handler: (c: Call) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  const f = (async (url: unknown, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
    const c: Call = { url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? ""), headers: init?.headers ?? {} };
    calls.push(c);
    const out = handler(c);
    return new Response(JSON.stringify(out.json), { status: out.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}
/** Graph happy path for both targets; Gemini is never called by this handler. */
const graphOk = (c: Call) => {
  if (c.url.includes("/media_publish")) return { json: { id: "ig-media-1" } };
  if (c.url.includes("fields=status_code")) return { json: { status_code: "FINISHED" } };
  if (c.url.endsWith("/media")) return { json: { id: "ig-container-1" } };
  if (c.url.includes("/photos")) return { json: { id: "photo-1", post_id: "61596456491904_55" } };
  return { json: { id: "61596456491904_42" } };
};
const feedCalls = (calls: Call[]) => calls.filter((c) => c.url.includes("/feed") || c.url.includes("/photos"));

describe("scheduled post validation", () => {
  const now = new Date();
  it("requires a future time, a target, and valid manual text", () => {
    expect(scheduledPostProblem(baseInput({ scheduledAt: inMs(-60_000) }), now)).toMatch(/future/);
    expect(scheduledPostProblem(baseInput({ scheduledAt: "not-a-date" }), now)).toMatch(/valid date/);
    expect(scheduledPostProblem(baseInput({ targets: [] }), now)).toMatch(/at least one/);
    expect(scheduledPostProblem(baseInput({ message: " " }), now)).toMatch(/text first/);
    expect(scheduledPostProblem(baseInput(), now)).toBeNull();
  });

  it("instagram still needs a public image, and links must be https", () => {
    expect(scheduledPostProblem(baseInput({ targets: ["instagram"] }), now)).toMatch(/image URL/);
    expect(scheduledPostProblem(baseInput({ targets: ["instagram"], imageUrl: "https://cdn.test/a.jpg" }), now)).toBeNull();
    expect(scheduledPostProblem(baseInput({ link: "http://x.test" }), now)).toMatch(/https/);
  });

  it("auto-generate needs a topic instead of finished text", () => {
    expect(scheduledPostProblem(baseInput({ autoGenerate: true, message: "", topic: "" }), now)).toMatch(/topic\/brief/);
    expect(scheduledPostProblem(baseInput({ autoGenerate: true, message: "", topic: "New welcome page" }), now)).toBeNull();
  });
});

describe("queue operations", () => {
  let db: FakeDb;
  beforeAll(() => { db = new FakeDb(); });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = () => db.admin() as any;

  it("create → list shows soonest pending first", async () => {
    const later = await createScheduledPost(admin(), U, baseInput({ message: "later", scheduledAt: inMs(3_600_000) }));
    const sooner = await createScheduledPost(admin(), U, baseInput({ message: "sooner", scheduledAt: inMs(120_000) }));
    const list = await listScheduledPosts(admin(), U);
    expect(list.map((p) => p.id)).toEqual([sooner.id, later.id]);
    expect(list[0]).toMatchObject({ status: "pending", targets: ["facebook"], autoGenerate: false });
  });

  it("cancel works once, only while pending, and only for the owner", async () => {
    const p = await createScheduledPost(admin(), U, baseInput());
    expect(await cancelScheduledPost(admin(), "99999999-9999-4999-8999-999999999999", p.id)).toBe(false);
    expect(await cancelScheduledPost(admin(), U, p.id)).toBe(true);
    expect(await cancelScheduledPost(admin(), U, p.id)).toBe(false);
    const row = db.rows("social_scheduled_posts").find((r) => r.id === p.id);
    expect(row?.status).toBe("cancelled");
  });

  it("the claim is a one-time compare-and-swap", async () => {
    const p = await createScheduledPost(admin(), U, baseInput({ scheduledAt: inMs(-1_000) }));
    const row = db.rows("social_scheduled_posts").find((r) => r.id === p.id)!;
    const snap = { id: String(row.id), scheduled_at: String(row.scheduled_at), attempts: 0 };
    expect(await claimScheduledPost(admin(), snap, new Date())).toBe(true);
    expect(await claimScheduledPost(admin(), snap, new Date())).toBe(false);
    expect(row.status).toBe("publishing");
    expect(row.attempts).toBe(1);
  });
});

describe("cron runner", () => {
  let db: FakeDb;
  beforeAll(() => { db = new FakeDb(); });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = () => db.admin() as any;
  const row = (id: string) => db.rows("social_scheduled_posts").find((r) => r.id === id)!;

  it("publishes a due post once and stores per-target results; a second fire is a no-op", async () => {
    const p = await createScheduledPost(admin(), U, baseInput({ scheduledAt: inMs(-1_000) }));
    const { f, calls } = fakeFetch(graphOk);
    const out = await runDueScheduledPosts(admin(), { env: ENV, fetch: f });
    expect(out.ran).toBe(1);
    expect(row(p.id).status).toBe("published");
    expect(row(p.id).published_at).toBeTruthy();
    expect(row(p.id).results).toMatchObject([{ target: "facebook", ok: true, id: "61596456491904_42" }]);
    expect(feedCalls(calls)).toHaveLength(1);
    const again = await runDueScheduledPosts(admin(), { env: ENV, fetch: f });
    expect(again.ran).toBe(0);
    expect(feedCalls(calls)).toHaveLength(1);
  });

  it("two runners firing at once publish only once (the loser is skipped)", async () => {
    const p = await createScheduledPost(admin(), U, baseInput({ scheduledAt: inMs(-1_000) }));
    const { f, calls } = fakeFetch(graphOk);
    const [a, b] = await Promise.all([
      runDueScheduledPosts(admin(), { env: ENV, fetch: f }),
      runDueScheduledPosts(admin(), { env: ENV, fetch: f }),
    ]);
    expect(feedCalls(calls)).toHaveLength(1);
    expect(row(p.id).status).toBe("published");
    expect([...a.results, ...b.results].filter((r) => r.id === p.id && r.status === "skipped")).toHaveLength(1);
  });

  it("leaves future and cancelled posts alone", async () => {
    const future = await createScheduledPost(admin(), U, baseInput({ scheduledAt: inMs(3_600_000) }));
    const cancelled = await createScheduledPost(admin(), U, baseInput({ scheduledAt: inMs(-1_000) }));
    await cancelScheduledPost(admin(), U, cancelled.id);
    const { f, calls } = fakeFetch(graphOk);
    const out = await runDueScheduledPosts(admin(), { env: ENV, fetch: f });
    expect(out.ran).toBe(0);
    expect(calls).toHaveLength(0);
    expect(row(future.id).status).toBe("pending");
    expect(row(cancelled.id).status).toBe("cancelled");
  });

  it("publishes to facebook + instagram together when an image is set", async () => {
    const p = await createScheduledPost(admin(), U, baseInput({
      targets: ["facebook", "instagram"], imageUrl: "https://cdn.test/a.jpg", scheduledAt: inMs(-1_000),
    }));
    const { f } = fakeFetch(graphOk);
    const out = await runDueScheduledPosts(admin(), { env: ENV, fetch: f });
    expect(out.results).toContainEqual({ id: p.id, status: "published" });
    expect(row(p.id).results).toMatchObject([
      { target: "facebook", ok: true },
      { target: "instagram", ok: true, id: "ig-media-1" },
    ]);
  });

  it("a Graph failure marks the post failed with a mapped error that never leaks the token", async () => {
    const p = await createScheduledPost(admin(), U, baseInput({ scheduledAt: inMs(-1_000) }));
    const { f } = fakeFetch(() => ({ status: 401, json: { error: { message: `Invalid OAuth access token ${PAGE_TOKEN}`, code: 190 } } }));
    const out = await runDueScheduledPosts(admin(), { env: ENV, fetch: f });
    expect(out.results).toContainEqual({ id: p.id, status: "failed" });
    expect(String(row(p.id).error)).toMatch(/rejected the Page access token/);
    expect(JSON.stringify(row(p.id))).not.toContain(PAGE_TOKEN);
  });

  it("with Meta unconfigured the post fails cleanly and no network call is made", async () => {
    const p = await createScheduledPost(admin(), U, baseInput({ scheduledAt: inMs(-1_000) }));
    const { f, calls } = fakeFetch(graphOk);
    await runDueScheduledPosts(admin(), { env: {}, fetch: f });
    expect(row(p.id).status).toBe("failed");
    expect(String(row(p.id).error)).toMatch(/Not set up yet/);
    expect(calls).toHaveLength(0);
  });

  it("a stale 'publishing' row is failed as interrupted, never re-posted", async () => {
    const stale = {
      id: "44444444-4444-4444-8444-444444444444", user_id: U, message: "half-published", link: null, image_url: null,
      targets: ["facebook"], auto_generate: false, topic: null, tone: null,
      scheduled_at: inMs(-3_600_000), status: "publishing", results: null, error: null, attempts: 1,
      published_at: null, created_at: inMs(-3_600_000), updated_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    };
    db.rows("social_scheduled_posts").push(stale);
    const { f, calls } = fakeFetch(graphOk);
    await runDueScheduledPosts(admin(), { env: ENV, fetch: f });
    expect(stale.status).toBe("failed");
    expect(String(stale.error)).toMatch(/interrupted/);
    expect(calls).toHaveLength(0);
  });
});

describe("cron runner with a Blogger target", () => {
  let db: FakeDb;
  beforeAll(() => { db = new FakeDb(); });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = () => db.admin() as any;
  const row = (id: string) => db.rows("social_scheduled_posts").find((r) => r.id === id)!;
  const BLOGGER_TOKEN = "ya29.TEST_SCHEDULE_TOKEN_fixture";
  const readySetup = { ready: true as const, accessToken: BLOGGER_TOKEN, blogId: "987654321", blogName: "Test Blog" };
  const bloggerCalls = (calls: Call[]) => calls.filter((c) => c.url.includes("/blogger/v3/"));
  const bloggerOk = (c: Call) => (c.url.includes("googleapis.com") ? { json: { id: "post-55", url: "https://testblog.example.com/post-55" } } : graphOk(c));

  it("a due blogger post is claimed and published exactly once; a second fire is a no-op", async () => {
    const p = await createScheduledPost(admin(), U, baseInput({ targets: ["blogger"], title: "Scheduled title", scheduledAt: inMs(-1_000) }));
    const { f, calls } = fakeFetch(bloggerOk);
    const out = await runDueScheduledPosts(admin(), { env: ENV, fetch: f, bloggerFor: async () => readySetup });
    expect(out.ran).toBe(1);
    expect(row(p.id).status).toBe("published");
    expect(row(p.id).results).toMatchObject([{ target: "blogger", ok: true, id: "post-55" }]);
    expect(bloggerCalls(calls)).toHaveLength(1);
    const body = JSON.parse(bloggerCalls(calls)[0].body) as { title: string };
    expect(body.title).toBe("Scheduled title");
    expect(JSON.stringify(row(p.id))).not.toContain(BLOGGER_TOKEN);
    const again = await runDueScheduledPosts(admin(), { env: ENV, fetch: f, bloggerFor: async () => readySetup });
    expect(again.ran).toBe(0);
    expect(bloggerCalls(calls)).toHaveLength(1);
  });

  it("two runners firing at once still publish the blogger post only once", async () => {
    const p = await createScheduledPost(admin(), U, baseInput({ targets: ["blogger"], scheduledAt: inMs(-1_000) }));
    const { f, calls } = fakeFetch(bloggerOk);
    const deps = { env: ENV, fetch: f, bloggerFor: async () => readySetup };
    const [a, b] = await Promise.all([runDueScheduledPosts(admin(), deps), runDueScheduledPosts(admin(), deps)]);
    expect(bloggerCalls(calls)).toHaveLength(1);
    expect(row(p.id).status).toBe("published");
    expect([...a.results, ...b.results].filter((r) => r.id === p.id && r.status === "skipped")).toHaveLength(1);
  });

  it("when the owner's Blogger setup is not ready the post fails with that reason and no Blogger call is made", async () => {
    const p = await createScheduledPost(admin(), U, baseInput({ targets: ["blogger"], scheduledAt: inMs(-1_000) }));
    const { f, calls } = fakeFetch(bloggerOk);
    const out = await runDueScheduledPosts(admin(), {
      env: ENV, fetch: f,
      bloggerFor: async () => ({ ready: false as const, reason: "Blogger is not connected. Connect it on the Social posts page, then try again." }),
    });
    expect(out.results).toContainEqual({ id: p.id, status: "failed" });
    expect(String(row(p.id).error)).toMatch(/not connected/);
    expect(bloggerCalls(calls)).toHaveLength(0);
  });

  it("all three targets together validate, and the title round-trips through the queue view", async () => {
    expect(scheduledPostProblem(baseInput({ targets: ["facebook", "instagram", "blogger"], imageUrl: "https://cdn.test/a.jpg", title: "T" }), new Date())).toBeNull();
    expect(scheduledPostProblem(baseInput({ targets: ["blogger"], title: "x".repeat(201) }), new Date())).toMatch(/title/);
    const p = await createScheduledPost(admin(), U, baseInput({
      targets: ["facebook", "instagram", "blogger"], imageUrl: "https://cdn.test/a.jpg", title: "  Round trip  ", scheduledAt: inMs(3_600_000),
    }));
    const view = (await listScheduledPosts(admin(), U)).find((v) => v.id === p.id)!;
    expect(view.targets).toEqual(["facebook", "instagram", "blogger"]);
    expect(view.title).toBe("Round trip");
  });
});

describe("cron runner with AI auto-generation", () => {
  let db: FakeDb;
  beforeAll(() => { db = new FakeDb(); });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = () => db.admin() as any;
  const row = (id: string) => db.rows("social_scheduled_posts").find((r) => r.id === id)!;

  it("writes the text with the owner's stored key at publish time, then posts it", async () => {
    await saveGeminiKey(admin(), U, GEMINI_KEY, null);
    const p = await createScheduledPost(admin(), U, baseInput({
      autoGenerate: true, message: "", topic: "Announce the new welcome page", scheduledAt: inMs(-1_000),
    }));
    const { f, calls } = fakeFetch((c) => {
      if (c.url.includes("generativelanguage.googleapis.com")) {
        return { json: { candidates: [{ content: { parts: [{ text: "TARGET has a fresh new welcome page. Come say hello." }] } }] } };
      }
      return graphOk(c);
    });
    const out = await runDueScheduledPosts(admin(), { env: ENV, fetch: f });
    expect(out.results).toContainEqual({ id: p.id, status: "published" });
    expect(row(p.id).message).toBe("TARGET has a fresh new welcome page. Come say hello.");
    const geminiCall = calls.find((c) => c.url.includes("generativelanguage.googleapis.com"))!;
    expect(geminiCall.headers["x-goog-api-key"]).toBe(GEMINI_KEY);
    expect(geminiCall.url).not.toContain(GEMINI_KEY);
    const feed = feedCalls(calls)[0];
    expect(new URLSearchParams(feed.body).get("message")).toBe("TARGET has a fresh new welcome page. Come say hello.");
    expect(JSON.stringify(row(p.id))).not.toContain(GEMINI_KEY);
  });

  it("without a saved key the post fails with guidance and nothing is posted", async () => {
    const other = "55555555-5555-4555-8555-555555555555";
    const p = await createScheduledPost(admin(), other, baseInput({
      autoGenerate: true, message: "", topic: "Anything", scheduledAt: inMs(-1_000),
    }));
    const { f, calls } = fakeFetch(graphOk);
    const out = await runDueScheduledPosts(admin(), { env: ENV, fetch: f });
    expect(out.results).toContainEqual({ id: p.id, status: "failed" });
    expect(String(row(p.id).error)).toMatch(/No AI API key is saved/);
    expect(calls).toHaveLength(0);
  });

  it("with only an NVIDIA key saved, the text is written by NVIDIA at publish time", async () => {
    const nvUser = "99999999-9999-4999-8999-999999999999";
    const NV_KEY = "nvapi-TESTKEY_fixture_abcdef";
    await saveNvidiaKey(admin(), nvUser, NV_KEY, null);
    const p = await createScheduledPost(admin(), nvUser, baseInput({
      autoGenerate: true, message: "", topic: "Announce the new welcome page", scheduledAt: inMs(-1_000),
    }));
    const { f, calls } = fakeFetch((c) => {
      if (c.url.includes("integrate.api.nvidia.com")) {
        return { json: { choices: [{ message: { content: "TARGET has a fresh new welcome page. Come say hello." } }] } };
      }
      return graphOk(c);
    });
    const out = await runDueScheduledPosts(admin(), { env: ENV, fetch: f });
    expect(out.results).toContainEqual({ id: p.id, status: "published" });
    expect(row(p.id).message).toBe("TARGET has a fresh new welcome page. Come say hello.");
    const nvCall = calls.find((c) => c.url.includes("integrate.api.nvidia.com"))!;
    expect(nvCall.headers.Authorization).toBe(`Bearer ${NV_KEY}`);
    expect(nvCall.url).not.toContain(NV_KEY);
    expect(calls.some((c) => c.url.includes("generativelanguage.googleapis.com"))).toBe(false);
    expect(JSON.stringify(row(p.id))).not.toContain(NV_KEY);
  });
});
