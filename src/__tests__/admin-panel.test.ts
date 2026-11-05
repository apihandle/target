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
    healthRoute.GET(),
    usersExport.GET(new Request("http://t/api/admin/users/export")),
    errorsExport.GET(new Request("http://t/api/admin/errors/export")),
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
    const j = await (await healthRoute.GET()).json();
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
