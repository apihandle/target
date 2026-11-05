// @vitest-environment node
// /admin and /api/admin: access guard (proxy + every route), admin writes (confirm + audit log), CSV export, settings.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb } from "./helpers/fakeSupabase";

type U = { id: string; email: string; created_at: string; last_sign_in_at?: string | null; banned_until?: string | null; email_confirmed_at?: string | null; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> };

const ADMIN: U = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "Owner@Example.com", created_at: "2026-10-01T00:00:00Z", email_confirmed_at: "2026-10-01T00:00:00Z", app_metadata: { provider: "email" } };
const BOB: U = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: "bob@x.test", created_at: "2026-11-04T00:00:00Z", email_confirmed_at: "2026-11-04T00:00:00Z", last_sign_in_at: "2026-11-04T10:00:00Z", app_metadata: { provider: "google" } };
const EVE: U = { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", email: "=cmd|evil@x.test", created_at: "2026-09-01T00:00:00Z", email_confirmed_at: "2026-09-01T00:00:00Z", app_metadata: { provider: "email" } };

const h = vi.hoisted(() => ({ session: null as unknown, admin: null as unknown, cron: [] as Request[] }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.session } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { if (!h.admin) throw new Error("no service role"); return h.admin; } }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: h.session } }) } }) }));
vi.mock("@/app/api/cron/scheduled/route", () => ({ GET: async (req: Request) => { h.cron.push(req); return Response.json({ ran: 2, results: [{ id: "x", status: "completed", secret: "should-not-leak" }] }); } }));
vi.mock("@/app/api/cron/proactive/route", () => ({ GET: async (req: Request) => { h.cron.push(req); return Response.json({ scanned: 1, new: 0 }); } }));

import { updateSession } from "@/lib/supabase/middleware";
import { clearAdminSettingsCache, getAdminSettings } from "@/lib/server/adminSettings";
import { requireAdminPage } from "@/lib/server/adminAuth";
import { isAdminUser } from "@/lib/server/adminCheck";
import { csvCell, featuresForApproval, featuresForTool, normalizeFlags, parseAdminEmails, toCsv } from "@/lib/adminConfig";
import { hrefWith } from "@/components/admin/ui";
import { jobDurationMs, startOfTodayIST, likeTerm } from "@/lib/server/adminData";
import { envStatus, runHealthChecks } from "@/lib/server/adminHealth";
import * as statusRoute from "@/app/api/admin/users/[id]/status/route";
import * as revokeRoute from "@/app/api/admin/shares/[id]/revoke/route";
import * as settingsRoute from "@/app/api/admin/settings/route";
import * as cronRoute from "@/app/api/admin/cron/route";
import * as healthRoute from "@/app/api/admin/health/route";
import * as usersExport from "@/app/api/admin/users/export/route";
import * as errorsExport from "@/app/api/admin/errors/export/route";
import * as activityRoute from "@/app/api/admin/stats/activity/route";
import { adminSearch, bucketActivity, clearNavCache, loadDashboard, loadNavCounts, shareTable, spark } from "@/lib/server/adminStats";
import { clearHealthSummary, healthSummary } from "@/lib/server/adminHealth";
import { countryFrom, deviceFrom, flagOf, countryName } from "@/lib/presence";
import { resetPresence, touchPresence } from "@/lib/server/presence";

const SHARE = "55555555-5555-4555-8555-555555555555";
let users: U[] = [];
let db: FakeDb;

function makeAdminDb(seed: Record<string, Record<string, unknown>[]> = {}) {
  const d = new FakeDb(seed);
  d.bypass = true;
  Object.defineProperty(d, "auth", {
    value: {
      getUser: async () => ({ data: { user: null } }),
      admin: {
        listUsers: async ({ page, perPage }: { page: number; perPage: number }) => ({ data: { users: users.slice((page - 1) * perPage, page * perPage) }, error: null }),
        getUserById: async (id: string) => { const u = users.find((x) => x.id === id); return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: "User not found" } }; },
        updateUserById: async (id: string, attrs: { ban_duration?: string }) => {
          const u = users.find((x) => x.id === id);
          if (!u) return { data: { user: null }, error: { message: "User not found" } };
          u.banned_until = attrs.ban_duration === "none" ? null : new Date(Date.now() + 1e12).toISOString();
          return { data: { user: u }, error: null };
        },
      },
    },
  });
  return d;
}

const post = (url: string, body?: unknown) => new Request(`http://t${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const audit = () => db.rows("admin_audit_log");
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ["ADMIN_EMAILS", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "CRON_SECRET"]) saved[k] = process.env[k];
  process.env.ADMIN_EMAILS = " owner@example.com , second@x.test";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://p.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.CRON_SECRET = "c".repeat(32);
  users = [structuredClone(ADMIN), structuredClone(BOB), structuredClone(EVE)];
  db = makeAdminDb({
    conversation_shares: [{ id: SHARE, user_id: BOB.id, conversation_id: "c1", token_hash: "f".repeat(64), created_at: "2026-11-01T00:00:00Z", revoked_at: null }],
    error_events: [
      { id: "e1", source: "server", message: "Boom 1", stack: "at a()", url: "/x", fingerprint: "f1", user_id: BOB.id, created_at: "2026-11-05T01:00:00Z" },
      { id: "e2", source: "client", message: "=HYPERLINK(evil)", stack: null, url: null, fingerprint: "f2", user_id: null, created_at: "2026-11-05T02:00:00Z" },
    ],
    messages: [{ id: "m1", user_id: BOB.id, role: "user", content: "hi", created_at: "2026-11-05T00:00:00Z" }],
  });
  h.admin = db;
  h.session = null;
  h.cron = [];
  clearAdminSettingsCache();
  clearNavCache();
  clearHealthSummary();
  resetPresence();
});
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

describe("who is an admin", () => {
  it("parses ADMIN_EMAILS (comma separated, case-insensitive, junk ignored)", () => {
    expect(parseAdminEmails(" A@x.com,b@y.com ; c@z.com  not-an-email")).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
    expect(parseAdminEmails(undefined)).toEqual([]);
  });
  it("needs a listed AND confirmed email; unset ADMIN_EMAILS means nobody", () => {
    expect(isAdminUser(ADMIN as never)).toBe(true);
    expect(isAdminUser(BOB as never)).toBe(false);
    expect(isAdminUser({ ...ADMIN, email_confirmed_at: null } as never)).toBe(false);
    expect(isAdminUser(null)).toBe(false);
    expect(isAdminUser(ADMIN as never, {})).toBe(false);
  });
});

describe("proxy: /admin is 404 for everyone but admins", () => {
  const run = (path: string) => updateSession(new NextRequest(`http://t${path}`));
  it("signed out → 404 (page rewrite and API JSON), never a login redirect", async () => {
    h.session = null;
    const page = await run("/admin/users");
    expect(page.status).toBe(404);
    expect(page.headers.get("location")).toBeNull();
    expect(page.headers.get("x-middleware-rewrite")).toContain("/_not-found-admin");
    const api = await run("/api/admin/settings");
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ error: "Not found" });
  });
  it("signed in but not listed → 404", async () => {
    h.session = BOB;
    expect((await run("/admin")).status).toBe(404);
    expect((await run("/api/admin/health")).status).toBe(404);
  });
  it("admin → passes with no-store + noindex", async () => {
    h.session = ADMIN;
    const r = await run("/admin");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-robots-tag")).toContain("noindex");
  });
  it("admin writes from another site are refused; same-site and GETs pass", async () => {
    h.session = ADMIN;
    const post = (headers: Record<string, string>) => updateSession(new NextRequest("http://t/api/admin/settings", { method: "POST", headers }));
    expect((await post({ origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post({ origin: "http://t" })).status).toBe(200);
    expect((await post({ "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect((await updateSession(new NextRequest("http://t/api/admin/health", { headers: { origin: "https://evil.example" } }))).status).toBe(200);
    h.session = BOB;
    expect((await post({ origin: "https://evil.example" })).status).toBe(404); // non-admins still see nothing
  });
  it("maintenance closes /app and its APIs for non-admins only", async () => {
    db.rows("admin_settings").push({ key: "maintenance", value: { enabled: true, message: "Back at 5" } });
    h.session = BOB;
    const page = await run("/app/settings");
    expect(page.status).toBe(503);
    expect(page.headers.get("x-middleware-rewrite")).toContain("/app/maintenance");
    const api = await run("/api/chat");
    expect(api.status).toBe(503);
    expect((await api.json()).error).toBe("Back at 5");
    expect((await run("/api/errors")).status).toBe(200); // error reports keep working
    h.session = ADMIN;
    expect((await run("/app/settings")).status).toBe(200);
    expect((await run("/api/chat")).status).toBe(200);
  });
  it("maintenance off → /app untouched", async () => {
    h.session = BOB;
    expect((await run("/app")).status).toBe(200);
  });
});

describe("every /api/admin route is 404 for anonymous and non-admin users", () => {
  const calls = () => [
    statusRoute.POST(post(`/api/admin/users/${BOB.id}/status`, { disabled: true, confirm: true }), ctx(BOB.id)),
    revokeRoute.POST(post(`/api/admin/shares/${SHARE}/revoke`, { confirm: true }), ctx(SHARE)),
    settingsRoute.GET(),
    settingsRoute.POST(post("/api/admin/settings", { key: "maintenance", value: { enabled: true }, confirm: true })),
    cronRoute.POST(post("/api/admin/cron", { job: "scheduled", confirm: true })),
    healthRoute.GET(new Request("http://t/api/admin/health")),
    usersExport.GET(new Request("http://t/api/admin/users/export")),
    errorsExport.GET(new Request("http://t/api/admin/errors/export")),
    activityRoute.GET(new Request("http://t/api/admin/stats/activity?range=7d")),
  ];
  for (const who of ["anonymous", "non-admin", "unconfirmed admin email"] as const) {
    it(who, async () => {
      h.session = who === "anonymous" ? null : who === "non-admin" ? BOB : { ...ADMIN, email_confirmed_at: null };
      const res = await Promise.all(calls());
      expect(res.map((r) => r.status)).toEqual(Array(res.length).fill(404));
      expect(users.find((u) => u.id === BOB.id)!.banned_until ?? null).toBeNull();
      expect(db.rows("conversation_shares")[0].revoked_at).toBeNull();
      expect(db.rows("admin_settings")).toEqual([]);
      expect(audit()).toEqual([]);
      expect(h.cron).toEqual([]);
    });
  }
  it("pages: requireAdminPage renders 404 for non-admins and passes admins", async () => {
    h.session = BOB;
    await expect(requireAdminPage()).rejects.toThrow();
    h.session = null;
    await expect(requireAdminPage()).rejects.toThrow();
    h.session = ADMIN;
    await expect(requireAdminPage()).resolves.toMatchObject({ user: { id: ADMIN.id } });
  });
});

describe("disable / enable a user", () => {
  beforeEach(() => { h.session = ADMIN; });
  it("needs confirm: true", async () => {
    const r = await statusRoute.POST(post("/x", { disabled: true }), ctx(BOB.id));
    expect(r.status).toBe(400);
    expect(users[1].banned_until ?? null).toBeNull();
    expect(audit()).toEqual([]);
  });
  it("disables then enables, each audited", async () => {
    const r = await statusRoute.POST(post("/x", { disabled: true, confirm: true }), ctx(BOB.id));
    expect(r.status).toBe(200);
    expect(users[1].banned_until).toBeTruthy();
    expect(audit()[0]).toMatchObject({ action: "user.disable", target_type: "user", target_id: BOB.id, actor_id: ADMIN.id, actor_email: ADMIN.email, detail: { email: BOB.email } });
    const r2 = await statusRoute.POST(post("/x", { disabled: false, confirm: true }), ctx(BOB.id));
    expect(r2.status).toBe(200);
    expect(users[1].banned_until).toBeNull();
    expect(audit()[1]).toMatchObject({ action: "user.enable", target_id: BOB.id });
  });
  it("refuses self and listed admins, unknown ids and bad bodies", async () => {
    expect((await statusRoute.POST(post("/x", { disabled: true, confirm: true }), ctx(ADMIN.id))).status).toBe(400);
    users.push({ ...BOB, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", email: "second@x.test" });
    expect((await statusRoute.POST(post("/x", { disabled: true, confirm: true }), ctx("cccccccc-cccc-4ccc-8ccc-cccccccccccc"))).status).toBe(400);
    expect((await statusRoute.POST(post("/x", { disabled: true, confirm: true }), ctx("dddddddd-dddd-4ddd-8ddd-dddddddddddd"))).status).toBe(404);
    expect((await statusRoute.POST(post("/x", { disabled: true, confirm: true }), ctx("not-a-uuid"))).status).toBe(404);
    expect((await statusRoute.POST(post("/x", { disabled: "yes", confirm: true }), ctx(BOB.id))).status).toBe(400);
    expect(audit()).toEqual([]);
  });
  it("no audit log (migration 0019 missing) → refused, nothing changes", async () => {
    const orig = db.from.bind(db);
    db.from = ((t: string) => (t === "admin_audit_log" ? { insert: async () => ({ error: { message: "relation does not exist" } }) } : orig(t))) as typeof db.from;
    const r = await statusRoute.POST(post("/x", { disabled: true, confirm: true }), ctx(BOB.id));
    expect(r.status).toBe(503);
    expect((await r.json()).error).toContain("0019");
    expect(users[1].banned_until ?? null).toBeNull();
  });
});

describe("revoke a share link", () => {
  beforeEach(() => { h.session = ADMIN; });
  it("needs confirm, then revokes once and audits", async () => {
    expect((await revokeRoute.POST(post("/x", {}), ctx(SHARE))).status).toBe(400);
    const r = await revokeRoute.POST(post("/x", { confirm: true }), ctx(SHARE));
    expect(r.status).toBe(200);
    expect(db.rows("conversation_shares")[0].revoked_at).toBeTruthy();
    expect(audit()).toHaveLength(1);
    expect(audit()[0]).toMatchObject({ action: "share.revoke", target_id: SHARE, detail: { owner: BOB.id } });
    const again = await (await revokeRoute.POST(post("/x", { confirm: true }), ctx(SHARE))).json();
    expect(again.already).toBe(true);
    expect(audit()).toHaveLength(1);
    expect((await revokeRoute.POST(post("/x", { confirm: true }), ctx("66666666-6666-4666-8666-666666666666"))).status).toBe(404);
  });
});

describe("settings: announcement, maintenance, kill-switches", () => {
  beforeEach(() => { h.session = ADMIN; });
  const save = (body: Record<string, unknown>) => settingsRoute.POST(post("/api/admin/settings", { ...body, confirm: true }));
  it("announcement: validated, saved, audited, visible through the cache", async () => {
    expect((await save({ key: "announcement", value: { enabled: true, text: "  " } })).status).toBe(400);
    expect((await save({ key: "announcement", value: { enabled: true, text: "x".repeat(301) } })).status).toBe(400);
    expect((await settingsRoute.POST(post("/x", { key: "announcement", value: { enabled: true, text: "Hi" } }))).status).toBe(400); // no confirm
    const r = await save({ key: "announcement", value: { enabled: true, text: " Slow today " } });
    expect(r.status).toBe(200);
    expect((await r.json()).settings.announcement).toEqual({ enabled: true, text: "Slow today" });
    expect(audit()[0]).toMatchObject({ action: "settings.announcement", detail: { enabled: true, text: "Slow today" } });
    expect((await getAdminSettings()).announcement.text).toBe("Slow today");
  });
  it("maintenance on/off", async () => {
    expect((await save({ key: "maintenance", value: { enabled: true, message: "Back soon" } })).status).toBe(200);
    expect((await getAdminSettings()).maintenance).toEqual({ enabled: true, message: "Back soon" });
    expect((await save({ key: "maintenance", value: { enabled: false } })).status).toBe(200);
    expect((await getAdminSettings()).maintenance.enabled).toBe(false);
    expect(audit().map((a) => a.action)).toEqual(["settings.maintenance", "settings.maintenance"]);
  });
  it("features merge into the current switches; unknown names refused", async () => {
    expect((await save({ key: "features", value: { browser: false } })).status).toBe(200);
    expect((await save({ key: "features", value: { email_send: false } })).status).toBe(200);
    const f = (await getAdminSettings()).features;
    expect(f).toMatchObject({ browser: false, email_send: false, checkout: true, scheduled: true });
    expect((await save({ key: "features", value: { payments: false } })).status).toBe(400);
    expect((await save({ key: "features", value: { browser: "no" } })).status).toBe(400);
    expect((await save({ key: "plans", value: {} })).status).toBe(400);
    expect(audit()).toHaveLength(2);
  });
  it("GET returns the saved settings", async () => {
    await save({ key: "features", value: { checkout: false } });
    expect((await (await settingsRoute.GET()).json()).settings.features.checkout).toBe(false);
  });
  it("a broken/missing settings table means defaults (everything on), never an outage", async () => {
    h.admin = null;
    clearAdminSettingsCache();
    expect(await getAdminSettings()).toMatchObject({ maintenance: { enabled: false }, features: { browser: true } });
  });
});

describe("run cron now", () => {
  beforeEach(() => { h.session = ADMIN; });
  it("calls the cron handler with the bearer secret built on the server; only counts return", async () => {
    expect((await cronRoute.POST(post("/x", { job: "scheduled" }))).status).toBe(400);
    expect((await cronRoute.POST(post("/x", { job: "rm -rf", confirm: true }))).status).toBe(400);
    const r = await cronRoute.POST(post("/x", { job: "scheduled", confirm: true }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.summary.ran).toBe(2);
    expect(JSON.stringify(body)).not.toContain("should-not-leak");
    expect(JSON.stringify(body)).not.toContain(process.env.CRON_SECRET);
    expect(h.cron[0].headers.get("authorization")).toBe(`Bearer ${process.env.CRON_SECRET}`);
    expect(h.cron[0].headers.get("x-target-run-by")).toBe("admin");
    expect(audit()[0]).toMatchObject({ action: "cron.run", target_id: "scheduled" });
    await cronRoute.POST(post("/x", { job: "proactive", confirm: true }));
    expect(audit()[1]).toMatchObject({ action: "cron.run", target_id: "proactive" });
  });
  it("no CRON_SECRET → 503, nothing runs", async () => {
    delete process.env.CRON_SECRET;
    expect((await cronRoute.POST(post("/x", { job: "scheduled", confirm: true }))).status).toBe(503);
    expect(h.cron).toEqual([]);
  });
});

describe("CSV exports", () => {
  beforeEach(() => { h.session = ADMIN; });
  it("users CSV: newest first, message counts, formula cells neutralised, audited", async () => {
    users[1].banned_until = new Date(Date.now() + 1e9).toISOString();
    const r = await usersExport.GET(new Request("http://t/api/admin/users/export"));
    expect(r.headers.get("content-type")).toContain("text/csv");
    expect(r.headers.get("content-disposition")).toContain("attachment");
    const lines = (await r.text()).trim().split("\r\n");
    expect(lines[0]).toBe('"id","email","created_at","last_sign_in_at","disabled","sign_in_method","messages"');
    expect(lines[1]).toContain('"bob@x.test"');
    expect(lines[1]).toContain('"yes","google","1"');
    expect(lines.join("\n")).toContain(`"'=cmd|evil@x.test"`);
    expect(audit()[0]).toMatchObject({ action: "export.users", detail: { rows: 3 } });
  });
  it("users CSV honours ?q=", async () => {
    const t = await (await usersExport.GET(new Request("http://t/api/admin/users/export?q=bob"))).text();
    expect(t.trim().split("\r\n")).toHaveLength(2);
  });
  it("errors CSV with source filter and formula neutralised", async () => {
    const all = await (await errorsExport.GET(new Request("http://t/api/admin/errors/export"))).text();
    expect(all).toContain(`"'=HYPERLINK(evil)"`);
    const server = (await (await errorsExport.GET(new Request("http://t/api/admin/errors/export?source=server"))).text()).trim().split("\r\n");
    expect(server).toHaveLength(2);
    expect(server[1]).toContain("Boom 1");
    expect(audit().map((a) => a.action)).toEqual(["export.errors", "export.errors"]);
  });
});

describe("health: env vars are only set/missing, secrets never echoed", () => {
  it("reports set/missing without values", () => {
    const s = envStatus({ NVIDIA_API_KEY: "nvapi-zzvaluezz", TAVILY_API_KEY: " " });
    const flat = s.flatMap((g) => g.vars);
    expect(flat.find((v) => v.name === "NVIDIA_API_KEY")).toEqual({ name: "NVIDIA_API_KEY", set: true });
    expect(flat.find((v) => v.name === "TAVILY_API_KEY")).toEqual({ name: "TAVILY_API_KEY", set: false });
    expect(JSON.stringify(s)).not.toContain("zzvaluezz");
  });
  it("live checks classify answers and never return a key", async () => {
    const seen: string[] = [];
    const f = (async (url: string) => { seen.push(String(url)); return new Response("{}", { status: String(url).includes("openrouter") ? 401 : 200 }); }) as unknown as typeof fetch;
    const env = { NVIDIA_API_KEY: "nv-zzvaluezz-1", OPENROUTER_API_KEY: "or-zzvaluezz-2", TAVILY_API_KEY: "tv-zzvaluezz-3", STEEL_API_KEY: "st-zzvaluezz-4", SESSION_WORKER_SECRET: "w".repeat(32), CRON_SECRET: "c".repeat(32) };
    const { checks } = await runHealthChecks(db as never, env, f, Date.parse("2026-11-05T05:00:00Z"));
    const by = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(by.supabase.state).toBe("ok");
    expect(by.nim.state).toBe("ok");
    expect(by.openrouter).toMatchObject({ state: "down", detail: expect.stringContaining("Key rejected") });
    expect(by.tavily.state).toBe("ok");
    expect(by.steel.state).toBe("ok");
    expect(by.compute.state).toBe("not_configured");
    expect(by.custom).toBeDefined();
    expect(JSON.stringify(checks)).not.toMatch(/zzvaluezz/);
    expect(seen.some((u) => u.includes("zzvaluezz"))).toBe(false); // keys go in headers, never in URLs
  });
  it("GET /api/admin/health for an admin", async () => {
    h.session = ADMIN;
    const j = await (await healthRoute.GET(new Request("http://t/api/admin/health"))).json();
    expect(Array.isArray(j.checks)).toBe(true);
    expect(Array.isArray(j.env)).toBe(true);
  });
});

describe("pure helpers", () => {
  it("maps tools and approvals to kill-switches", () => {
    expect(featuresForTool("target__browser_task")).toEqual(["browser"]);
    expect(featuresForTool("target__checkout")).toEqual(["checkout", "browser"]);
    expect(featuresForTool("target__book")).toEqual(["booking", "browser"]);
    expect(featuresForTool("google__gmail_send")).toEqual(["email_send"]);
    expect(featuresForTool("google__gmail_reply_all")).toEqual(["email_send"]);
    expect(featuresForTool("google__gmail_create_draft")).toEqual([]);
    expect(featuresForTool("target__generate_image")).toEqual([]);
    expect(featuresForApproval("purchase", {})).toEqual(["checkout", "browser"]);
    expect(featuresForApproval("create_schedule", {})).toEqual(["scheduled"]);
    expect(featuresForApproval("connector_tool", { connector: "google", tool: "gmail_forward" })).toEqual(["email_send"]);
    expect(featuresForApproval("connector_tool", { connector: "github", tool: "delete_repo" })).toEqual([]);
  });
  it("flags default to on", () => {
    expect(normalizeFlags(null)).toMatchObject({ browser: true, custom_providers: true });
    expect(normalizeFlags({ browser: false, junk: false })).toMatchObject({ browser: false, booking: true });
  });
  it("csv cells", () => {
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell("+1")).toBe(`"'+1"`);
    expect(csvCell(null)).toBe('""');
    expect(toCsv(["a"], [[1]])).toBe('"a"\r\n"1"\r\n');
  });
  it("paging links keep filters and drop page=1", () => {
    expect(hrefWith("/admin/errors", { source: "server", q: undefined, page: "3" }, { page: "1" })).toBe("/admin/errors?source=server");
    expect(hrefWith("/admin/errors", { source: "server", page: "3" }, { source: undefined })).toBe("/admin/errors");
    expect(hrefWith("/admin/jobs", { status: "failed" }, { page: "2" })).toBe("/admin/jobs?status=failed&page=2");
  });
  it("job duration, IST midnight and safe search terms", () => {
    expect(jobDurationMs({ claimed_at: "2026-11-05T00:00:00Z", finished_at: "2026-11-05T00:01:30Z", status: "done" })).toBe(90000);
    expect(jobDurationMs({ claimed_at: null, finished_at: null, status: "queued" })).toBeNull();
    expect(startOfTodayIST(new Date("2026-11-05T03:41:00Z"))).toBe("2026-11-04T18:30:00.000Z");
    expect(startOfTodayIST(new Date("2026-11-04T19:00:00Z"))).toBe("2026-11-04T18:30:00.000Z");
    expect(likeTerm("50%_off")).toBe("%50\\%\\_off%");
  });
});

describe("presence: country + coarse device, never the IP", () => {
  it("parses the Vercel country header and a coarse device", () => {
    expect(countryFrom("in")).toBe("IN");
    expect(countryFrom("XX")).toBeNull();
    expect(countryFrom("India")).toBeNull();
    expect(countryFrom(null)).toBeNull();
    expect(deviceFrom("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36")).toBe("Android · Chrome");
    expect(deviceFrom("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("iOS · Safari");
    expect(deviceFrom("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Windows · Edge");
    expect(flagOf("IN")).toBe("\u{1F1EE}\u{1F1F3}");
    expect(countryName("IN")).toBe("India");
  });
  it("touchPresence stores country/device/last_seen only, at most every 5 minutes", async () => {
    const headers = new Headers({ "x-vercel-ip-country": "IN", "x-forwarded-for": "203.0.113.7", "x-real-ip": "203.0.113.7", "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile" });
    const t = Date.parse("2026-11-05T04:00:00Z");
    expect(await touchPresence(BOB.id, headers, t)).toBe(true);
    expect(await touchPresence(BOB.id, headers, t + 60000)).toBe(false);
    const rows = db.rows("user_presence");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: BOB.id, country: "IN", device: "Android · Chrome", last_seen_at: "2026-11-05T04:00:00.000Z" });
    expect(JSON.stringify(rows)).not.toContain("203.0.113.7");
    expect(Object.keys(rows[0]).some((k) => /ip|agent/i.test(k))).toBe(false);
    expect(await touchPresence(BOB.id, headers, t + 6 * 60000)).toBe(true);
    expect(db.rows("user_presence")[0].last_seen_at).toBe("2026-11-05T04:06:00.000Z");
  });
  it("the proxy records presence for signed-in users", async () => {
    h.session = BOB;
    const waits: Promise<unknown>[] = [];
    await updateSession(new NextRequest("http://t/app", { headers: { "x-vercel-ip-country": "PK", "x-forwarded-for": "198.51.100.1" } }), { waitUntil: (p: Promise<unknown>) => { waits.push(p); } });
    await Promise.all(waits);
    expect(db.rows("user_presence")[0]).toMatchObject({ user_id: BOB.id, country: "PK" });
    h.session = null;
    resetPresence();
    await updateSession(new NextRequest("http://t/login"), { waitUntil: (p: Promise<unknown>) => { waits.push(p); } });
    expect(db.rows("user_presence")).toHaveLength(1);
  });
});

describe("dashboard numbers", () => {
  const NOW = Date.parse("2026-11-05T06:00:00Z"); // 11:30 IST
  it("buckets activity by range with distinct users", () => {
    const rows = [
      { user_id: "a", created_at: "2026-11-05T05:50:00Z" }, { user_id: "a", created_at: "2026-11-05T05:55:00Z" },
      { user_id: "b", created_at: "2026-11-05T05:56:00Z" }, { user_id: "c", created_at: "2026-11-04T05:00:00Z" },
    ];
    const b = bucketActivity(rows, "3h", NOW);
    expect(b).toHaveLength(12);
    expect(b[11]).toMatchObject({ messages: 3, users: 2 });
    expect(b.reduce((a, x) => a + x.messages, 0)).toBe(3); // yesterday's row is outside 3h
    expect(bucketActivity(rows, "30d", NOW)).toHaveLength(30);
    expect(spark(["2026-11-05T05:00:00Z", "2026-11-04T07:00:00Z"], 2, 86400000, NOW)).toEqual([1, 1]);
  });
  it("share tables keep the top N and an Others row", () => {
    const t = shareTable(new Map([["IN", 6], ["PK", 2], ["US", 1], ["BD", 1]]), 2);
    expect(t.map((r) => [r.key, r.count, Math.round(r.pct)])).toEqual([["IN", 6, 60], ["PK", 2, 20], ["others", 2, 20]]);
    expect(shareTable(new Map(), 3)).toEqual([]);
  });
  it("loadDashboard against the real table shapes", async () => {
    db.rows("messages").push({ id: "m2", user_id: EVE.id, role: "user", content: "x", created_at: "2026-11-05T05:00:00Z" }, { id: "m3", user_id: EVE.id, role: "assistant", content: "y", created_at: "2026-11-05T05:00:01Z" });
    db.rows("user_presence").push(
      { user_id: BOB.id, country: "IN", device: "Android · Chrome", last_seen_at: "2026-11-05T05:55:00Z" },
      { user_id: EVE.id, country: "IN", device: "iOS · Safari", last_seen_at: "2026-11-04T05:00:00Z" },
      { user_id: ADMIN.id, country: null, device: null, last_seen_at: "2026-11-05T01:00:00Z" },
    );
    db.rows("browser_jobs").push({ id: "j1", user_id: BOB.id, status: "done", created_at: "2026-11-05T01:00:00Z" }, { id: "j2", user_id: BOB.id, status: "failed", created_at: "2026-11-05T02:00:00Z" }, { id: "j3", user_id: BOB.id, status: "running", created_at: "2026-11-05T03:00:00Z" });
    db.rows("activity_events").push({ id: "a1", user_id: BOB.id, category: "task", title: "Booked", status: "completed", created_at: "2026-11-05T05:00:00Z" });
    const d = await loadDashboard(db as never, NOW);
    expect(d.users).toMatchObject({ total: 3, newWeek: 1 });
    expect(d.users.spark).toHaveLength(14);
    expect(d.active.now15).toBe(1);
    expect(d.active.today).toBe(3); // BOB + EVE (messages today), ADMIN (presence today)
    expect(d.messages.today).toBe(2); // user messages only
    expect(d.errors.last24h).toBe(2);
    expect(d.jobs).toMatchObject({ done: 1, failed: 1, running: 1, total: 3 });
    expect(d.countries[0]).toMatchObject({ code: "IN", users: 2 });
    expect(d.countries.find((c) => c.code === null)?.users).toBe(1);
    expect(d.devices.map((x) => x.label).sort()).toEqual(["Android · Chrome", "iOS · Safari"]);
    expect(d.activity[0]).toMatchObject({ title: "Booked", email: BOB.email });
    expect(d.recentErrors).toHaveLength(2);
  });
  it("no presence table → dashboard still loads, presence marked not ready", async () => {
    const orig = db.from.bind(db);
    db.from = ((t: string) => (t === "user_presence" ? { select: () => ({ limit: async () => ({ data: null, error: { message: "relation does not exist" } }) }) } : orig(t))) as typeof db.from;
    const d = await loadDashboard(db as never, NOW);
    expect(d.presenceReady).toBe(false);
    expect(d.active.now15).toBeNull();
    expect(d.users.total).toBe(3);
  });
  it("activity API returns buckets for the range (admin)", async () => {
    h.session = ADMIN;
    const j = await (await activityRoute.GET(new Request("http://t/api/admin/stats/activity?range=30d"))).json();
    expect(j.range).toBe("30d");
    expect(j.buckets).toHaveLength(30);
    const def = await (await activityRoute.GET(new Request("http://t/api/admin/stats/activity?range=bogus"))).json();
    expect(def.range).toBe("24h");
  });
  it("nav badge counts", async () => {
    db.rows("browser_jobs").push({ id: "q1", user_id: BOB.id, status: "queued", created_at: "2026-11-05T01:00:00Z" });
    db.rows("scheduled_jobs").push({ id: "s1", user_id: BOB.id, status: "active" });
    const n = await loadNavCounts(db as never, 2, Date.now());
    expect(n).toMatchObject({ users: 3, jobsActive: 1, scheduledActive: 1, sharesActive: 1, switchesOff: 2 });
  });
  it("global search finds users, jobs by id or goal, and errors", async () => {
    db.rows("browser_jobs").push({ id: "99999999-9999-4999-8999-999999999999", user_id: BOB.id, goal: "Book a table at Toit", status: "done", created_at: "2026-11-05T01:00:00Z" });
    expect((await adminSearch(db as never, "bob@")).users.map((u) => u.email)).toEqual(["bob@x.test"]);
    expect((await adminSearch(db as never, "toit")).jobs).toHaveLength(1);
    expect((await adminSearch(db as never, "99999999-9999-4999-8999-999999999999")).jobs).toHaveLength(1);
    expect((await adminSearch(db as never, "boom")).errors.map((e) => e.id)).toEqual(["e1"]);
    expect(await adminSearch(db as never, "  ")).toMatchObject({ users: [], jobs: [], errors: [] });
  });
  it("health summary: degraded when a live check is down, cached 60 s", async () => {
    let calls = 0;
    const f = (async () => { calls++; return new Response("{}", { status: 500 }); }) as unknown as typeof fetch;
    const s = await healthSummary(db as never, { NVIDIA_API_KEY: "k" }, f, 1000);
    expect(s).toMatchObject({ state: "degraded", down: ["NVIDIA NIM"] });
    await healthSummary(db as never, { NVIDIA_API_KEY: "k" }, f, 30000);
    expect(calls).toBe(1);
    clearHealthSummary();
    expect((await healthSummary(db as never, {}, f, 1000)).state).toBe("ok");
    h.session = ADMIN;
    clearHealthSummary();
    const j = await (await healthRoute.GET(new Request("http://t/api/admin/health?summary=1"))).json();
    expect(["ok", "degraded"]).toContain(j.state);
  });
});
