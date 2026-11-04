import { describe, it, expect, vi } from "vitest";
import { connectionFromLogin } from "@/lib/connectors/googleFromLogin";
import { LOGIN_SCOPES } from "@/lib/connectors/googleLoginScopes";
import { SCOPES, LEGACY_SCOPES, google } from "@/lib/connectors/google";

const res = (j: unknown, ok = true) => ({ ok, json: async () => j }) as Response;

describe("Google sign-in also connects Google", () => {
  it("login scopes match the connector scopes", () => {
    for (const s of Object.values(SCOPES)) expect(LOGIN_SCOPES).toContain(s);
    for (const s of google.scopes.filter((x) => x.startsWith("https://"))) expect(LOGIN_SCOPES.split(" ")).toContain(s);
  });
  it("still recognises a sign-in that granted only the older (legacy) scopes", async () => {
    const f = vi.fn().mockResolvedValue(res({ scope: `openid ${LEGACY_SCOPES.gmailRead}`, expires_in: 3599, email: "a@b.com" }));
    expect((await connectionFromLogin({ provider_token: "tok" }, f as unknown as typeof fetch))?.scopes).toContain(LEGACY_SCOPES.gmailRead);
  });
  it("builds a connection from the granted scopes", async () => {
    const f = vi.fn().mockResolvedValue(res({ scope: `openid ${SCOPES.gmail} ${SCOPES.calendar}`, expires_in: "3599", email: "a@b.com" }));
    const c = await connectionFromLogin({ provider_token: "tok", provider_refresh_token: "ref" }, f as unknown as typeof fetch);
    expect(c?.accountLabel).toBe("a@b.com");
    expect(c?.scopes).toContain(SCOPES.gmail);
    expect(c?.creds.refresh_token).toBe("ref");
    expect(c!.creds.expires_at!).toBeGreaterThan(Date.now());
  });
  it("skips when no Google data scope was granted or no token", async () => {
    const f = vi.fn().mockResolvedValue(res({ scope: "openid email", expires_in: 3599 }));
    expect(await connectionFromLogin({ provider_token: "tok" }, f as unknown as typeof fetch)).toBeNull();
    expect(await connectionFromLogin({ provider_token: null }, f as unknown as typeof fetch)).toBeNull();
    expect(await connectionFromLogin({ provider_token: "x" }, vi.fn().mockResolvedValue(res({}, false)) as unknown as typeof fetch)).toBeNull();
  });
});
