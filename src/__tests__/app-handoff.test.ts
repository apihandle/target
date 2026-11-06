import { describe, it, expect } from "vitest";
import { createAppHandoff, consumeAppHandoff, HANDOFF_TTL_MS, type HandoffRow, type HandoffStore } from "@/lib/auth/appHandoff";
import { sha256 } from "@/lib/connectors/crypto";

// The handoff encrypts the parked session with the connector key; give the test env one.
process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");

/** In-memory HandoffStore (same delete-on-take semantics as the Supabase table). */
function fakeStore() {
  const rows = new Map<string, HandoffRow>();
  const store: HandoffStore = {
    async insert(row) { rows.set(row.code_hash, { session_enc: row.session_enc, next: row.next, expires_at: row.expires_at }); },
    async take(codeHash) { const r = rows.get(codeHash) ?? null; rows.delete(codeHash); return r; },
  };
  return { store, rows };
}

const SESSION = { access_token: "access-1", refresh_token: "refresh-1" };
const T0 = 1_700_000_000_000;

describe("app login handoff codes", () => {
  it("round-trips the session and next, storing only the code hash", async () => {
    const { store, rows } = fakeStore();
    const code = await createAppHandoff(SESSION, "/app/home", store, T0);
    expect(code.length).toBeGreaterThan(20);
    expect([...rows.keys()]).toEqual([sha256(code)]);
    expect(JSON.stringify([...rows.values()])).not.toContain("access-1");
    const got = await consumeAppHandoff(code, store, T0 + 1000);
    expect(got?.session).toEqual(SESSION);
    expect(got?.next).toBe("/app/home");
  });

  it("is single-use: a second consume of the same code returns null", async () => {
    const { store } = fakeStore();
    const code = await createAppHandoff(SESSION, "/app", store, T0);
    expect(await consumeAppHandoff(code, store, T0 + 1000)).not.toBeNull();
    expect(await consumeAppHandoff(code, store, T0 + 2000)).toBeNull();
  });

  it("expires after the TTL", async () => {
    const { store } = fakeStore();
    const code = await createAppHandoff(SESSION, "/app", store, T0);
    expect(await consumeAppHandoff(code, store, T0 + HANDOFF_TTL_MS + 1)).toBeNull();
  });

  it("rejects unknown and empty codes", async () => {
    const { store } = fakeStore();
    expect(await consumeAppHandoff("no-such-code", store, T0)).toBeNull();
    expect(await consumeAppHandoff("", store, T0)).toBeNull();
  });

  it("collapses an unsafe next to /app", async () => {
    const { store } = fakeStore();
    const code = await createAppHandoff(SESSION, "https://evil.example/phish", store, T0);
    expect((await consumeAppHandoff(code, store, T0 + 1000))?.next).toBe("/app");
  });
});
