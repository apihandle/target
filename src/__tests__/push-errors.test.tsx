import { describe, it, expect, vi, beforeEach } from "vitest";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("no admin in tests"); } }));

import { sendPushToUser, resetPushConfig } from "@/lib/server/push";
import { fingerprint, reportError, resetErrorState, isAdminEmail } from "@/lib/server/errors";
import type { Db } from "@/lib/server/auth";

type Row = Record<string, unknown>;
/** A tiny in-memory stand-in for the Supabase query builder: select/eq/gte/limit/insert/delete. */
function fakeDb(tables: Record<string, Row[]>, users: { id: string; email: string }[] = []) {
  const from = (t: string) => {
    tables[t] ??= [];
    const filters: ((r: Row) => boolean)[] = [];
    let mode: "select" | "delete" = "select";
    let head = false;
    const b = {
      select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return b; },
      delete: () => { mode = "delete"; return b; },
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return b; },
      gte: (k: string, v: string) => { filters.push((r) => String(r[k]) >= v); return b; },
      limit: () => b,
      insert: async (row: Row) => { tables[t].push({ id: `id${tables[t].length}`, created_at: new Date().toISOString(), ...row }); return { error: null }; },
      then: (res: (v: unknown) => void) => {
        const hit = tables[t].filter((r) => filters.every((f) => f(r)));
        if (mode === "delete") { tables[t] = tables[t].filter((r) => !hit.includes(r)); return Promise.resolve({ error: null }).then(res); }
        return Promise.resolve(head ? { count: hit.length, error: null } : { data: hit, error: null }).then(res);
      },
    };
    return b;
  };
  return { from, auth: { admin: { listUsers: async () => ({ data: { users } }) } } } as unknown as Db;
}

beforeEach(() => {
  sendNotification.mockReset();
  resetPushConfig(); resetErrorState();
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub"; process.env.VAPID_PRIVATE_KEY = "priv";
  process.env.ADMIN_EMAIL = "owner@x.test";
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const sub = (id: string, user: string) => ({ id, user_id: user, endpoint: `https://push.example/${id}`, p256dh: "p256dh-key-xx", auth: "auth-key" });

describe("push", () => {
  it("sends to each of the user's devices and drops expired ones", async () => {
    const tables = { push_subscriptions: [sub("a", "u1"), sub("b", "u1"), sub("c", "u2")] };
    sendNotification.mockImplementation(async (s: { endpoint: string }) => { if (s.endpoint.endsWith("/b")) throw Object.assign(new Error("gone"), { statusCode: 410 }); });
    const sent = await sendPushToUser(fakeDb(tables), "u1", { title: "Done", body: "Daily news" });
    expect(sent).toBe(1);
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(JSON.parse(sendNotification.mock.calls[0][1])).toMatchObject({ title: "Done", body: "Daily news", url: "/app" });
    expect(tables.push_subscriptions.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("is a no-op without VAPID keys", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    expect(await sendPushToUser(fakeDb({ push_subscriptions: [sub("a", "u1")] }), "u1", { title: "x", body: "y" })).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("error tracking", () => {
  it("fingerprints ignore numbers so the same bug groups together", () => {
    const a = fingerprint({ source: "client", message: "Cannot read id of undefined (row 12)", stack: "Error\n    at Chat (chat.js:10:5)" });
    const b = fingerprint({ source: "client", message: "Cannot read id of undefined (row 99)", stack: "Error\n    at Chat (chat.js:11:7)" });
    const c = fingerprint({ source: "client", message: "Something else", stack: "" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("stores every error but alerts the owner's phone only once per kind", async () => {
    const tables: Record<string, Row[]> = { error_events: [], push_subscriptions: [sub("o", "owner")] };
    const db = fakeDb(tables, [{ id: "owner", email: "Owner@x.test" }]);
    sendNotification.mockResolvedValue({});
    await reportError({ source: "client", message: "Boom", url: "/app" }, db);
    await reportError({ source: "client", message: "Boom", url: "/app" }, db);
    expect(tables.error_events).toHaveLength(2);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sendNotification.mock.calls[0][1])).toMatchObject({ title: "TARGET error (client)", body: "Boom", url: "/app/settings/errors" });
  });

  it("never throws, even with no database", async () => {
    await expect(reportError({ source: "server", message: "x" })).resolves.toBeUndefined();
  });

  it("only the configured email is the owner", () => {
    expect(isAdminEmail("OWNER@x.test")).toBe(true);
    expect(isAdminEmail("someone@x.test")).toBe(false);
    delete process.env.ADMIN_EMAIL;
    expect(isAdminEmail("owner@x.test")).toBe(false);
  });
});
