import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

import nextConfigRaw from "../../next.config.mjs"; // plain ESM config, no type declarations

type HeaderEntry = { source: string; headers: { key: string; value: string }[] };
const nextConfig = nextConfigRaw as unknown as { headers: () => Promise<HeaderEntry[]> };

/**
 * Fix #6 guards: the Monetag ad integration (nap5k.com tag + 3nbf4.com remote
 * service worker) is removed, and a Content-Security-Policy is served on every
 * route from next.config.mjs headers().
 */
const SRC = join(__dirname, "..");
const ROOT = join(__dirname, "..", "..");

async function globalHeaders(): Promise<Record<string, string>> {
  const entries = await nextConfig.headers();
  const all = entries.find((e) => e.source === "/:path*");
  expect(all, "a /:path* header block must exist").toBeTruthy();
  return Object.fromEntries(all!.headers.map((h) => [h.key, h.value]));
}

describe("fix #6: Monetag is gone", () => {
  it("AdTag.tsx is deleted and the root layout does not reference it", () => {
    expect(existsSync(join(SRC, "components", "AdTag.tsx"))).toBe(false);
    const layout = readFileSync(join(SRC, "app", "layout.tsx"), "utf8");
    expect(layout).not.toMatch(/AdTag|nap5k|[Mm]onetag/);
  });

  it("public/sw.js loads no remote code (no remote importScripts, no http URLs)", () => {
    const sw = readFileSync(join(ROOT, "public", "sw.js"), "utf8");
    expect(sw).not.toMatch(/importScripts\s*\(\s*["']https?:/);
    expect(sw).not.toMatch(/["']https?:\/\//);
    expect(sw).not.toMatch(/importScripts\s*\(/);
  });
});

describe("fix #6: Content-Security-Policy", () => {
  it("is present on every route with default-src 'self' and no ad origins", async () => {
    const headers = await globalHeaders();
    const csp = headers["Content-Security-Policy"];
    expect(csp, "Content-Security-Policy header").toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toMatch(/nap5k|3nbf4/);
  });

  it("script-src allows no remote origin at all", async () => {
    const headers = await globalHeaders();
    const csp = headers["Content-Security-Policy"];
    const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"))!;
    expect(scriptSrc).toBeTruthy();
    expect(scriptSrc).not.toMatch(/https?:/);
    expect(scriptSrc).not.toContain("*");
    expect(scriptSrc).toContain("'self'");
  });

  it("keeps the baseline hardening headers alongside the CSP", async () => {
    const headers = await globalHeaders();
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(headers["Referrer-Policy"]).toBeTruthy();
    expect(headers["Strict-Transport-Security"]).toContain("max-age=");
  });
});
