// @vitest-environment node
// The scheduled-post runner with per-user Meta (phase 2): each due post publishes with the POSTING
// user's own Page id + Page token — never another user's, and never the env owner Page when the
// poster has a Meta connection of their own (a connected user who never picked a Page fails with
// the pick-a-Page reason instead of landing on the owner's Page). Graph is stubbed; all tokens are
// obvious fixtures.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));

process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64"); // test fixture key, not a secret

import { saveConnection } from "@/lib/connectors/store";
import { createScheduledPost, runDueScheduledPosts, type ScheduledPostRow } from "@/lib/server/socialSchedule";
import { META_SCOPES } from "@/lib/socialConfig";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PAGE_TOK_A = "page-token-a-fixture";
const PAGE_TOK_B = "page-token-b-fixture";
const OWNER_ENV = {
  META_FACEBOOK_PAGE_ID: "owner-page-fixture",
  META_FACEBOOK_PAGE_ACCESS_TOKEN: "owner-page-token-fixture",
  META_INSTAGRAM_USER_ID: "owner-ig-fixture",
  META_APP_ID: "app-fixture",
  META_APP_SECRET: "app-secret-fixture",
};

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = () => h.db.admin() as any;

async function connectMeta(userId: string, page?: { id: string; tok: string }) {
  await saveConnection(userId, "meta", {
    creds: {
      type: "oauth", "access_token": `user-token-${userId.slice(0, 4)}-fixture`, expires_at: Date.now() + 3_600_000, scope: META_SCOPES.join(" "),
      meta: { fb_user_name: "Test Person", ...(page ? { page_id: page.id, page_name: `Page ${page.id}`, "page_access_token": page.tok } : {}) },
    },
    accountLabel: "Test Person",
    scopes: [...META_SCOPES],
  });
}

async function queuePost(userId: string, at: string, targets: ("facebook" | "blogger")[] = ["facebook"]) {
  return createScheduledPost(admin(), userId, {
    message: `Post for ${userId.slice(0, 4)}`, targets, autoGenerate: false, tone: "announcement", scheduledAt: at,
  });
}

function rowOf(id: string): ScheduledPostRow {
  return (h.db.tables.social_scheduled_posts as ScheduledPostRow[]).find((r) => r.id === id)!;
}

beforeEach(() => { h.db = new FakeDb(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("runDueScheduledPosts with per-user Meta connections", () => {
  it("each post goes out with its owner's Page id + token; a connected user without a Page fails safely", async () => {
    await connectMeta(A, { id: "page-a", tok: PAGE_TOK_A });
    await connectMeta(B, { id: "page-b", tok: PAGE_TOK_B });
    await connectMeta(C); // connected, but no Page picked
    const pa = await queuePost(A, "2026-01-01T10:00:00.000Z");
    const pb = await queuePost(B, "2026-01-01T10:01:00.000Z");
    const pc = await queuePost(C, "2026-01-01T10:02:00.000Z");

    const calls: { url: string; body: string }[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      return jsonRes({ id: `post-${calls.length}` });
    });

    const { results } = await runDueScheduledPosts(admin(), { fetch: f as unknown as typeof fetch, env: OWNER_ENV, now: new Date("2026-01-01T11:00:00.000Z") });
    const byId = Object.fromEntries(results.map((r) => [r.id, r.status]));
    expect(byId[pa.id]).toBe("published");
    expect(byId[pb.id]).toBe("published");
    expect(byId[pc.id]).toBe("failed");

    // Exactly two Graph calls: A's Page with A's token, B's Page with B's token. No owner env values anywhere.
    expect(calls).toHaveLength(2);
    const callA = calls.find((c) => c.url.includes("/page-a/feed"))!;
    const callB = calls.find((c) => c.url.includes("/page-b/feed"))!;
    expect(new URLSearchParams(callA.body).get("access_token")).toBe(PAGE_TOK_A);
    expect(new URLSearchParams(callB.body).get("access_token")).toBe(PAGE_TOK_B);
    for (const c of calls) {
      expect(c.url).not.toContain("owner-page-fixture");
      expect(c.body).not.toContain("owner-page-token-fixture");
    }

    // C's row failed with the pick-a-Page reason (recorded on the row), not a post on the owner's Page.
    expect(rowOf(pc.id).status).toBe("failed");
    expect(rowOf(pc.id).error).toMatch(/no Facebook Page is chosen/);
    expect(rowOf(pa.id).status).toBe("published");
    expect(rowOf(pb.id).status).toBe("published");
  });

  it("a Blogger target still publishes when the same post's Meta side can't (results stay in target order)", async () => {
    await connectMeta(C); // no Page picked -> Meta side fails
    const pc = await queuePost(C, "2026-01-01T10:00:00.000Z", ["facebook", "blogger"]);
    const f = vi.fn(async (url: string) => {
      if (String(url).includes("googleapis.com/blogger")) return jsonRes({ id: "blog-1", url: "https://blog.example/1" });
      throw new Error(`unexpected fetch ${url}`);
    });
    // Blogger isn't connected for C either, so both sides fail — but the run must complete and keep order.
    const { results } = await runDueScheduledPosts(admin(), {
      fetch: f as unknown as typeof fetch, env: OWNER_ENV, now: new Date("2026-01-01T11:00:00.000Z"),
      bloggerFor: async () => ({ ready: true, accessToken: "blogger-token-fixture", blogId: "blog-9", blogName: "Blog" }),
    });
    expect(results).toEqual([{ id: pc.id, status: "published" }]); // blogger published => post counts as published
    const row = rowOf(pc.id);
    expect(row.results?.map((r) => r.target)).toEqual(["facebook", "blogger"]);
    expect(row.results?.[0]).toMatchObject({ target: "facebook", ok: false });
    expect(row.results?.[1]).toMatchObject({ target: "blogger", ok: true, id: "blog-1" });
  });
});
