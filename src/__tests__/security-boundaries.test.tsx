import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

/**
 * Static guards for the service-role boundary (checked 2026-11-03: the public anon key gets
 * 403 not_admin from /auth/v1/admin/users, so user listing/creation needs the service key,
 * which must stay server-only).
 */
const ROOT = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(ROOT).map((p) => ({ path: relative(ROOT, p), src: readFileSync(p, "utf8") }));
const isClient = (src: string) => /^\s*["']use client["']/.test(src);

describe("service-role key stays on the server", () => {
  it("no client component imports the admin client or server-only modules", () => {
    const bad = files.filter((f) => isClient(f.src) && /from\s+["']@\/lib\/(supabase\/admin|server\/)/.test(f.src)).map((f) => f.path);
    expect(bad).toEqual([]);
  });

  it("no client component reads a server secret from the environment", () => {
    const secretEnv = /process\.env\.(SUPABASE_SERVICE_ROLE_KEY|CONNECTOR_ENCRYPTION_KEY|TOKEN_ENCRYPTION_KEY|CRON_SECRET|SESSION_WORKER_SECRET|VAPID_PRIVATE_KEY|[A-Z_]*CLIENT_SECRET|[A-Z_]*API_KEY)\b/;
    const bad = files.filter((f) => isClient(f.src) && secretEnv.test(f.src)).map((f) => f.path);
    expect(bad).toEqual([]);
  });

  it("only the admin helper builds a client from the service-role key", () => {
    const users = files.filter((f) => /SUPABASE_SERVICE_ROLE_KEY/.test(f.src) && /createClient\(/.test(f.src)).map((f) => f.path);
    expect(users).toEqual([join("lib", "supabase", "admin.ts")]);
  });

  it("every API route that uses the admin client checks a user session or a shared secret", () => {
    const routes = files.filter((f) => f.path.startsWith(join("app", "api")) && f.path.endsWith("route.ts") && f.src.includes("createAdminClient"));
    expect(routes.length).toBeGreaterThan(0);
    const unguarded = routes.filter((f) => !/requireUser\(|requireAdmin\(|cronAuth\(|workerAuth\(|auth\.getUser\(/.test(f.src)).map((f) => f.path);
    expect(unguarded).toEqual([]);
  });

  it("nothing calls the auth admin REST endpoint directly (use the server-side admin client)", () => {
    const bad = files.filter((f) => /\/auth\/v1\/admin\//.test(f.src)).map((f) => f.path);
    expect(bad).toEqual([]);
  });
});

describe("admin panel boundary (/admin, /api/admin)", () => {
  const adminRoutes = files.filter((f) => f.path.startsWith(join("app", "api", "admin")) && f.path.endsWith("route.ts"));
  const adminPages = files.filter((f) => f.path.startsWith(join("app", "admin")) && f.path.endsWith("page.tsx"));

  it("every /api/admin route handler checks requireAdmin() first", () => {
    expect(adminRoutes.length).toBeGreaterThanOrEqual(7);
    for (const f of adminRoutes) {
      const handlers = f.src.match(/export async function (GET|POST|PATCH|PUT|DELETE)\([^]*?\n}/g) ?? [];
      expect(handlers.length, f.path).toBeGreaterThan(0);
      for (const fn of handlers) expect(fn, f.path).toMatch(/const a = await requireAdmin\(\);\s*\n\s*if \(!a\) return adminNotFound\(\);/);
    }
  });

  it("every /admin page (and the layout) calls requireAdminPage()", () => {
    expect(adminPages.length).toBeGreaterThanOrEqual(9);
    for (const f of [...adminPages, ...files.filter((x) => x.path === join("app", "admin", "layout.tsx"))]) expect(f.src, f.path).toMatch(/await requireAdminPage\(\)/);
  });

  it("the proxy matches /admin so non-admins get 404 before page code runs", () => {
    const proxy = files.find((f) => f.path === "proxy.ts")!;
    expect(proxy.src).toContain('"/admin"');
    expect(proxy.src).toContain('"/admin/:path*"');
  });

  it("admin code never selects secret columns", () => {
    const adminCode = files.filter((f) => /admin/i.test(f.path) && !f.path.includes("__tests__"));
    for (const f of adminCode) expect(f.src, f.path).not.toMatch(/secret_box|key_box|encrypted_credentials|encrypted_cookies|ciphertext|\bpreview\b.*vault|key_preview/);
  });

  it("the Monetag tag never loads on /admin and the zone is unchanged", () => {
    const tag = files.find((f) => f.path === join("components", "AdTag.tsx"))!;
    expect(tag.src).toContain("12150496");
    expect(tag.src).toContain("(app|admin|login|auth)");
  });
});

