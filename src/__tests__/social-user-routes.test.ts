// @vitest-environment node
// The user-level social twins behind /app/social and the AI key cards on /app/connectors:
// /api/social/key (+ /test), /api/social/generate, /api/social/publish, /api/social/schedule.
// Everything is scoped to the caller: their own writer key drafts (NVIDIA preferred, Gemini
// fallback), their own Page publishes, and a
// user without a Meta connection of their own can never reach the env-configured owner Page.
// Providers are stubbed; all keys/tokens are obvious fixtures.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));

process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64"); // test fixture key, not a secret
process.env.BLOGGER_OAUTH_CLIENT_ID = "blogger-client-fixture";
process.env.BLOGGER_OAUTH_CLIENT_SECRET = "blogger-secret-fixture";
// The env owner Page exists in this fixture env on purpose: the tests prove regular users can't use it.
process.env.META_FACEBOOK_PAGE_ID = "owner-page-fixture";
process.env.META_FACEBOOK_PAGE_ACCESS_TOKEN = "owner-page-token-fixture";
process.env.META_INSTAGRAM_USER_ID = "owner-ig-fixture";

import { GET as keyGET, POST as keyPOST, DELETE as keyDELETE } from "@/app/api/social/key/route";
import { POST as keyTestPOST } from "@/app/api/social/key/test/route";
import { POST as generatePOST } from "@/app/api/social/generate/route";
import { POST as publishPOST } from "@/app/api/social/publish/route";
import { GET as schedGET, POST as schedPOST, DELETE as schedDELETE } from "@/app/api/social/schedule/route";
import { saveConnection } from "@/lib/connectors/store";
import { META_SCOPES } from "@/lib/socialConfig";

const ME = "66666666-6666-4666-8666-666666666666";
const OTHER = "77777777-7777-4777-8777-777777777777";
const KEY_ME = "gemini-key-me-fixture";
const KEY_OTHER = "gemini-key-other-fixture";
const NV_KEY_ME = "nvapi-key-me-fixture";
const PAGE_TOK_ME = "page-token-me-fixture";

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const req = (url: string, body: unknown, method = "POST") => new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

type Call = { url: string; method: string; body: string; headers: Record<string, string> };
function stubNet(handler: (c: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    const c: Call = { url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? ""), headers };
    calls.push(c);
    return handler(c);
  }));
  return calls;
}

async function connectMetaWithPage(userId: string) {
  await saveConnection(userId, "meta", {
    creds: {
      type: "oauth", "access_token": "user-token-me-fixture", expires_at: Date.now() + 3_600_000, scope: META_SCOPES.join(" "),
      meta: { fb_user_name: "Test Person", page_id: "111", page_name: "My Page", "page_access_token": PAGE_TOK_ME, ig_user_id: "ig-me", ig_username: "mypage" },
    },
    accountLabel: "My Page",
    scopes: [...META_SCOPES],
  });
}

beforeEach(() => { h.db = new FakeDb(); h.db.as(ME); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("/api/social/key — per-user Gemini key", () => {
  it("signed out → 401 everywhere", async () => {
    h.db.as(null);
    expect((await keyGET()).status).toBe(401);
    expect((await keyPOST(req("http://t/api/social/key", { apiKey: KEY_ME }))).status).toBe(401);
    expect((await keyTestPOST(req("http://t/api/social/key/test", { apiKey: KEY_ME }))).status).toBe(401);
  });

  it("save → status shows only the masked preview; another user sees nothing saved", async () => {
    const r = await keyPOST(req("http://t/api/social/key", { apiKey: KEY_ME }));
    expect(r.status).toBe(200);
    const j = await (await keyGET()).json();
    expect(j.gemini.saved).toBe(true);
    expect(j.gemini.preview).toBeTruthy();
    expect(JSON.stringify(j)).not.toContain(KEY_ME);
    h.db.as(OTHER);
    const j2 = await (await keyGET()).json();
    expect(j2.gemini.saved).toBe(false);
  });

  it("test checks the pasted key with Google and saves nothing", async () => {
    const calls = stubNet((c) => {
      if (c.url.includes("generativelanguage.googleapis.com/v1beta/models")) return jsonRes({ models: [] });
      throw new Error(`unexpected fetch ${c.url}`);
    });
    const r = await keyTestPOST(req("http://t/api/social/key/test", { apiKey: KEY_ME }));
    expect(r.status).toBe(200);
    expect(calls[0].headers["x-goog-api-key"]).toBe(KEY_ME);
    expect((await (await keyGET()).json()).gemini.saved).toBe(false);
  });

  it("test maps a Google rejection to a plain error", async () => {
    stubNet(() => jsonRes({ error: { message: "bad key" } }, 403));
    const r = await keyTestPOST(req("http://t/api/social/key/test", { apiKey: KEY_ME }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/rejected/);
  });

  it("DELETE removes only the caller's key", async () => {
    await keyPOST(req("http://t/api/social/key", { apiKey: KEY_ME }));
    h.db.as(OTHER);
    await keyPOST(req("http://t/api/social/key", { apiKey: KEY_OTHER }));
    h.db.as(ME);
    await keyDELETE();
    expect((await (await keyGET()).json()).gemini.saved).toBe(false);
    h.db.as(OTHER);
    expect((await (await keyGET()).json()).gemini.saved).toBe(true);
  });
});

describe("/api/social/generate — drafts with the caller's own key", () => {
  it("uses the caller's key in the header and returns the draft", async () => {
    await keyPOST(req("http://t/api/social/key", { apiKey: KEY_ME }));
    const calls = stubNet((c) => {
      if (c.url.includes(":generateContent")) return jsonRes({ candidates: [{ content: { parts: [{ text: "A draft post" }] } }] });
      throw new Error(`unexpected fetch ${c.url}`);
    });
    const r = await generatePOST(req("http://t/api/social/generate", { topic: "Launch day", tone: "announcement" }));
    expect(r.status).toBe(200);
    expect((await r.json()).text).toBe("A draft post");
    expect(calls[0].headers["x-goog-api-key"]).toBe(KEY_ME);
  });

  it("no key saved → 503; another user's key is never used", async () => {
    await keyPOST(req("http://t/api/social/key", { apiKey: KEY_ME })); // ME has a key
    h.db.as(OTHER); // OTHER does not
    const r = await generatePOST(req("http://t/api/social/generate", { topic: "Launch day" }));
    expect(r.status).toBe(503);
  });
});

describe("/api/social/key + /generate — the NVIDIA writer key (migration 0027)", () => {
  it("save with provider nvidia → status shows it under nvidia only; another user sees nothing", async () => {
    const r = await keyPOST(req("http://t/api/social/key", { provider: "nvidia", apiKey: NV_KEY_ME }));
    expect(r.status).toBe(200);
    const j = await (await keyGET()).json();
    expect(j.nvidia.saved).toBe(true);
    expect(j.nvidia.preview).toBeTruthy();
    expect(j.gemini.saved).toBe(false);
    expect(JSON.stringify(j)).not.toContain(NV_KEY_ME);
    h.db.as(OTHER);
    const j2 = await (await keyGET()).json();
    expect(j2.nvidia.saved).toBe(false);
  });

  it("a Gemini save and an NVIDIA save coexist as separate rows", async () => {
    await keyPOST(req("http://t/api/social/key", { apiKey: KEY_ME }));
    await keyPOST(req("http://t/api/social/key", { provider: "nvidia", apiKey: NV_KEY_ME }));
    const j = await (await keyGET()).json();
    expect(j.gemini.saved).toBe(true);
    expect(j.nvidia.saved).toBe(true);
    expect(j.gemini.preview).not.toBe(j.nvidia.preview);
  });

  it("DELETE ?provider=nvidia removes only the NVIDIA key", async () => {
    await keyPOST(req("http://t/api/social/key", { apiKey: KEY_ME }));
    await keyPOST(req("http://t/api/social/key", { provider: "nvidia", apiKey: NV_KEY_ME }));
    const r = await keyDELETE(new Request("http://t/api/social/key?provider=nvidia", { method: "DELETE" }));
    expect(r.status).toBe(200);
    const j = await (await keyGET()).json();
    expect(j.nvidia.saved).toBe(false);
    expect(j.gemini.saved).toBe(true);
  });

  it("an NVIDIA model id with an org/name shape is accepted; a Gemini-shaped save still validates as before", async () => {
    const r = await keyPOST(req("http://t/api/social/key", { provider: "nvidia", apiKey: NV_KEY_ME, model: "meta/llama-3.3-70b-instruct" }));
    expect(r.status).toBe(200);
    expect((await (await keyGET()).json()).nvidia.model).toBe("meta/llama-3.3-70b-instruct");
    const bad = await keyPOST(req("http://t/api/social/key", { apiKey: KEY_ME, model: "meta/llama-3.3-70b-instruct" }));
    expect(bad.status).toBe(400);
  });

  it("test with provider nvidia checks the key at NVIDIA's models endpoint and saves nothing", async () => {
    const calls = stubNet((c) => {
      if (c.url === "https://integrate.api.nvidia.com/v1/models") return jsonRes({ data: [] });
      throw new Error(`unexpected fetch ${c.url}`);
    });
    const r = await keyTestPOST(req("http://t/api/social/key/test", { provider: "nvidia", apiKey: NV_KEY_ME }));
    expect(r.status).toBe(200);
    expect(calls[0].headers["authorization"]).toBe(`Bearer ${NV_KEY_ME}`);
    expect((await (await keyGET()).json()).nvidia.saved).toBe(false);
  });

  it("test with provider nvidia maps a rejection to a plain NVIDIA error", async () => {
    stubNet(() => jsonRes({ detail: "unauthorized" }, 401));
    const r = await keyTestPOST(req("http://t/api/social/key/test", { provider: "nvidia", apiKey: NV_KEY_ME }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/NVIDIA rejected/);
  });

  it("generate uses the NVIDIA key (Bearer header, default model) when one is saved", async () => {
    await keyPOST(req("http://t/api/social/key", { provider: "nvidia", apiKey: NV_KEY_ME }));
    const calls = stubNet((c) => {
      if (c.url === "https://integrate.api.nvidia.com/v1/chat/completions") return jsonRes({ choices: [{ message: { content: "A draft from NVIDIA" } }] });
      throw new Error(`unexpected fetch ${c.url}`);
    });
    const r = await generatePOST(req("http://t/api/social/generate", { topic: "Launch day", tone: "announcement" }));
    expect(r.status).toBe(200);
    expect((await r.json()).text).toBe("A draft from NVIDIA");
    expect(calls[0].headers["authorization"]).toBe(`Bearer ${NV_KEY_ME}`);
    expect(JSON.parse(calls[0].body).model).toBe("meta/llama-3.3-70b-instruct");
  });

  it("generate prefers NVIDIA over Gemini when both are saved", async () => {
    await keyPOST(req("http://t/api/social/key", { apiKey: KEY_ME }));
    await keyPOST(req("http://t/api/social/key", { provider: "nvidia", apiKey: NV_KEY_ME }));
    const calls = stubNet((c) => {
      if (c.url.includes("integrate.api.nvidia.com")) return jsonRes({ choices: [{ message: { content: "NVIDIA draft" } }] });
      if (c.url.includes("generativelanguage.googleapis.com")) return jsonRes({ candidates: [{ content: { parts: [{ text: "Gemini draft" }] } }] });
      throw new Error(`unexpected fetch ${c.url}`);
    });
    const r = await generatePOST(req("http://t/api/social/generate", { topic: "Launch day" }));
    expect(r.status).toBe(200);
    expect((await r.json()).text).toBe("NVIDIA draft");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("integrate.api.nvidia.com");
  });

  it("generate surfaces an NVIDIA rejection as a 502 with the plain reason", async () => {
    await keyPOST(req("http://t/api/social/key", { provider: "nvidia", apiKey: NV_KEY_ME }));
    stubNet(() => jsonRes({ detail: "invalid api key" }, 401));
    const r = await generatePOST(req("http://t/api/social/generate", { topic: "Launch day" }));
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/NVIDIA rejected the saved API key/);
  });
});

describe("/api/social/publish — own accounts only", () => {
  const graphOk = (c: Call) => {
    if (c.url.includes("graph.facebook.com")) return jsonRes({ id: "post-1" });
    throw new Error(`unexpected fetch ${c.url}`);
  };

  it("publishes to the caller's OWN Page with their OWN page token", async () => {
    await connectMetaWithPage(ME);
    const calls = stubNet(graphOk);
    const r = await publishPOST(req("http://t/api/social/publish", { message: "Hello", targets: ["facebook"] }));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.results).toEqual([{ target: "facebook", ok: true, id: "post-1", url: "https://www.facebook.com/post-1" }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/111/feed");
    expect(new URLSearchParams(calls[0].body).get("access_token")).toBe(PAGE_TOK_ME);
  });

  it("a user with NO Meta connection gets a connect-first 400 and nothing is posted — env Page untouched", async () => {
    const calls = stubNet(graphOk);
    const r = await publishPOST(req("http://t/api/social/publish", { message: "Hello", targets: ["facebook"] }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/Connect your own Facebook/);
    expect(calls).toHaveLength(0);
  });

  it("connected but no Page picked → 400 with the pick-a-Page reason, nothing posted", async () => {
    await saveConnection(ME, "meta", {
      creds: { type: "oauth", "access_token": "user-token-me-fixture", expires_at: Date.now() + 3_600_000, scope: META_SCOPES.join(" "), meta: { fb_user_name: "Test Person" } },
      accountLabel: "Test Person",
      scopes: [...META_SCOPES],
    });
    const calls = stubNet(graphOk);
    const r = await publishPOST(req("http://t/api/social/publish", { message: "Hello", targets: ["facebook"] }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/no Facebook Page is chosen/);
    expect(calls).toHaveLength(0);
  });

  it("a Blogger-only post doesn't trip the Meta guard (fails later as not-connected, per target)", async () => {
    stubNet(graphOk);
    const r = await publishPOST(req("http://t/api/social/publish", { message: "Hello", targets: ["blogger"] }));
    expect(r.status).toBe(502);
    const j = await r.json();
    expect(j.results[0]).toMatchObject({ target: "blogger", ok: false });
  });
});

describe("/api/social/schedule — own queue, own destinations", () => {
  const future = () => new Date(Date.now() + 3600_000).toISOString();

  it("a user with their own Page can schedule; the queue is theirs alone; cancel works", async () => {
    await connectMetaWithPage(ME);
    const r = await schedPOST(req("http://t/api/social/schedule", { message: "Later", targets: ["facebook"], scheduledAt: future() }));
    expect(r.status).toBe(200);
    const post = (await r.json()).post;
    expect(post.targets).toEqual(["facebook"]);
    expect((await (await schedGET()).json()).posts).toHaveLength(1);
    h.db.as(OTHER);
    expect((await (await schedGET()).json()).posts).toHaveLength(0);
    h.db.as(ME);
    const del = await schedDELETE(req("http://t/api/social/schedule", { id: post.id }, "DELETE"));
    expect(del.status).toBe(200);
    expect((await (await schedGET()).json()).posts[0].status).toBe("cancelled");
  });

  it("a user without a Meta connection cannot queue a post onto the owner's Page", async () => {
    const r = await schedPOST(req("http://t/api/social/schedule", { message: "Later", targets: ["facebook"], scheduledAt: future() }));
    expect(r.status).toBe(400);
    expect((await (await schedGET()).json()).posts).toHaveLength(0);
  });

  it("a Blogger-only schedule is accepted without any Meta connection", async () => {
    const r = await schedPOST(req("http://t/api/social/schedule", { message: "Later", targets: ["blogger"], scheduledAt: future() }));
    expect(r.status).toBe(200);
  });
});
