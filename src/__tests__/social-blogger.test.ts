// @vitest-environment node
// Blogger destination plumbing (migration 0025): the per-user blog setting, readiness, publish-setup
// resolution over the standard connector credential store, and the blog listing. The connection is
// seeded through the real saveConnection with an obvious fixture token — no real Google call is made.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));

process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64"); // test fixture key, not a secret

import { saveConnection } from "@/lib/connectors/store";
import { BLOGGER_SCOPE } from "@/lib/socialConfig";
import {
  bloggerReadiness, bloggerSettings, bloggerStatus, clearBloggerBlog, listBloggerBlogs,
  resolveBloggerSetup, saveBloggerBlog,
} from "@/lib/server/socialBlogger";

const U = "66666666-6666-4666-8666-666666666666";
const OTHER = "77777777-7777-4777-8777-777777777777";
const TOK = "ya29.TEST_BLOGGER_TOKEN_fixture";
const ENV = { BLOGGER_OAUTH_CLIENT_ID: "blogger-client-fixture", BLOGGER_OAUTH_CLIENT_SECRET: "blogger-secret-fixture" };

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = () => h.db.admin() as any;

async function connectBlogger(userId: string) {
  await saveConnection(userId, "blogger", {
    creds: { type: "oauth", access_token: TOK, refresh_token: "refresh-fixture", expires_at: Date.now() + 3_600_000, scope: BLOGGER_SCOPE },
    accountLabel: "admin@example.com",
    scopes: [BLOGGER_SCOPE],
  });
}

beforeEach(() => { h.db = new FakeDb(); });

describe("blog setting (social_blogger_settings)", () => {
  it("save → read → replace → clear round-trips, per user", async () => {
    expect(await bloggerSettings(admin(), U)).toBeNull();
    await saveBloggerBlog(admin(), U, { id: "111", name: "Blog One", url: "https://one.example.com/" });
    expect(await bloggerSettings(admin(), U)).toEqual({ blogId: "111", blogName: "Blog One", blogUrl: "https://one.example.com/" });
    await saveBloggerBlog(admin(), U, { id: "222", name: "Blog Two", url: null });
    expect((await bloggerSettings(admin(), U))?.blogId).toBe("222");
    expect(await bloggerSettings(admin(), OTHER)).toBeNull();
    await clearBloggerBlog(admin(), U);
    expect(await bloggerSettings(admin(), U)).toBeNull();
    // The setting holds only the public blog choice — never anything token-shaped.
    expect(JSON.stringify(h.db.rows("social_blogger_settings"))).not.toContain(TOK);
  });
});

describe("readiness + status", () => {
  it("walks env → connection → chosen blog, naming the first gap", async () => {
    expect(await bloggerReadiness(admin(), U, {})).toEqual({ ready: false, reason: "BLOGGER_OAUTH_CLIENT_ID is not set" });
    expect(await bloggerReadiness(admin(), U, ENV)).toEqual({ ready: false, reason: "Blogger is not connected" });
    await connectBlogger(U);
    expect(await bloggerReadiness(admin(), U, ENV)).toEqual({ ready: false, reason: "No blog is chosen yet" });
    await saveBloggerBlog(admin(), U, { id: "111", name: "Blog One", url: null });
    expect(await bloggerReadiness(admin(), U, ENV)).toEqual({ ready: true });
    const st = await bloggerStatus(admin(), U, ENV);
    expect(st).toMatchObject({ oauthConfigured: true, connected: true, accountLabel: "admin@example.com" });
    expect(st.blog).toMatchObject({ blogId: "111", blogName: "Blog One" });
    expect(JSON.stringify(st)).not.toContain(TOK);
  });
});

describe("resolveBloggerSetup (the publish path)", () => {
  it("returns the stored token + chosen blog without any network call while the token is fresh", async () => {
    await connectBlogger(U);
    await saveBloggerBlog(admin(), U, { id: "111", name: "Blog One", url: null });
    const f = vi.fn(async () => jsonRes({})) as unknown as typeof fetch;
    const setup = await resolveBloggerSetup(admin(), U, f, ENV);
    expect(setup).toEqual({ ready: true, accessToken: TOK, blogId: "111", blogName: "Blog One" });
    expect(f).not.toHaveBeenCalled();
  });

  it("explains each not-ready state in one safe sentence", async () => {
    const f = fetch;
    expect(await resolveBloggerSetup(admin(), U, f, {})).toMatchObject({ ready: false });
    const noConn = await resolveBloggerSetup(admin(), U, f, ENV);
    if (!noConn.ready) expect(noConn.reason).toMatch(/not connected/);
    await connectBlogger(U);
    const noBlog = await resolveBloggerSetup(admin(), U, f, ENV);
    if (!noBlog.ready) expect(noBlog.reason).toMatch(/no blog is chosen/);
    // An expired connection row reads as expired, not as a generic failure.
    await saveBloggerBlog(admin(), U, { id: "111", name: "Blog One", url: null });
    const row = h.db.rows("connections").find((r) => r.user_id === U && r.connector_id === "blogger")!;
    row.status = "expired";
    const expired = await resolveBloggerSetup(admin(), U, f, ENV);
    if (!expired.ready) expect(expired.reason).toMatch(/expired/);
    expect(JSON.stringify([noConn, noBlog, expired])).not.toContain(TOK);
  });
});

describe("listBloggerBlogs", () => {
  it("parses the account's blogs; a 401 maps to reconnect guidance without leaking the token", async () => {
    const okFetch = (async () => jsonRes({ items: [{ id: "1", name: "A", url: "https://a.example/" }, { id: "2", name: "B" }] })) as unknown as typeof fetch;
    expect(await listBloggerBlogs(TOK, okFetch)).toEqual({
      ok: true,
      blogs: [{ id: "1", name: "A", url: "https://a.example/" }, { id: "2", name: "B", url: null }],
    });
    const badFetch = (async () => jsonRes({ error: { status: "UNAUTHENTICATED", message: `token ${TOK} invalid` } }, 401)) as unknown as typeof fetch;
    const bad = await listBloggerBlogs(TOK, badFetch);
    expect(bad.ok).toBe(false);
    if (!bad.ok) { expect(bad.error).toMatch(/rejected the Blogger access token/); expect(bad.error).not.toContain(TOK); }
  });
});
