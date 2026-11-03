import { lookup as dnsLookup, type LookupAddress } from "dns";
import http from "http";
import https from "https";
import { isIP, type LookupFunction } from "net";
import { Readable } from "stream";
import { isBlockedHostname, isBlockedIp } from "@/lib/customProvider";

/**
 * SSRF-guarded fetch for user-supplied endpoints (custom AI providers).
 * - The address is checked AFTER DNS resolution, inside the socket's own lookup, so a hostname that resolves
 *   (or re-resolves, DNS rebinding) to loopback/private/link-local/metadata space is refused at connect time.
 * - IP-literal hosts are checked up front (Node skips lookup for them).
 * - Redirects are never followed (a 3xx comes back as-is and callers treat it as an error).
 * - Timeout until response headers, and a byte cap on the body (the stream errors past it).
 */
export type SafeInit = {
  method?: "GET" | "POST"; headers?: Record<string, string>; body?: string; signal?: AbortSignal;
  /** Time allowed until response headers arrive. */
  timeoutMs?: number;
  /** Maximum response body size in bytes. */
  maxBytes?: number;
};

export class BlockedAddressError extends Error {
  constructor(msg = "That address is private or local") { super(msg); this.name = "BlockedAddressError"; }
}

type LookupFn = (host: string, cb: (err: Error | null, addrs: LookupAddress[]) => void) => void;
const defaultResolve: LookupFn = (host, cb) => dnsLookup(host, { all: true, verbatim: true }, cb);

/** net-compatible lookup that refuses blocked addresses. Exported for tests. */
export function guardedLookup(resolve: LookupFn = defaultResolve): LookupFunction {
  return ((hostname: string, options: { all?: boolean; family?: number } | number, cb: (...a: unknown[]) => void) => {
    const opts = typeof options === "object" && options ? options : {};
    resolve(hostname, (err, addrs) => {
      if (err) return cb(err);
      const list = (addrs ?? []).filter((a) => !opts.family || a.family === opts.family);
      if (!list.length) return cb(Object.assign(new Error(`No address for ${hostname}`), { code: "ENOTFOUND" }));
      if (list.some((a) => isBlockedIp(a.address))) return cb(new BlockedAddressError());
      if (opts.all) return cb(null, list);
      cb(null, list[0].address, list[0].family);
    });
  }) as unknown as LookupFunction;
}

/** Resolve a hostname and report whether every address is public (used when saving a provider). */
export function resolvesPublic(host: string, resolve: LookupFn = defaultResolve): Promise<boolean> {
  const h = host.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(h)) return Promise.resolve(false);
  if (isIP(h)) return Promise.resolve(!isBlockedIp(h));
  return new Promise((r) => resolve(h, (err, addrs) => r(!err && !!addrs?.length && addrs.every((a) => !isBlockedIp(a.address)))));
}

export function safeFetch(rawUrl: string, init: SafeInit = {}, resolve?: LookupFn): Promise<Response> {
  const { timeoutMs = 15000, maxBytes = 2_000_000 } = init;
  return new Promise<Response>((resolveP, reject) => {
    let url: URL;
    try { url = new URL(rawUrl); } catch { return reject(new TypeError("Bad URL")); }
    if (url.protocol !== "https:" && url.protocol !== "http:") return reject(new TypeError("Unsupported protocol"));
    if (url.username || url.password) return reject(new TypeError("Credentials in URL"));
    if (isBlockedHostname(url.hostname)) return reject(new BlockedAddressError());
    const mod = url.protocol === "https:" ? https : http;
    let settled = false;
    const fail = (e: unknown) => { if (!settled) { settled = true; reject(e); } };
    const req = mod.request(url, {
      method: init.method ?? "GET",
      headers: { ...(init.headers ?? {}), ...(init.body !== undefined ? { "Content-Length": String(Buffer.byteLength(init.body)) } : {}) },
      lookup: guardedLookup(resolve),
      agent: false,
    });
    const timer = setTimeout(() => { req.destroy(Object.assign(new Error("Timed out"), { name: "TimeoutError" })); }, timeoutMs);
    const onAbort = () => req.destroy(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    if (init.signal) {
      if (init.signal.aborted) { clearTimeout(timer); return reject(Object.assign(new Error("Aborted"), { name: "AbortError" })); }
      init.signal.addEventListener("abort", onAbort, { once: true });
    }
    req.on("error", (e) => { clearTimeout(timer); fail(e); });
    req.on("response", (res) => {
      clearTimeout(timer);
      let seen = 0;
      res.on("data", (chunk: Buffer) => {
        seen += chunk.length;
        if (seen > maxBytes) res.destroy(new Error("Response too large"));
      });
      res.on("close", () => init.signal?.removeEventListener("abort", onAbort));
      const headers = new Headers();
      for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : String(v));
      const status = res.statusCode ?? 502;
      const nullBody = status === 204 || status === 304;
      if (nullBody) res.resume();
      settled = true;
      resolveP(new Response(nullBody ? null : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>), { status: status < 200 || status > 599 ? 502 : status, headers }));
    });
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

/** Read a body as text with a hard cap (bytes), for non-streaming calls. */
export async function readCapped(r: Response, maxBytes = 2_000_000): Promise<string> {
  if (!r.body) return "";
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let out = "", n = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > maxBytes) { reader.cancel().catch(() => undefined); throw new Error("Response too large"); }
    out += dec.decode(value, { stream: true });
  }
  return out + dec.decode();
}
