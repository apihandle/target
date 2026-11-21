// @vitest-environment node
// GET/POST/DELETE /api/social/blogger: the user-level blog picker behind the Blogger card on
// /app/connectors. Signed-in only, scoped to the caller's own user id, and the chosen blog's
// name/URL always come from the Blogger API listing — never from the request body. The connection
// is seeded through the real saveConnection with a fixture token; the Blogger API is stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));

process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64"); // test fixture key, not a secret
process.env.BLOGGER_OAUTH_CLIENT_ID = "blogger-client-fixture";
process.env.BLOGGER_OAUTH_CLIENT_SECRET = "blogger-secret-fixture";

import { GET, POST, DELETE } from "@/app/api/social/blogger/route";
import { saveConnection } from "@/lib/connectors/store";
import { bloggerSettings } from "@/lib/server/socialBlogger";
import { BLOGGER_SCOPE } from "@/lib/socialConfig";

const ME = "66666666-6666-4666-8666-666666666666";
const OTHER = "77777777-7777-4777-8777-777777777777";
const TOK = "ya29.TEST_BLOGGER_TOKEN_fixture";

const BLOGS = { items: [{ id: "111", name: "Blog One", url: "https://one.example.com/" }, { id: "222", name: "Blog Two", url: "https://two.example.com/" }] };
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const post = (body: unknown) => POST(new Request("http://t/api/social/blogger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = () => h.db.admin() as any;

async function connectBlogger(userId: string) {
  await saveConnection(userId, "blogger", {
    creds: { type: "oauth", access_token: TOK, refresh_token: "refresh-fixture", expires_at: Date.now() + 3_600_000, scope: BLOGGER_SCOPE },
    accountLabel: "user@example.com",
    scopes: [BLOGGER_SCOPE],
  });
}

beforeEach(() => {
  h.db = new FakeDb();
  h.db.as(ME);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/users/self/blogs")) return jsonRes(BLOGS);
    throw new Error(`unexpected fetch ${url}`);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("auth", () => {
  it("signed out → 401 for GET, POST and DELETE", async () => {
    h.db.as(null);
    expect((await GET()).status).toBe(401);
    expect((await post({ blogId: "111" })).status).toBe(401);
    expect((await DELETE()).status).toBe(401);
  });
});

describe("GET", () => {
  it("not connected → status says so, no blogs, no API call", async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.status).toMatchObject({ connected: false, blog: null });
    expect(j.blogs).toEqual([]);
    expect(JSON.stringify(j)).not.toContain(TOK);
  });

  it("connected → the account's blogs are listed for the picker", async () => {
    await connectBlogger(ME);
    const j = await (await GET()).json();
    expect(j.status).toMatchObject({ connected: true, accountLabel: "user@example.com" });
    expect(j.blogs).toEqual([
      { id: "111", name: "Blog One", url: "https://one.example.com/" },
      { id: "222", name: "Blog Two", url: "https://two.example.com/" },
    ]);
    expect(JSON.stringify(j)).not.toContain(TOK);
  });
});

describe("POST (choose a blog)", () => {
  it("saves the choice with the name/URL from the API listing, ignoring any in the body", async () => {
    await connectBlogger(ME);
    const r = await post({ blogId: "222", blogName: "Forged Name", blogUrl: "https://evil.example/" });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.status.blog).toEqual({ blogId: "222", blogName: "Blog Two", blogUrl: "https://two.example.com/" });
    expect(await bloggerSettings(admin(), ME)).toEqual({ blogId: "222", blogName: "Blog Two", blogUrl: "https://two.example.com/" });
  });

  it("rejects a blog id that isn't on the connected account, and an empty choice", async () => {
    await connectBlogger(ME);
    expect((await post({ blogId: "999" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(await bloggerSettings(admin(), ME)).toBeNull();
  });

  it("without a connection the choice can't be saved", async () => {
    const r = await post({ blogId: "111" });
    expect(r.status).toBe(400);
    expect(await bloggerSettings(admin(), ME)).toBeNull();
  });

  it("one user's choice is invisible to another user", async () => {
    await connectBlogger(ME);
    await post({ blogId: "111" });
    expect(await bloggerSettings(admin(), OTHER)).toBeNull();
    h.db.as(OTHER);
    const j = await (await GET()).json();
    expect(j.status.blog).toBeNull();
  });
});

describe("DELETE (forget the choice)", () => {
  it("clears only the caller's choice", async () => {
    await connectBlogger(ME);
    await post({ blogId: "111" });
    const r = await DELETE();
    expect(r.status).toBe(200);
    expect((await r.json()).status.blog).toBeNull();
    expect(await bloggerSettings(admin(), ME)).toBeNull();
  });
});
