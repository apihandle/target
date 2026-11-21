// @vitest-environment node
// Per-user Meta (phase 2): the facebook/instagram display defs are fed by ONE sealed "meta"
// connection; the Page choice lives in the credentials' meta bag; resolveMetaSetup resolves the
// POSTING user's own Page/token and only falls back to the env owner config when the user never
// connected Meta — a connected user without a picked Page never touches the env tokens.
// All tokens below are obvious test fixtures; no real Graph call is ever made.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));

process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64"); // test fixture key, not a secret

import { CONNECTORS, connectorViews, getConnector } from "@/lib/connectors/registry";
import { getStoredCredentials, saveConnection } from "@/lib/connectors/store";
import {
  clearMetaPageChoice, metaPublicInfo, metaTargetReadiness, patchMetaViews, resolveMetaSetup,
  saveMetaPageChoice, userMetaConfig, type MetaPage,
} from "@/lib/server/socialMeta";
import { META_SCOPES } from "@/lib/socialConfig";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_TOK_A = "user-token-a-fixture";
const PAGE_TOK_A = "page-token-a-fixture";
const PAGE_TOK_B = "page-token-b-fixture";
const OWNER_ENV = {
  META_FACEBOOK_PAGE_ID: "999000111",
  META_FACEBOOK_PAGE_ACCESS_TOKEN: "owner-page-token-fixture",
  META_INSTAGRAM_USER_ID: "999000222",
  META_APP_ID: "app-fixture",
  META_APP_SECRET: "app-secret-fixture",
};
const BASE_ENV = {
  SUPABASE_SERVICE_ROLE_KEY: "x",
  CONNECTOR_ENCRYPTION_KEY: process.env.CONNECTOR_ENCRYPTION_KEY,
  META_APP_ID: "app-fixture",
  META_APP_SECRET: "app-secret-fixture",
};

type PageFixture = { id: string; name: string; tok: string; igId?: string; igName?: string };

async function connectMeta(userId: string, userTok: string, page?: PageFixture, expiresAt?: number) {
  await saveConnection(userId, "meta", {
    creds: {
      type: "oauth",
      "access_token": userTok,
      expires_at: expiresAt ?? Date.now() + 3_600_000,
      scope: META_SCOPES.join(" "),
      meta: {
        fb_user_id: `fb-${userId.slice(0, 4)}`,
        fb_user_name: "Test Person",
        ...(page ? {
          page_id: page.id, page_name: page.name, "page_access_token": page.tok,
          ...(page.igId ? { ig_user_id: page.igId, ig_username: page.igName } : {}),
        } : {}),
      },
    },
    accountLabel: page ? page.name : "Test Person",
    scopes: [...META_SCOPES],
  });
}

beforeEach(() => { h.db = new FakeDb(); });

describe("connector defs + registry", () => {
  it("facebook/instagram are oauth display defs keyed to the app env; the meta def itself is not a card", () => {
    for (const id of ["facebook", "instagram"]) {
      const def = getConnector(id)!;
      expect(def.auth).toBe("oauth");
      expect(def.requiredEnv).toEqual(["META_APP_ID", "META_APP_SECRET"]);
      expect(def.oauth?.clientIdEnv).toBe("META_APP_ID");
      expect(def.getTools({ connector_id: id, status: "connected", scopes: [], account_label: "" }).length).toBeGreaterThan(0);
    }
    expect(CONNECTORS.map((c) => c.id)).not.toContain("meta");
    expect(getConnector("meta")).toBeUndefined();
  });

  it("both cards derive their status from the single meta connection row", async () => {
    await connectMeta(A, USER_TOK_A);
    const conns = [{ connector_id: "meta", status: "connected" as const, scopes: [...META_SCOPES], account_label: "Test Person" }];
    const views = connectorViews(BASE_ENV, conns);
    for (const id of ["facebook", "instagram"]) {
      const v = views.find((x) => x.id === id)!;
      expect(v.status).toBe("connected");
      expect(v.accountLabel).toBe("Test Person");
    }
  });

  it("without META_APP_ID/SECRET the cards are setup_required (hidden by the grid)", async () => {
    const env = { ...BASE_ENV } as Record<string, string | undefined>;
    delete env.META_APP_ID; delete env.META_APP_SECRET;
    const views = connectorViews(env, []);
    for (const id of ["facebook", "instagram"]) expect(views.find((x) => x.id === id)!.status).toBe("setup_required");
  });
});

describe("page choice storage (sealed in the connection)", () => {
  const pageA: MetaPage = { id: "111", name: "Page A", accessToken: PAGE_TOK_A, instagram: { id: "ig-a", username: "pagea" } };

  it("saveMetaPageChoice stores page + token + IG in the sealed bag and names the row after the Page", async () => {
    await connectMeta(A, USER_TOK_A);
    await saveMetaPageChoice(A, pageA);
    const stored = await getStoredCredentials(A, "meta");
    expect(stored?.creds.meta).toMatchObject({ page_id: "111", page_name: "Page A", "page_access_token": PAGE_TOK_A, ig_user_id: "ig-a", ig_username: "pagea" });
    expect(stored?.creds.access_token).toBe(USER_TOK_A); // user token untouched
    expect(stored?.info.account_label).toBe("Page A");
  });

  it("picking a Page without Instagram clears a previously stored IG link", async () => {
    await connectMeta(A, USER_TOK_A);
    await saveMetaPageChoice(A, pageA);
    await saveMetaPageChoice(A, { id: "222", name: "Page B", accessToken: PAGE_TOK_B, instagram: null });
    const stored = await getStoredCredentials(A, "meta");
    expect(stored?.creds.meta?.page_id).toBe("222");
    expect(stored?.creds.meta?.ig_user_id).toBeUndefined();
    expect(stored?.creds.meta?.ig_username).toBeUndefined();
  });

  it("clearMetaPageChoice forgets the Page and restores the Facebook name as the label", async () => {
    await connectMeta(A, USER_TOK_A);
    await saveMetaPageChoice(A, pageA);
    await clearMetaPageChoice(A);
    const stored = await getStoredCredentials(A, "meta");
    expect(stored?.creds.meta?.page_id).toBeUndefined();
    expect(stored?.creds.meta?.page_access_token).toBeUndefined();
    expect(stored?.info.account_label).toBe("Test Person");
  });

  it("one user's choice is invisible to another user", async () => {
    await connectMeta(A, USER_TOK_A);
    await connectMeta(B, "user-token-b-fixture");
    await saveMetaPageChoice(A, pageA);
    expect((await metaPublicInfo(B))?.page).toBeNull();
    expect((await getStoredCredentials(B, "meta"))?.creds.meta?.page_access_token).toBeUndefined();
  });
});

describe("metaPublicInfo + patchMetaViews (card labels)", () => {
  it("facebook shows the Page name; instagram shows the linked @username", async () => {
    await connectMeta(A, USER_TOK_A, { id: "111", name: "Page A", tok: PAGE_TOK_A, igId: "ig-a", igName: "pagea" });
    const info = await metaPublicInfo(A);
    expect(info).toMatchObject({ page: { id: "111", name: "Page A" }, instagram: { id: "ig-a", username: "pagea" } });
    const views = patchMetaViews(connectorViews(BASE_ENV, []), info);
    expect(views.find((v) => v.id === "facebook")?.accountLabel).toBe("Page A");
    expect(views.find((v) => v.id === "instagram")?.accountLabel).toBe("@pagea");
  });

  it("a Page without Instagram shows the explicit no-Instagram state", async () => {
    await connectMeta(A, USER_TOK_A, { id: "111", name: "Page A", tok: PAGE_TOK_A });
    const views = patchMetaViews(connectorViews(BASE_ENV, []), await metaPublicInfo(A));
    expect(views.find((v) => v.id === "instagram")?.accountLabel).toBe("No Instagram linked to this Page");
  });

  it("no connection → null info and untouched views", async () => {
    expect(await metaPublicInfo(A)).toBeNull();
    const views = connectorViews(BASE_ENV, []);
    expect(patchMetaViews(views, null)).toBe(views);
  });
});

describe("resolveMetaSetup (the publish path)", () => {
  it("resolves the posting user's OWN page id + page token + IG id", async () => {
    await connectMeta(A, USER_TOK_A, { id: "111", name: "Page A", tok: PAGE_TOK_A, igId: "ig-a", igName: "pagea" });
    const s = await resolveMetaSetup(A, OWNER_ENV);
    expect(s).toMatchObject({ ready: true, source: "user" });
    if (s.ready) {
      expect(s.cfg.pageId).toBe("111");
      expect(s.cfg.pageToken).toBe(PAGE_TOK_A);
      expect(s.cfg.igUserId).toBe("ig-a");
    }
  });

  it("two users each resolve their own token — never the other user's", async () => {
    await connectMeta(A, USER_TOK_A, { id: "111", name: "Page A", tok: PAGE_TOK_A });
    await connectMeta(B, "user-token-b-fixture", { id: "222", name: "Page B", tok: PAGE_TOK_B });
    const sa = await resolveMetaSetup(A, OWNER_ENV);
    const sb = await resolveMetaSetup(B, OWNER_ENV);
    if (sa.ready && sb.ready) {
      expect(sa.cfg.pageToken).toBe(PAGE_TOK_A);
      expect(sb.cfg.pageToken).toBe(PAGE_TOK_B);
      expect(sa.cfg.pageId).not.toBe(sb.cfg.pageId);
    } else throw new Error("both setups should be ready");
  });

  it("connected but no Page picked → not ready, and the env owner config is NOT consulted", async () => {
    await connectMeta(A, USER_TOK_A);
    const s = await resolveMetaSetup(A, OWNER_ENV);
    expect(s.ready).toBe(false);
    if (!s.ready) expect(s.reason).toMatch(/no Facebook Page is chosen/);
  });

  it("expired long-lived token → not ready with a reconnect reason", async () => {
    await connectMeta(A, USER_TOK_A, { id: "111", name: "Page A", tok: PAGE_TOK_A }, Date.now() - 1000);
    const s = await resolveMetaSetup(A, OWNER_ENV);
    expect(s.ready).toBe(false);
    if (!s.ready) expect(s.reason).toMatch(/expired/);
  });

  it("no connection at all → the env owner config, marked as source env", async () => {
    const s = await resolveMetaSetup(A, OWNER_ENV);
    expect(s).toMatchObject({ ready: true, source: "env" });
    if (s.ready) {
      expect(s.cfg.pageId).toBe("999000111");
      expect(s.cfg.pageToken).toBe("owner-page-token-fixture");
    }
  });
});

describe("metaTargetReadiness + userMetaConfig (composer + route guards)", () => {
  it("no connection, no env fallback → both targets off with a connect-first reason", async () => {
    const r = await metaTargetReadiness(A, OWNER_ENV);
    expect(r.facebook.ready).toBe(false);
    expect(r.facebook.reason).toMatch(/Connect Facebook/);
    expect(r.instagram.ready).toBe(false);
  });

  it("no connection + envFallback (owner) → env readiness, as v1", async () => {
    const r = await metaTargetReadiness(A, OWNER_ENV, { envFallback: true });
    expect(r.facebook.ready).toBe(true);
    expect(r.instagram.ready).toBe(true);
  });

  it("connected + Page + IG → both ready; Page without IG → instagram off with the no-link reason", async () => {
    await connectMeta(A, USER_TOK_A, { id: "111", name: "Page A", tok: PAGE_TOK_A, igId: "ig-a", igName: "pagea" });
    const r1 = await metaTargetReadiness(A, OWNER_ENV);
    expect(r1.facebook.ready).toBe(true);
    expect(r1.instagram.ready).toBe(true);
    await saveMetaPageChoice(A, { id: "222", name: "Page B", accessToken: PAGE_TOK_B, instagram: null });
    const r2 = await metaTargetReadiness(A, OWNER_ENV);
    expect(r2.facebook.ready).toBe(true);
    expect(r2.instagram).toMatchObject({ ready: false });
    if (!r2.instagram.ready) expect(r2.instagram.reason).toMatch(/No Instagram account is linked/);
  });

  it("userMetaConfig: a regular user without a connection is refused; the owner (admin) gets the env config", async () => {
    const refused = await userMetaConfig(A, false, OWNER_ENV);
    expect(refused.ok).toBe(false);
    const owner = await userMetaConfig(A, true, OWNER_ENV);
    expect(owner.ok).toBe(true);
    if (owner.ok) expect(owner.cfg.pageId).toBe("999000111");
  });

  it("userMetaConfig: a regular user WITH their own Page gets their own config", async () => {
    await connectMeta(A, USER_TOK_A, { id: "111", name: "Page A", tok: PAGE_TOK_A });
    const own = await userMetaConfig(A, false, OWNER_ENV);
    expect(own.ok).toBe(true);
    if (own.ok) expect(own.cfg.pageToken).toBe(PAGE_TOK_A);
  });
});
