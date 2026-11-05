// @vitest-environment node
// POST/GET /api/feedback: signed-in only, validation + length cap, 10 per hour, own rows only, never admin_note.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.db }));

import { POST, GET } from "@/app/api/feedback/route";
import { resetMemoryLimits } from "@/lib/connectors/rateLimit";
import { cleanPagePath, validateFeedback, FEEDBACK_MAX } from "@/lib/feedback";

const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "bbbbbbbb-0000-4000-8000-000000000002";
let db: FakeDb;

const post = (body: unknown) => POST(new Request("http://t/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY; // in-memory limiter
  resetMemoryLimits();
  db = new FakeDb({ feedback: [{ id: "f-other", user_id: OTHER, message: "theirs", category: "idea", status: "seen", admin_note: "internal", page_path: null, created_at: "2026-11-01T00:00:00Z" }] });
  db.as(ME);
  h.db = db;
});

describe("auth", () => {
  it("signed out → 401 for POST and GET, nothing stored", async () => {
    db.as(null);
    expect((await post({ message: "hello there", category: "bug" })).status).toBe(401);
    expect((await GET(new Request("http://t/api/feedback"))).status).toBe(401);
    expect(db.rows("feedback")).toHaveLength(1);
  });
});

describe("validation", () => {
  it("rejects bad JSON, too short, too long and unknown categories", async () => {
    expect((await post("{nope")).status).toBe(400);
    expect((await post({ message: "  a ", category: "bug" })).status).toBe(400);
    expect((await post({ message: "x".repeat(FEEDBACK_MAX + 1), category: "bug" })).status).toBe(400);
    expect((await post({ message: "hello there", category: "payment" })).status).toBe(400);
    expect(db.rows("feedback")).toHaveLength(1);
  });

  it("stores a valid message for the signed-in user; status and admin_note can't be set by the user", async () => {
    const r = await post({ message: "  The chat froze\u0007 on send  ", category: "bug", page_path: "/app/settings?token=abc#x", status: "done", admin_note: "hax", user_id: OTHER });
    expect(r.status).toBe(201);
    const row = db.rows("feedback").find((x) => x.user_id === ME)!;
    expect(row).toMatchObject({ message: "The chat froze on send", category: "bug", page_path: "/app/settings" });
    expect(row.status).toBeUndefined(); // DB default 'new'; the route never sends it
    expect(row.admin_note).toBeUndefined();
  });

  it("page path: same-origin path only", () => {
    expect(cleanPagePath("/app/home")).toBe("/app/home");
    expect(cleanPagePath("//evil.com/x")).toBeNull();
    expect(cleanPagePath("https://evil.com")).toBeNull();
    expect(cleanPagePath("/app/<script>")).toBeNull();
    expect(cleanPagePath("/" + "a".repeat(250))).toBeNull();
    expect(validateFeedback({ message: "ok ok", category: undefined })).toMatchObject({ ok: true, value: { category: "other" } });
  });
});

describe("rate limit", () => {
  it("10 per hour per user, then 429", async () => {
    for (let i = 0; i < 10; i++) expect((await post({ message: `note number ${i}`, category: "idea" })).status).toBe(201);
    const r = await post({ message: "one too many", category: "idea" });
    expect(r.status).toBe(429);
    expect(db.rows("feedback").filter((x) => x.user_id === ME)).toHaveLength(10);
  });
});

describe("GET own feedback", () => {
  it("lists only the user's rows, without admin_note", async () => {
    await post({ message: "mine one", category: "bug" });
    const r = await GET(new Request("http://t/api/feedback?page=1"));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.items).toHaveLength(1);
    expect(j.items[0].message).toBe("mine one");
    expect(JSON.stringify(j)).not.toContain("internal");
    expect(j).toMatchObject({ page: 1, total: 1, more: false });
  });
});
