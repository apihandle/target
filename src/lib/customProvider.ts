import { BlockList, isIP } from "net";
import { z } from "zod";

/**
 * Custom AI providers: a signed-in user adds their own OpenAI-compatible endpoint (name, base URL, API key,
 * model ids) and picks it in the model picker. This file holds the pure parts: input validation, base-URL
 * shape checks, the blocked-address list used after DNS resolution, key masking and picker ids.
 * Network calls live in lib/server/safeFetch.ts and lib/server/customProviders.ts. See docs/CUSTOM-PROVIDER.md.
 */
export const MAX_CUSTOM_PROVIDERS = 10;
export const MAX_CUSTOM_MODELS = 20;
export const CUSTOM_PREFIX = "custom:";

type Env = Record<string, string | undefined>;

/** http:// is only accepted outside production (local model servers during development). */
export function httpAllowed(env: Env = process.env): boolean {
  if (env.VERCEL_ENV === "production") return false;
  if (env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "development") return env.CUSTOM_PROVIDER_ALLOW_HTTP === "1";
  return env.NODE_ENV !== "production" || env.CUSTOM_PROVIDER_ALLOW_HTTP === "1";
}

// --------------------------------------------------------------------------------------------- blocked IPs
const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as [string, number][]) blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 128], ["::1", 128], ["::", 96] /* IPv4-compatible */, ["64:ff9b::", 96] /* NAT64 */, ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 32] /* Teredo */, ["2001:db8::", 32], ["2002::", 16] /* 6to4 */, ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as [string, number][]) blocked.addSubnet(net, bits, "ipv6");

/** True for loopback, private, link-local, CGNAT, metadata (169.254.169.254, fd00:ec2::254), multicast, reserved. */
export function isBlockedIp(ip: string): boolean {
  const v = ip.replace(/^\[|\]$/g, "").split("%")[0];
  const fam = isIP(v);
  if (fam === 4) return blocked.check(v, "ipv4");
  if (fam === 6) {
    const lower = v.toLowerCase();
    // IPv4-mapped (::ffff:a.b.c.d or ::ffff:7f00:1): judge the embedded IPv4 address.
    const m = lower.match(/^(?:0{0,4}:){0,5}:?ffff:(.+)$/);
    if (m) {
      const tail = m[1];
      if (isIP(tail) === 4) return blocked.check(tail, "ipv4");
      const parts = tail.split(":");
      if (parts.length === 2) {
        const n = (parseInt(parts[0], 16) << 16) | parseInt(parts[1], 16);
        const v4 = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
        return blocked.check(v4, "ipv4");
      }
      return true;
    }
    return blocked.check(v, "ipv6");
  }
  return true; // not an IP at all: refuse
}

/** Hostnames that are never public, before any DNS lookup. */
export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h) return true;
  if (isIP(h)) return isBlockedIp(h);
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa") || h.endsWith(".lan")) return true;
  if (h === "metadata" || h === "metadata.google.internal" || h.startsWith("metadata.")) return true;
  if (!h.includes(".")) return true; // single-label names resolve inside private networks
  // Numeric-looking hosts that aren't canonical IPs (0x7f.1, 2130706433, 127.1) are refused outright.
  if (/^[0-9.]+$/.test(h) || /^0x/i.test(h) || /(^|\.)0x[0-9a-f]+/i.test(h)) return true;
  return false;
}

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * Normalise a base URL ("https://api.example.com/v1") and check its shape: https only (http only outside
 * production), no credentials, query or fragment, no private host. A trailing /chat/completions or /models
 * is stripped so either form can be pasted. DNS is checked separately (on save and on every request).
 */
export function normalizeBaseUrl(raw: unknown, env: Env = process.env): UrlCheck {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "Enter the base URL" };
  const s = raw.trim();
  if (s.length > 300) return { ok: false, error: "That URL is too long" };
  let u: URL;
  try { u = new URL(s); } catch { return { ok: false, error: "That doesn't look like a URL (e.g. https://api.example.com/v1)" }; }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && httpAllowed(env))) return { ok: false, error: "The base URL must start with https://" };
  if (u.username || u.password) return { ok: false, error: "Don't put a username or password in the URL. Use the API key field." };
  if (u.search || u.hash) return { ok: false, error: "Remove the ?query or #part from the URL" };
  if (u.port) {
    const p = Number(u.port);
    if (!(p === 443 || p === 80 || (p >= 1024 && p <= 65535))) return { ok: false, error: "That port isn't allowed" };
  }
  if (isBlockedHostname(u.hostname)) return { ok: false, error: "That address is private or local. Use a public https URL." };
  const path = u.pathname.replace(/\/+$/, "").replace(/\/(chat\/completions|completions|models)$/i, "");
  return { ok: true, url: `${u.protocol}//${u.host}${path}` };
}

// --------------------------------------------------------------------------------------------- input
const modelIdRe = /^[\w.:/@+\-]{1,150}$/;
export const modelIdSchema = z.string().trim().regex(modelIdRe, "Model ids are letters, numbers and . _ - / : @ + (no spaces)");

export const providerInput = z.object({
  name: z.string().trim().min(1, "Give it a name").max(60, "Names are limited to 60 characters"),
  baseUrl: z.string().trim().min(1, "Enter the base URL").max(300),
  apiKey: z.string().trim().min(1, "Enter the API key").max(500, "That key is too long").refine((k) => !/\s/.test(k), "The API key can't contain spaces"),
  models: z.array(modelIdSchema).min(1, "Add at least one model id").max(MAX_CUSTOM_MODELS, `At most ${MAX_CUSTOM_MODELS} models`),
});
export const providerPatch = providerInput.partial();
export type ProviderInput = z.infer<typeof providerInput>;

/** De-duplicate model ids (keeping order). */
export const uniqueModels = (ms: string[]) => Array.from(new Set(ms.map((m) => m.trim()).filter(Boolean)));

/** Masked preview of an API key: never more than the last 4 characters (and a short known prefix). */
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length < 12) return "••••";
  const prefix = (k.match(/^(sk-or-|sk-ant-|sk-|nvapi-|gsk_|xai-|hf_)/)?.[1] ?? "").slice(0, 7);
  return `${prefix}••••${k.slice(-4)}`;
}

// --------------------------------------------------------------------------------------------- picker ids
export const customModelId = (providerId: string, model: string) => `${CUSTOM_PREFIX}${providerId}:${model}`;

export function parseCustomModelId(v: unknown): { providerId: string; model: string } | null {
  if (typeof v !== "string" || !v.startsWith(CUSTOM_PREFIX) || v.length > 200) return null;
  const rest = v.slice(CUSTOM_PREFIX.length);
  const i = rest.indexOf(":");
  if (i < 0) return null;
  const providerId = rest.slice(0, i), model = rest.slice(i + 1);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(providerId) || !modelIdRe.test(model)) return null;
  return { providerId, model };
}

/**
 * Did the provider refuse the request because it doesn't know the model id? 404 always counts; some providers
 * (OpenRouter: "x is not a valid model ID") answer 400/422 with a message naming the model instead.
 */
export function isUnknownModelError(status: number, text: string): boolean {
  if (status === 404) return true;
  if (status !== 400 && status !== 422) return false;
  return /not a valid model|invalid model|unknown model|model[^.]{0,80}(not found|does not exist|doesn't exist|not exist|not supported|is not available)|no (such )?model/i.test(text);
}

/** Remove anything that looks like the key from upstream text before it reaches the user. */
export function scrub(text: string, key?: string): string {
  let t = text.replace(/\s+/g, " ").trim().slice(0, 300);
  if (key && key.length >= 4) t = t.split(key).join("••••");
  return t.replace(/(sk-|nvapi-|gsk_|hf_)[A-Za-z0-9_\-]{8,}/g, "$1••••");
}
