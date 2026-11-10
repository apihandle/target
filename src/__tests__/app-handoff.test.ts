import { describe, it, expect } from "vitest";
import { createAppHandoff, consumeAppHandoff, verifierMatchesChallenge, HANDOFF_TTL_MS, type HandoffRow, type HandoffStore } from "@/lib/auth/appHandoff";
import { pkcePair, sha256 } from "@/lib/connectors/crypto";

// The handoff encrypts the parked session with the connector key; give the test env one.
process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");

/** In-memory HandoffStore (same delete-on-take semantics as the Supabase table). */
function fakeStore() {
  const rows = new Map<string, HandoffRow>();
  const store: HandoffStore = {
    async insert(row) { rows.set(row.code_hash, { session_enc: row.session_enc, next: row.next, expires_at: row.expires_at, code_challenge: row.code_challenge }); },
    async take(codeHash) { const r = rows.get(codeHash) ?? null; rows.delete(codeHash); return r; },
    async peek(codeHash) { return rows.get(codeHash) ?? null; },
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

describe("app login handoff PKCE binding (fix #4)", () => {
  it("stores the challenge on the row, never the verifier", async () => {
    const { store, rows } = fakeStore();
    const { verifier, challenge } = pkcePair();
    const code = await createAppHandoff(SESSION, "/app", store, T0, challenge);
    const row = [...rows.values()][0];
    expect(row.code_challenge).toBe(challenge);
    expect(JSON.stringify(row)).not.toContain(verifier);
    expect(code).not.toBe(verifier);
  });

  it("releases the session to the correct verifier, exactly once", async () => {
    const { store } = fakeStore();
    const { verifier, challenge } = pkcePair();
    const code = await createAppHandoff(SESSION, "/app/home", store, T0, challenge);
    const got = await consumeAppHandoff(code, store, T0 + 1000, verifier);
    expect(got?.session).toEqual(SESSION);
    expect(got?.next).toBe("/app/home");
    expect(await consumeAppHandoff(code, store, T0 + 2000, verifier)).toBeNull();
  });

  it("refuses a missing verifier for a bound handoff — the code alone is no longer enough", async () => {
    const { store } = fakeStore();
    const { challenge } = pkcePair();
    const code = await createAppHandoff(SESSION, "/app", store, T0, challenge);
    expect(await consumeAppHandoff(code, store, T0 + 1000)).toBeNull();
    expect(await consumeAppHandoff(code, store, T0 + 1000, null)).toBeNull();
  });

  it("refuses a wrong verifier WITHOUT burning the code: the real app can still claim it", async () => {
    const { store, rows } = fakeStore();
    const { verifier, challenge } = pkcePair();
    const code = await createAppHandoff(SESSION, "/app", store, T0, challenge);
    expect(await consumeAppHandoff(code, store, T0 + 1000, "attacker-guess")).toBeNull();
    expect(rows.size).toBe(1); // failed attempt left the row in place
    expect((await consumeAppHandoff(code, store, T0 + 2000, verifier))?.session).toEqual(SESSION);
  });

  it("a bound handoff still expires after the TTL, even with the correct verifier", async () => {
    const { store } = fakeStore();
    const { verifier, challenge } = pkcePair();
    const code = await createAppHandoff(SESSION, "/app", store, T0, challenge);
    expect(await consumeAppHandoff(code, store, T0 + HANDOFF_TTL_MS + 1, verifier)).toBeNull();
  });

  it("legacy rows without a challenge keep working with no verifier (older app builds)", async () => {
    const { store, rows } = fakeStore();
    const code = await createAppHandoff(SESSION, "/app", store, T0);
    expect([...rows.values()][0].code_challenge).toBeNull();
    expect((await consumeAppHandoff(code, store, T0 + 1000))?.session).toEqual(SESSION);
  });

  it("a malformed challenge at create time is stored as a legacy unbound row", async () => {
    const { store, rows } = fakeStore();
    await createAppHandoff(SESSION, "/app", store, T0, "not-a-challenge");
    expect([...rows.values()][0].code_challenge).toBeNull();
  });

  it("verifierMatchesChallenge matches only the exact verifier", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifierMatchesChallenge(verifier, challenge)).toBe(true);
    expect(verifierMatchesChallenge("some-other-verifier", challenge)).toBe(false);
    expect(verifierMatchesChallenge(verifier, "short")).toBe(false);
  });
});
