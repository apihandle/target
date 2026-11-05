import { describe, expect, it, vi } from "vitest";
import { cookieBelongsTo, liveCookies, normalizeSite, sanitizeCookies, sessionExpiry, MAX_TTL_DAYS } from "@/lib/sessions";
import { extractVerification, siteDomain } from "@/lib/connectors/google";
import { workerAuth } from "@/lib/server/worker";
import { isTransientRefreshError, refreshOnce } from "@/lib/connectors/store";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const now = Date.UTC(2026, 9, 31);
const future = Math.floor(now / 1000) + 3600;

describe("website sessions", () => {
  it("normalizes sites and rejects private hosts", () => {
    expect(normalizeSite("https://www.Example.com/login")).toBe("example.com");
    expect(normalizeSite("accounts.example.co.in")).toBe("accounts.example.co.in");
    expect(normalizeSite("localhost")).toBeNull();
    expect(normalizeSite("192.168.1.1")).toBeNull();
    expect(normalizeSite("javascript:alert(1)")).toBeNull();
  });
  it("keeps only cookies for the same site", () => {
    expect(cookieBelongsTo(".example.com", "app.example.com")).toBe(true);
    expect(cookieBelongsTo("evil.com", "example.com")).toBe(false);
    expect(cookieBelongsTo(".com", "example.com")).toBe(false);
    const c = sanitizeCookies([
      { name: "sid", value: "abc", domain: ".example.com", expires: future },
      { name: "track", value: "x", domain: "ads.other.com", expires: future },
      { name: "old", value: "y", domain: "example.com", expires: 100 },
      { name: "bad name", value: "z" },
      { name: "inj", value: "a\r\nSet-Cookie: x" },
      { name: "s2", value: "v" },
    ], "example.com", now)!;
    expect(c.map((x) => x.name)).toEqual(["sid", "s2"]);
    expect(c[0].httpOnly && c[0].secure).toBe(true);
    expect(sanitizeCookies([{ name: "t", value: "x", domain: "other.com" }], "example.com", now)).toBeNull();
    expect(sanitizeCookies("nope", "example.com")).toBeNull();
  });
  it("caps expiry and drops cookies that expired later", () => {
    const c = sanitizeCookies([{ name: "a", value: "1", expires: Math.floor(now / 1000) + 400 * 86400 }], "example.com", now)!;
    expect(sessionExpiry(c, now).getTime()).toBe(now + MAX_TTL_DAYS * 86400000);
    expect(liveCookies(c, now + 500 * 86400000)).toEqual([]);
  });
  it("worker endpoint is closed without a strong secret", () => {
    const req = (h?: string) => new Request("https://x/api", { headers: h ? { authorization: h } : {} });
    expect(workerAuth(req("Bearer x"), {})).toBe("unconfigured");
    expect(workerAuth(req("Bearer short"), { SESSION_WORKER_SECRET: "short" })).toBe("unconfigured");
    const secret = "s".repeat(40);
    expect(workerAuth(req(`Bearer ${secret}`), { SESSION_WORKER_SECRET: secret })).toBe("ok");
    expect(workerAuth(req("Bearer wrong"), { SESSION_WORKER_SECRET: secret })).toBe("unauthorized");
    expect(workerAuth(req(), { SESSION_WORKER_SECRET: secret })).toBe("unauthorized");
  });
});

describe("gmail verification", () => {
  it("finds codes and same-site links only", () => {
    expect(siteDomain("https://www.GitHub.com/x")).toBe("github.com");
    expect(siteDomain("not a site")).toBeNull();
    expect(extractVerification("Your verification code is 482913. It expires soon.", "example.com").code).toBe("482913");
    expect(extractVerification("OTP: 123-456", "example.com").code).toBe("123456");
    const v = extractVerification("Confirm: https://evil.com/verify?t=1 or https://app.example.com/verify?token=abc", "example.com");
    expect(v.link).toBe("https://app.example.com/verify?token=abc");
    expect(extractVerification("Welcome to our newsletter", "example.com")).toEqual({});
  });
});

describe("google token refresh", () => {
  it("treats provider outages as temporary, not as a revoked login", () => {
    expect(isTransientRefreshError({ status: 503 })).toBe(true);
    expect(isTransientRefreshError({ status: 429 })).toBe(true);
    expect(isTransientRefreshError({ status: 400 })).toBe(false);
    expect(isTransientRefreshError(new Error("x"))).toBe(false);
  });
  it("runs one refresh for parallel requests", async () => {
    let calls = 0;
    const run = () => new Promise<{ type: "oauth"; access_token: string }>((r) => { calls++; setTimeout(() => r({ type: "oauth", access_token: "t" }), 10); });
    const [a, b] = await Promise.all([refreshOnce("u:google", run), refreshOnce("u:google", run)]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
  });
});

describe("sealed session envelope", () => {
  it("only opens for the same user and site, and upgrades old keys", async () => {
    const { randomBytes } = await import("crypto");
    const oldKey = randomBytes(32).toString("base64");
    process.env.CONNECTOR_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const { sealCookies, openCookies } = await import("@/lib/server/siteSessions");
    const { encryptSecret, parseKey } = await import("@/lib/connectors/crypto");
    const ck = [{ name: "sid", value: "plain-cookie-value-must-not-leak", domain: "example.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" as const }];
    const box = sealCookies("u1", "example.com", ck);
    expect(box).not.toContain("plain-cookie-value-must-not-leak");
    expect(box).not.toContain('"name":"sid"');
    expect(openCookies(box, "u1", "example.com")).toEqual({ cookies: ck, stale: false });
    expect(openCookies(box, "u2", "example.com")).toBeNull();
    expect(openCookies(box, "u1", "evil.com")).toBeNull();
    expect(openCookies("garbage", "u1", "example.com")).toBeNull();
    process.env.TOKEN_ENCRYPTION_KEY = oldKey;
    const legacy = encryptSecret(JSON.stringify(ck), parseKey(oldKey, "TOKEN_ENCRYPTION_KEY"));
    expect(openCookies(legacy, "u1", "example.com")?.stale).toBe(true);
    delete process.env.TOKEN_ENCRYPTION_KEY;
  });
});
