// @vitest-environment node
// The per-user Meta connect flow end to end: /api/connectors/meta/start redirects to the Facebook
// dialog; the callback exchanges code -> short-lived -> long-lived token and seals the LONG-lived
// one in the user's "meta" connection; /api/social/meta lists the user's Pages (never their access
// tokens) and stores the pick server-side; disconnecting either card removes the meta row.
// Graph is stubbed; every token below is an obvious fixture.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));

process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64"); // test fixture key, not a secret
process.env.META_APP_ID = "meta-app-fixture";
process.env.META_APP_SECRET = "meta-app-secret-fixture";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-fixture";

import { GET as startGET } from "@/app/api/connectors/meta/start/route";
import { GET as callbackGET } from "@/app/api/connectors/meta/callback/route";
import { GET as metaGET, POST as metaPOST, DELETE as metaDELETE } from "@/app/api/social/meta/route";
import { POST as disconnectPOST } from "@/app/api/connectors/[id]/disconnect/route";
import { getStoredCredentials, saveConnection } from "@/lib/connectors/store";
import { META_SCOPES } from "@/lib/socialConfig";

const ME = "66666666-6666-4666-8666-666666666666";
const OTHER = "77777777-7777-4777-8777-777777777777";
const SHORT_TOK = "short-lived-token-fixture";
const LONG_TOK = "long-lived-token-fixture";
const USER_TOK = "user-token-fixture";
const PAGE_TOK_1 = "page-token-one-fixture";
const PAGE_TOK_2 = "page-token-two-fixture";

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const PAGES = {
  data: [
    { id: "111", name: "Page One", "access_token": PAGE_TOK_1, instagram_business_account: { id: "ig-1", username: "pageone" } },
    { id: "222", name: "Page Two", "access_token": PAGE_TOK_2 },
  ],
};

function stubGraph() {
  const calls: { url: string; method: string; body: string }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    calls.push({ url: String(url), method: init?.method ?? "GET", body });
    const u = String(url);
    if (u.includes("/oauth/access_token")) {
      return body.includes("fb_exchange_token")
        ? jsonRes({ "access_token": LONG_TOK, expires_in: 5_184_000 })
        : jsonRes({ "access_token": SHORT_TOK, expires_in: 3600 });
    }
    if (u.includes("/me/accounts")) return jsonRes(PAGES);
    if (u.includes("/me?fields=") || u.includes("/me/permissions")) return jsonRes({ id: "fb-user-1", name: "Test Person" });
    throw new Error(`unexpected fetch ${u}`);
  });
  vi.stubGlobal("fetch", f);
  return calls;
}

async function connectMeta(userId: string) {
  await saveConnection(userId, "meta", {
    creds: { type: "oauth", "access_token": USER_TOK, expires_at: Date.now() + 3_600_000, scope: META_SCOPES.join(" "), meta: { fb_user_id: "fb-user-1", fb_user_name: "Test Person" } },
    accountLabel: "Test Person",
    scopes: [...META_SCOPES],
  });
}

const post = (url: string, body: unknown) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => { h.db = new FakeDb(); h.db.as(ME); stubGraph(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("GET /api/connectors/meta/start", () => {
  it("redirects to the Facebook dialog with the app id, callback and publishing scopes", async () => {
    const r = await startGET(new Request("http://t/api/connectors/meta/start"));
    expect(r.status).toBe(303);
    const loc = r.headers.get("location")!;
    expect(loc).toContain("https://www.facebook.com/v21.0/dialog/oauth");
    const q = new URL(loc).searchParams;
    expect(q.get("client_id")).toBe("meta-app-fixture");
    expect(q.get("redirect_uri")).toBe("http://t/api/connectors/meta/callback");
    expect(q.get("scope")).toContain("pages_manage_posts");
    expect(q.get("scope")).toContain("instagram_content_publish");
    expect(q.get("state")).toBeTruthy();
    expect(loc).not.toContain("meta-app-secret-fixture");
  });

  it("signed out → login redirect; app not configured → setup error", async () => {
    h.db.as(null);
    const r = await startGET(new Request("http://t/api/connectors/meta/start"));
    expect(r.headers.get("location")).toContain("/login?next=/app/connectors");
    h.db.as(ME);
    const saved = process.env.META_APP_ID;
    delete process.env.META_APP_ID;
    try {
      const r2 = await startGET(new Request("http://t/api/connectors/meta/start"));
      expect(r2.headers.get("location")).toContain("error=setup");
    } finally { process.env.META_APP_ID = saved; }
  });
});

describe("GET /api/connectors/meta/callback", () => {
  async function startState(): Promise<string> {
    const r = await startGET(new Request("http://t/api/connectors/meta/start"));
    return new URL(r.headers.get("location")!).searchParams.get("state")!;
  }

  it("exchanges code -> short -> long-lived token and seals the LONG-lived one", async () => {
    const state = await startState();
    const r = await callbackGET(new Request(`http://t/api/connectors/meta/callback?code=CODE1&state=${state}`));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain("/app/connectors?connected=facebook");
    const stored = await getStoredCredentials(ME, "meta");
    expect(stored?.creds.access_token).toBe(LONG_TOK);
    expect(stored?.creds.access_token).not.toBe(SHORT_TOK);
    expect(stored?.creds.expires_at).toBeGreaterThan(Date.now() + 30 * 24 * 3600 * 1000);
    expect(stored?.creds.meta).toMatchObject({ fb_user_id: "fb-user-1", fb_user_name: "Test Person" });
    expect(stored?.info.account_label).toBe("Test Person");
  });

  it("state is single-use: replaying the callback fails with error=state", async () => {
    const state = await startState();
    await callbackGET(new Request(`http://t/api/connectors/meta/callback?code=CODE1&state=${state}`));
    const r = await callbackGET(new Request(`http://t/api/connectors/meta/callback?code=CODE1&state=${state}`));
    expect(r.headers.get("location")).toContain("error=state");
  });

  it("a Facebook error comes back as error=denied and stores nothing", async () => {
    const state = await startState();
    const r = await callbackGET(new Request(`http://t/api/connectors/meta/callback?error=access_denied&state=${state}`));
    expect(r.headers.get("location")).toContain("error=denied");
    expect(await getStoredCredentials(ME, "meta")).toBeNull();
  });

  it("another user's state doesn't work for me", async () => {
    const state = await startState(); // created for ME
    h.db.as(OTHER);
    const r = await callbackGET(new Request(`http://t/api/connectors/meta/callback?code=CODE1&state=${state}`));
    expect(r.headers.get("location")).toContain("error=state");
    expect(await getStoredCredentials(OTHER, "meta")).toBeNull();
  });
});

describe("/api/social/meta (Page picker API)", () => {
  it("signed out → 401", async () => {
    h.db.as(null);
    expect((await metaGET()).status).toBe(401);
    expect((await metaPOST(post("http://t/api/social/meta", { pageId: "111" }))).status).toBe(401);
    expect((await metaDELETE()).status).toBe(401);
  });

  it("GET lists the user's Pages WITHOUT any Page access token", async () => {
    await connectMeta(ME);
    const r = await metaGET();
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain(PAGE_TOK_1);
    expect(text).not.toContain(PAGE_TOK_2);
    expect(text).not.toContain(USER_TOK);
    const j = JSON.parse(text);
    expect(j.status).toMatchObject({ connected: true, accountLabel: "Test Person", page: null });
    expect(j.pages).toEqual([
      { id: "111", name: "Page One", instagram: { id: "ig-1", username: "pageone" } },
      { id: "222", name: "Page Two", instagram: null },
    ]);
  });

  it("POST stores the pick with name/token/IG taken from the API listing, ignoring forged body fields", async () => {
    await connectMeta(ME);
    const r = await metaPOST(post("http://t/api/social/meta", { pageId: "111", pageName: "Forged", pageToken: "forged-token" }));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.status.page).toEqual({ id: "111", name: "Page One" });
    expect(j.status.instagram).toEqual({ id: "ig-1", username: "pageone" });
    const stored = await getStoredCredentials(ME, "meta");
    expect(stored?.creds.meta?.page_access_token).toBe(PAGE_TOK_1);
    expect(JSON.stringify(j)).not.toContain(PAGE_TOK_1);
  });

  it("POST rejects a Page id that isn't on the connected account", async () => {
    await connectMeta(ME);
    expect((await metaPOST(post("http://t/api/social/meta", { pageId: "999" }))).status).toBe(400);
    expect((await getStoredCredentials(ME, "meta"))?.creds.meta?.page_id).toBeUndefined();
  });

  it("DELETE clears the choice; the connection itself stays", async () => {
    await connectMeta(ME);
    await metaPOST(post("http://t/api/social/meta", { pageId: "222" }));
    const r = await metaDELETE();
    expect(r.status).toBe(200);
    expect((await r.json()).status.page).toBeNull();
    expect(await getStoredCredentials(ME, "meta")).not.toBeNull();
  });

  it("a user with no connection sees connected:false and no Pages", async () => {
    const j = await (await metaGET()).json();
    expect(j.status.connected).toBe(false);
    expect(j.pages).toEqual([]);
  });
});

describe("disconnect via either card removes the one meta connection", () => {
  it("POST /api/connectors/facebook/disconnect deletes the meta row (Page choice included)", async () => {
    await connectMeta(ME);
    await metaPOST(post("http://t/api/social/meta", { pageId: "111" }));
    const r = await disconnectPOST(new Request("http://t/api/connectors/facebook/disconnect", { method: "POST" }), { params: Promise.resolve({ id: "facebook" }) });
    expect(r.status).toBe(200);
    expect(await getStoredCredentials(ME, "meta")).toBeNull();
  });

  it("POST /api/connectors/instagram/disconnect does the same", async () => {
    await connectMeta(ME);
    const r = await disconnectPOST(new Request("http://t/api/connectors/instagram/disconnect", { method: "POST" }), { params: Promise.resolve({ id: "instagram" }) });
    expect(r.status).toBe(200);
    expect(await getStoredCredentials(ME, "meta")).toBeNull();
  });
});
