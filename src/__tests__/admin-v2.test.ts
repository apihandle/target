// @vitest-environment node
// Admin panel v2: AI usage + Feedback routes are 404 for everyone but admins; feedback updates need confirm + audit.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb } from "./helpers/fakeSupabase";

type U = { id: string; email: string; created_at: string; email_confirmed_at?: string | null; app_metadata?: Record<string, unknown> };
const ADMIN: U = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "owner@example.com", created_at: "2026-10-01T00:00:00Z", email_confirmed_at: "2026-10-01T00:00:00Z", app_metadata: { provider: "email" } };
const BOB: U = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: "bob@x.test", created_at: "2026-11-04T00:00:00Z", email_confirmed_at: "2026-11-04T00:00:00Z", app_metadata: { provider: "google" } };

const h = vi.hoisted(() => ({ session: null as unknown, admin: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.session } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { if (!h.admin) throw new Error("no service role"); return h.admin; } }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: h.session } }) } }) }));

import { updateSession } from "@/lib/supabase/middleware";
import { requireAdminPage } from "@/lib/server/adminAuth";
import { clearAdminSettingsCache } from "@/lib/server/adminSettings";
import { clearNavCache, loadNavCounts } from "@/lib/server/adminStats";
import { cleanAiFilters, loadAiCalls, loadModelShare } from "@/lib/server/adminAiUsage";
import * as fbUpdate from "@/app/api/admin/feedback/[id]/route";
import * as fbExport from "@/app/api/admin/feedback/export/route";
import * as aiExport from "@/app/api/admin/ai-usage/export/route";
import * as aiStats from "@/app/api/admin/stats/ai-usage/route";

const FB = "55555555-5555-4555-8555-555555555555";
let db: FakeDb;
const users = [ADMIN, BOB];
const saved: Record<string, string | undefined> = {};

function adminDb(seed: Record<string, Record<string, unknown>[]>) {
  const d = new FakeDb(seed);
  d.bypass = true;
  Object.defineProperty(d, "auth", {
    value: {
      getUser: async () => ({ data: { user: null } }),
      admin: {
        listUsers: async () => ({ data: { users }, error: null }),
        getUserById: async (id: string) => ({ data: { user: users.find((u) => u.id === id) ?? null }, error: null }),
      },
    },
  });
  return d;
}

const post = (url: string, body?: unknown) => new Request(`http://t${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const recent = new Date(Date.now() - 3600000).toISOString();

beforeEach(() => {
  for (const k of ["ADMIN_EMAILS", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) saved[k] = process.env[k];
  process.env.ADMIN_EMAILS = "owner@example.com";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://p.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  db = adminDb({
    feedback: [
      { id: FB, user_id: BOB.id, message: "=HYPERLINK(evil) the app froze", category: "bug", page_path: "/app", status: "new", admin_note: null, created_at: recent, updated_at: recent },
      { id: "66666666-6666-4666-8666-666666666666", user_id: BOB.id, message: "dark mode please", category: "idea", page_path: null, status: "done", admin_note: "shipped", created_at: recent, updated_at: recent },
    ],
    ai_usage: [
      { id: 1, created_at: recent, user_id: BOB.id, request_id: "77777777-7777-4777-8777-777777777777", provider: "nim", model: "ultra", feature: "chat", attempt: 1, streamed: true, input_tokens: 10, output_tokens: 20, latency_ms: 1200, ttft_ms: 400, success: true, error_code: null, race_won: true },
      { id: 2, created_at: recent, user_id: BOB.id, request_id: "77777777-7777-4777-8777-777777777777", provider: "nim", model: "mistral", feature: "chat", attempt: 0, streamed: true, input_tokens: null, output_tokens: null, latency_ms: 1100, ttft_ms: null, success: false, error_code: "cancelled", race_won: false },
      { id: 3, created_at: recent, user_id: null, request_id: "88888888-8888-4888-8888-888888888888", provider: "openrouter", model: "free", feature: "proactive", attempt: 0, streamed: false, input_tokens: null, output_tokens: null, latency_ms: 300, ttft_ms: null, success: false, error_code: "http_429", race_won: null },
    ],
  });
  h.admin = db;
  h.session = null;
  clearAdminSettingsCache();
  clearNavCache();
});
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

describe("gated: 404 for signed-out, non-admin and unconfirmed-admin users", () => {
  const calls = () => [
    fbUpdate.POST(post(`/api/admin/feedback/${FB}`, { status: "done", confirm: true }), ctx(FB)),
    fbExport.GET(new Request("http://t/api/admin/feedback/export")),
    aiExport.GET(new Request("http://t/api/admin/ai-usage/export")),
    aiStats.GET(new Request("http://t/api/admin/stats/ai-usage?range=7d")),
  ];
  for (const who of ["anonymous", "non-admin", "unconfirmed"] as const) {
    it(`API routes · ${who}`, async () => {
      h.session = who === "anonymous" ? null : who === "non-admin" ? BOB : { ...ADMIN, email_confirmed_at: null };
      const res = await Promise.all(calls());
      expect(res.map((r) => r.status)).toEqual([404, 404, 404, 404]);
      expect(db.rows("feedback")[0].status).toBe("new");
      expect(db.rows("admin_audit_log")).toEqual([]);
    });
  }
  it("pages /admin/ai-usage and /admin/feedback: proxy 404 + requireAdminPage", async () => {
    for (const path of ["/admin/ai-usage", "/admin/feedback", "/api/admin/stats/ai-usage", "/api/admin/feedback/export"]) {
      h.session = null;
      const r = await updateSession(new NextRequest(`http://t${path}`));
      expect(r.status).toBe(404);
      expect(r.headers.get("location")).toBeNull();
      h.session = BOB;
      expect((await updateSession(new NextRequest(`http://t${path}`))).status).toBe(404);
    }
    h.session = BOB;
    await expect(requireAdminPage()).rejects.toThrow();
    h.session = ADMIN;
    expect((await updateSession(new NextRequest("http://t/admin/ai-usage"))).status).toBe(200);
    await expect(requireAdminPage()).resolves.toMatchObject({ user: { id: ADMIN.id } });
  });
});

describe("feedback update (admin)", () => {
  beforeEach(() => { h.session = ADMIN; });
  it("needs confirm:true and valid input", async () => {
    expect((await fbUpdate.POST(post(`/api/admin/feedback/${FB}`, { status: "done" }), ctx(FB))).status).toBe(400);
    expect((await fbUpdate.POST(post(`/api/admin/feedback/${FB}`, { status: "deleted", confirm: true }), ctx(FB))).status).toBe(400);
    expect((await fbUpdate.POST(post(`/api/admin/feedback/${FB}`, { note: "x".repeat(1001), confirm: true }), ctx(FB))).status).toBe(400);
    expect((await fbUpdate.POST(post(`/api/admin/feedback/${FB}`, { confirm: true }), ctx(FB))).status).toBe(400);
    expect((await fbUpdate.POST(post("/api/admin/feedback/not-a-uuid", { status: "done", confirm: true }), ctx("not-a-uuid"))).status).toBe(404);
    expect(db.rows("admin_audit_log")).toEqual([]);
    expect(db.rows("feedback")[0].status).toBe("new");
  });
  it("changes status + note and writes the audit entry (without the user's message or note text)", async () => {
    const r = await fbUpdate.POST(post(`/api/admin/feedback/${FB}`, { status: "seen", note: "  looking into it ", confirm: true }), ctx(FB));
    expect(r.status).toBe(200);
    expect(db.rows("feedback")[0]).toMatchObject({ status: "seen", admin_note: "looking into it" });
    const log = db.rows("admin_audit_log");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "feedback.update", target_type: "feedback", target_id: FB, actor_id: ADMIN.id });
    expect(JSON.stringify(log[0])).not.toMatch(/froze|looking into it/);
  });
  it("refuses the change when the audit log can't be written", async () => {
    const from = db.from.bind(db);
    db.from = ((t: string) => (t === "admin_audit_log" ? { insert: async () => ({ error: { message: "relation does not exist" } }) } : from(t))) as typeof db.from;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await fbUpdate.POST(post(`/api/admin/feedback/${FB}`, { status: "done", confirm: true }), ctx(FB));
    expect(r.status).toBe(503);
    expect(db.rows("feedback")[0].status).toBe("new");
  });
  it("sidebar badge counts new feedback", async () => {
    const n = await loadNavCounts(db as never, 0);
    expect(n.feedbackNew).toBe(1);
  });
});

describe("exports + stats (admin)", () => {
  beforeEach(() => { h.session = ADMIN; });
  it("feedback CSV: filtered, formula cells neutralised, audited", async () => {
    const r = await fbExport.GET(new Request("http://t/api/admin/feedback/export?status=new"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/csv");
    const csv = await r.text();
    expect(csv).toContain("'=HYPERLINK(evil)");
    expect(csv).not.toContain("dark mode");
    expect(db.rows("admin_audit_log")[0]).toMatchObject({ action: "export.feedback" });
  });
  it("AI usage CSV: filters apply, audited, no text columns", async () => {
    const r = await aiExport.GET(new Request("http://t/api/admin/ai-usage/export?status=failed"));
    expect(r.status).toBe(200);
    const csv = await r.text();
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).not.toMatch(/prompt|message|content|key/i);
    expect(lines).toHaveLength(2); // header + the 429 (the cancelled race loser isn't a failure)
    expect(lines[1]).toContain("http_429");
    expect(db.rows("admin_audit_log")[0]).toMatchObject({ action: "export.ai_usage" });
  });
  it("stats route aggregates by request", async () => {
    const r = await aiStats.GET(new Request("http://t/api/admin/stats/ai-usage?range=24h"));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ requests: 2, attempts: 3, failedRequests: 1, cancelled: 1, racesWon: 1 });
    expect(j.models[0]).toMatchObject({ key: "ultra", count: 1 });
    expect(j.topUsers[0]).toMatchObject({ user_id: BOB.id, email: "bob@x.test", requests: 1 });
  });
  it("calls table filters + dashboard model share; unknown filter values are ignored", async () => {
    expect(cleanAiFilters({ provider: "evil", status: "nope", user: "x", feature: "Chat!" })).toEqual({ provider: undefined, model: undefined, feature: undefined, status: undefined, user: undefined });
    const c = await loadAiCalls(db as never, { page: 1, status: "cancelled" });
    expect(c.rows.map((x) => x.model)).toEqual(["mistral"]);
    const m = await loadModelShare(db as never);
    expect(m).toMatchObject({ total: 1, models: [{ key: "ultra", count: 1, pct: 100 }] });
  });
  it("missing table → error states, not a crash", async () => {
    const broken = adminDb({});
    broken.from = (() => { throw new Error("relation ai_usage does not exist"); }) as typeof broken.from;
    h.admin = broken;
    expect((await aiStats.GET(new Request("http://t/api/admin/stats/ai-usage"))).status).toBe(502);
    expect((await fbExport.GET(new Request("http://t/api/admin/feedback/export"))).status).toBe(502);
    expect(await loadModelShare(broken as never)).toBeNull();
  });
});
