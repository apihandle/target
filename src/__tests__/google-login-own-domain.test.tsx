import { describe, it, expect, vi } from "vitest";
import { createHash } from "crypto";
import { encodeLoginCookie, exchangeLoginCode, isValidCodeChallenge, loginAuthorizeUrl, newLogin, parseLoginCookie } from "@/lib/auth/googleLogin";
import { pkcePair } from "@/lib/connectors/crypto";

const ENV = { GOOGLE_OAUTH_CLIENT_ID: "cid.apps.googleusercontent.com", GOOGLE_OAUTH_CLIENT_SECRET: "sec" };

describe("Google sign-in on TARGET's own domain", () => {
  it("authorize URL uses our callback, login state, hashed nonce and Gmail/Calendar/Drive scopes", () => {
    const { cookie, hashedNonce } = newLogin("/app");
    expect(hashedNonce).toBe(createHash("sha256").update(cookie.nonce).digest("hex"));
    const u = new URL(loginAuthorizeUrl(ENV, "https://gettarget.vercel.app", cookie.state, hashedNonce));
    expect(u.searchParams.get("redirect_uri")).toBe("https://gettarget.vercel.app/api/connectors/google/callback");
    expect(u.searchParams.get("state")).toBe("login." + cookie.state);
    expect(u.searchParams.get("scope")).toContain("openid");
    expect(u.searchParams.get("scope")).toContain("gmail.modify");
    expect(u.toString()).not.toContain("supabase");
  });

  it("cookie round-trips and rejects junk", () => {
    const { cookie } = newLogin("/app/home");
    expect(parseLoginCookie(encodeLoginCookie(cookie))).toEqual(cookie);
    expect(parseLoginCookie("junk")).toBeNull();
    expect(parseLoginCookie(undefined)).toBeNull();
  });

  it("carries a valid PKCE challenge in the cookie for app sign-ins only (fix #4)", () => {
    const { challenge } = pkcePair();
    expect(isValidCodeChallenge(challenge)).toBe(true);
    const app = newLogin("/app", true, challenge);
    expect(app.cookie.challenge).toBe(challenge);
    expect(parseLoginCookie(encodeLoginCookie(app.cookie))).toEqual(app.cookie);
    // Not an app sign-in: the challenge is not stored.
    expect(newLogin("/app", false, challenge).cookie.challenge).toBeUndefined();
    // Malformed challenges are dropped, and a cookie carrying one is rejected.
    expect(newLogin("/app", true, "too-short").cookie.challenge).toBeUndefined();
    expect(isValidCodeChallenge("has spaces and is definitely not base64url!!")).toBe(false);
    expect(parseLoginCookie(encodeLoginCookie({ state: "s", nonce: "n", next: "/app", app: true, challenge: "bad" }))).toBeNull();
  });

  it("code exchange returns the id token, and throws without one", async () => {
    const ok = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id_token: "i", access_token: "a", refresh_token: "r" }) });
    await expect(exchangeLoginCode(ENV, "https://x.app", "c", ok as unknown as typeof fetch)).resolves.toEqual({ id_token: "i", access_token: "a", refresh_token: "r" });
    const bad = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) });
    await expect(exchangeLoginCode(ENV, "https://x.app", "c", bad as unknown as typeof fetch)).rejects.toThrow("invalid_grant");
  });
});
