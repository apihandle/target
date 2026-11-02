// @vitest-environment node
// Supabase (OAuth 2.0 + PKCE) and Vercel (integration install) connect flows through the real routes.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fakeSupabase").FakeDb }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));

import { decryptWithAny, decryptionKeys, sha256 } from "@/lib/connectors/crypto";
import { getConnector } from "@/lib/connectors/registry";
import { refreshCreds } from "@/lib/connectors/oauth";
import * as connectRoute from "@/app/api/connectors/[id]/connect/route";
import * as callbackRoute from "@/app/api/connectors/[id]/callback/route";
import * as disconnectRoute from "@/app/api/connectors/[id]/disconnect/route";

const A = "11111111-1111-4111-8111-111111111111";
const ENV = {
  CONNECTOR_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
  SUPABASE_OAUTH_CLIENT_ID: "sb-client", SUPABASE_OAUTH_CLIENT_SECRET: "sb-secret-value",
  VERCEL_OAUTH_CLIENT_ID: "oac_test", VERCEL_OAUTH_CLIENT_SECRET: "vc-secret-value", VERCEL_INTEGRATION_SLUG: "target",
};
const saved: Record<string, string | undefined> = {};
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const p = (id: string) => ({ params: Promise.resolve({ id }) });
const start = async (id: string) => new URL((await connectRoute.GET(new Request(`https://gettarget.vercel.app/api/connectors/${id}/connect`), p(id))).headers.get("location")!);
const creds = () => JSON.parse(decryptWithAny(String(h.db.tables.connections[0].encrypted_credentials), decryptionKeys()));

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  h.db = new FakeDb({ connections: [], tasks: [], approval_requests: [], activity_events: [], connector_oauth_states: [] });
  h.db.as(A);
});
afterEach(() => {
  for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
});

describe("Supabase OAuth", () => {
  it("start redirects to Supabase's authorize URL with client_id, redirect_uri, state and PKCE (no scope)", async () => {
    const loc = await start("supabase");
    expect(loc.origin + loc.pathname).toBe("https://api.supabase.com/v1/oauth/authorize");
    expect(loc.searchParams.get("client_id")).toBe("sb-client");
    expect(loc.searchParams.get("response_type")).toBe("code");
    expect(loc.searchParams.get("redirect_uri")).toBe("https://gettarget.vercel.app/api/connectors/supabase/callback");
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    expect(loc.searchParams.get("code_challenge")).toBeTruthy();
    expect(loc.searchParams.has("scope")).toBe(false);
    expect(h.db.tables.connector_oauth_states[0].state_hash).toBe(sha256(loc.searchParams.get("state")!));
  });

  it("callback exchanges the code with basic auth + code_verifier, stores encrypted tokens, labels by org", async () => {
    const state = (await start("supabase")).searchParams.get("state")!;
    const f = vi.fn()
      .mockResolvedValueOnce(jsonRes({ access_token: "sbat_" + "x".repeat(30), refresh_token: "sbrt_" + "y".repeat(30), expires_in: 3600, token_type: "Bearer" }))
      .mockResolvedValueOnce(jsonRes([{ id: "org1", name: "Acme" }]));
    vi.stubGlobal("fetch", f);
    const r = await callbackRoute.GET(new Request(`https://gettarget.vercel.app/api/connectors/supabase/callback?code=abc&state=${state}`), p("supabase"));
    expect(r.headers.get("location")).toBe("https://gettarget.vercel.app/app/connectors?connected=supabase");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.supabase.com/v1/oauth/token");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("sb-client:sb-secret-value").toString("base64")}`);
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("redirect_uri")).toBe("https://gettarget.vercel.app/api/connectors/supabase/callback");
    expect(body.get("code_verifier")?.length).toBeGreaterThanOrEqual(43);
    expect(body.has("client_secret")).toBe(false);
    expect(h.db.tables.connections[0]).toMatchObject({ connector_id: "supabase", account_label: "Acme", status: "connected" });
    expect(String(h.db.tables.connections[0].encrypted_credentials)).not.toContain("sbat_");
    expect(creds()).toMatchObject({ type: "oauth", refresh_token: "sbrt_" + "y".repeat(30) });
  });

  it("a bad or missing state is rejected and nothing is saved", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    for (const q of ["code=abc&state=forged", "code=abc"]) {
      const r = await callbackRoute.GET(new Request(`https://gettarget.vercel.app/api/connectors/supabase/callback?${q}`), p("supabase"));
      expect(r.headers.get("location")).toContain("error=state");
    }
    expect(f).not.toHaveBeenCalled();
    expect(h.db.tables.connections).toHaveLength(0);
  });

  it("refresh uses the refresh_token grant", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes({ access_token: "new-access-token-123", refresh_token: "new-refresh", expires_in: 3600 }));
    const c = await refreshCreds(getConnector("supabase")!, ENV, { type: "oauth", access_token: "old", refresh_token: "old-r", expires_at: 1 }, f);
    expect(c).toMatchObject({ access_token: "new-access-token-123", refresh_token: "new-refresh" });
    expect(new URLSearchParams(f.mock.calls[0][1].body).get("grant_type")).toBe("refresh_token");
  });
});

describe("Vercel integration OAuth", () => {
  it("start redirects to the integration install page with only a state", async () => {
    const loc = await start("vercel");
    expect(loc.origin + loc.pathname).toBe("https://vercel.com/integrations/target/new");
    expect([...loc.searchParams.keys()]).toEqual(["state"]);
    expect(h.db.tables.connector_oauth_states[0].state_hash).toBe(sha256(loc.searchParams.get("state")!));
  });

  it("callback exchanges the code (form body with client_id/secret/redirect_uri), keeps teamId + configurationId", async () => {
    const state = (await start("vercel")).searchParams.get("state")!;
    const f = vi.fn()
      .mockResolvedValueOnce(jsonRes({ token_type: "Bearer", access_token: "vca_" + "t".repeat(30), installation_id: "inst1", user_id: "u1", team_id: "team_abc" }))
      .mockResolvedValueOnce(jsonRes({ id: "team_abc", slug: "acme", name: "Acme" }));
    vi.stubGlobal("fetch", f);
    const r = await callbackRoute.GET(new Request(`https://gettarget.vercel.app/api/connectors/vercel/callback?code=abc&configurationId=icfg_123&teamId=team_abc&next=https%3A%2F%2Fvercel.com&state=${state}`), p("vercel"));
    expect(r.headers.get("location")).toBe("https://gettarget.vercel.app/app/connectors?connected=vercel");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.vercel.com/v2/oauth/access_token");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(init.body);
    expect(Object.fromEntries(["client_id", "client_secret", "code", "redirect_uri"].map((k) => [k, body.get(k)]))).toEqual({
      client_id: "oac_test", client_secret: "vc-secret-value", code: "abc", redirect_uri: "https://gettarget.vercel.app/api/connectors/vercel/callback",
    });
    expect(String(f.mock.calls[1][0])).toBe("https://api.vercel.com/v2/teams/team_abc");
    expect(h.db.tables.connections[0]).toMatchObject({ connector_id: "vercel", account_label: "Acme (team)" });
    expect(creds().meta).toMatchObject({ teamId: "team_abc", configurationId: "icfg_123", installationId: "inst1" });
  });

  it("tools default to the installed team; disconnect removes the integration configuration", async () => {
    const t = getConnector("vercel")!.getTools({ connector_id: "vercel", status: "connected", scopes: [], account_label: "" }).find((x) => x.name === "list_projects")!;
    const f = vi.fn().mockResolvedValue(jsonRes({ projects: [] }));
    await t.execute(t.input.parse({}), { token: "tok", fetch: f, meta: { teamId: "team_abc" } });
    expect(String(f.mock.calls[0][0])).toContain("teamId=team_abc");

    const state = (await start("vercel")).searchParams.get("state")!;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonRes({ access_token: "vca_" + "t".repeat(30), team_id: null })).mockResolvedValue(jsonRes({ user: { username: "octo" } })));
    await callbackRoute.GET(new Request(`https://gettarget.vercel.app/api/connectors/vercel/callback?code=abc&configurationId=icfg_9&state=${state}`), p("vercel"));
    expect(h.db.tables.connections[0].account_label).toBe("@octo");
    const del = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", del);
    expect((await disconnectRoute.POST(new Request("https://gettarget.vercel.app/x", { method: "POST" }), p("vercel"))).status).toBe(200);
    expect(del.mock.calls[0][0]).toBe("https://api.vercel.com/v1/integrations/configuration/icfg_9");
    expect(del.mock.calls[0][1].method).toBe("DELETE");
  });

  it("a forged state is rejected", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    const r = await callbackRoute.GET(new Request("https://gettarget.vercel.app/api/connectors/vercel/callback?code=abc&configurationId=icfg_1&state=nope"), p("vercel"));
    expect(r.headers.get("location")).toContain("error=state");
    expect(f).not.toHaveBeenCalled();
  });
});
