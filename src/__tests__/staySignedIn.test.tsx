import { describe, expect, it, vi } from "vitest";
import { canReplay, loginUrl, shouldRetryOn401, withSessionRetry } from "@/lib/authFetch";
import { detectInApp, openInBrowserUrl } from "@/lib/browser";

const O = "https://gettarget.vercel.app";
const res = (status: number) => new Response("{}", { status });

describe("stay signed in", () => {
  it("only retries our own API", () => {
    expect(shouldRetryOn401("/api/chat", O)).toBe(true);
    expect(shouldRetryOn401(`${O}/api/memories`, O)).toBe(true);
    expect(shouldRetryOn401("https://evil.com/api/chat", O)).toBe(false);
    expect(shouldRetryOn401("/api/cron/scheduled", O)).toBe(false);
    expect(shouldRetryOn401("/app", O)).toBe(false);
  });
  it("refreshes once and retries instead of logging out", async () => {
    const base = vi.fn().mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(200));
    const refresh = vi.fn().mockResolvedValue(true);
    const onExpired = vi.fn();
    const f = withSessionRetry(base as unknown as typeof fetch, refresh, O, onExpired);
    expect((await f("/api/chat", { method: "POST", body: "{}" })).status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onExpired).not.toHaveBeenCalled();
  });
  it("sends to login only when the refresh really fails", async () => {
    const base = vi.fn().mockResolvedValue(res(401));
    const onExpired = vi.fn();
    const f = withSessionRetry(base as unknown as typeof fetch, async () => false, O, onExpired);
    expect((await f("/api/chat")).status).toBe(401);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(base).toHaveBeenCalledTimes(1);
  });
  it("shares one refresh across parallel calls", async () => {
    let n = 0;
    const base = vi.fn(async () => (n++ < 2 ? res(401) : res(200)));
    const refresh = vi.fn(() => new Promise<boolean>((r) => setTimeout(() => r(true), 5)));
    const f = withSessionRetry(base as unknown as typeof fetch, refresh, O, () => {});
    await Promise.all([f("/api/a"), f("/api/b")]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("never replays streams and keeps the return page safe", () => {
    expect(canReplay({ body: "x" })).toBe(true);
    expect(canReplay({ body: new ReadableStream() })).toBe(false);
    expect(loginUrl("/app/chat/1", "?q=a")).toBe("/login?next=%2Fapp%2Fchat%2F1%3Fq%3Da&expired=1");
    expect(loginUrl("//evil.com")).toBe("/login?next=%2Fapp&expired=1");
  });
});

describe("browser handling", () => {
  it("detects app browsers that Google blocks", () => {
    expect(detectInApp("Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 Instagram 300.0")?.app).toBe("Instagram");
    expect(detectInApp("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 (KHTML) Mobile/15E148 [FBAN/FBIOS]")?.ios).toBe(true);
    expect(detectInApp("Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Version/4.0 Chrome/120 Mobile Safari/537.36")?.android).toBe(true);
    expect(detectInApp("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36")).toBeNull();
    expect(detectInApp("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")).toBeNull();
    expect(detectInApp("Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/120 Mobile/15E148")).toBeNull();
  });
  it("builds an Android intent to open the real browser", () => {
    expect(openInBrowserUrl(`${O}/login?next=%2Fapp`)).toBe("intent://gettarget.vercel.app/login?next=%2Fapp#Intent;scheme=https;action=android.intent.action.VIEW;end");
  });
});
