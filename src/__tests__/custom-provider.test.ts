// Custom AI providers: validation, SSRF guard, key masking/sealing, routing, and the API routes end to end.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { FakeDb } from "./helpers/fakeSupabase";

let db = new FakeDb();
vi.mock("@/lib/supabase/server", () => ({ createClient: () => db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.admin() }));
// DNS for the routes: hosts under .example resolve "public"; anything named *.private.example resolves private.
vi.mock("@/lib/server/safeFetch", async (orig) => {
  const real = await orig<typeof import("@/lib/server/safeFetch")>();
  return { ...real, resolvesPublic: async (h: string) => !h.includes("private") };
});

import {
  customModelId, isBlockedHostname, isBlockedIp, isUnknownModelError, maskKey, normalizeBaseUrl, parseCustomModelId, providerInput, scrub,
} from "@/lib/customProvider";
import { guardedLookup, readCapped, safeFetch, BlockedAddressError } from "@/lib/server/safeFetch";
import { openKey, resolvePick, sealKey, customOptions } from "@/lib/server/customProviders";
import { chatUrl, llm, LLMError } from "@/lib/llm";
import * as listRoute from "@/app/api/custom-providers/route";
import * as oneRoute from "@/app/api/custom-providers/[id]/route";
import * as modelsRoute from "@/app/api/custom-providers/models/route";
import * as settingsRoute from "@/app/api/settings/route";
import * as pickerRoute from "@/app/api/models/route";

const KEY = Buffer.alloc(32, 7).toString("base64");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const SECRET = "sk-test-abcdefghijklmnop1234";

const PROD = { NODE_ENV: "production", VERCEL_ENV: "production" };
const DEV = { NODE_ENV: "development" };

describe("base URL validation", () => {
  it("accepts https and normalises the path", () => {
    expect(normalizeBaseUrl("https://api.groq.com/openai/v1/", PROD)).toEqual({ ok: true, url: "https://api.groq.com/openai/v1" });
    expect(normalizeBaseUrl("https://api.example.com/v1/chat/completions", PROD)).toEqual({ ok: true, url: "https://api.example.com/v1" });
    expect(normalizeBaseUrl("https://api.example.com:8443/v1/models", PROD)).toEqual({ ok: true, url: "https://api.example.com:8443/v1" });
  });
  it("allows http only outside production", () => {
    expect(normalizeBaseUrl("http://api.example.com/v1", PROD).ok).toBe(false);
    expect(normalizeBaseUrl("http://api.example.com/v1", DEV).ok).toBe(true);
    expect(normalizeBaseUrl("http://api.example.com/v1", { NODE_ENV: "production", VERCEL_ENV: "preview" }).ok).toBe(false);
  });
  it.each([
    "ftp://api.example.com", "https://user:pw@api.example.com/v1", "https://api.example.com/v1?x=1", "https://api.example.com/v1#a",
    "https://localhost/v1", "https://127.0.0.1/v1", "https://169.254.169.254/latest", "https://[::1]/v1", "https://[::ffff:127.0.0.1]/v1",
    "https://[fd00:ec2::254]/", "https://10.1.2.3/", "https://192.168.1.1/", "https://metadata.google.internal/", "https://intranet/",
    "https://2130706433/", "https://0x7f000001/", "https://127.1/", "https://api.example.com:22/", "https://foo.local/", "not a url", "",
  ])("rejects %s", (u) => { expect(normalizeBaseUrl(u, DEV).ok).toBe(false); });
});

describe("blocked addresses", () => {
  it.each(["127.0.0.1", "10.0.0.5", "172.20.1.1", "192.168.0.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1",
    "fd00:ec2::254", "fc00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1", "198.18.0.1"])("blocks %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "104.18.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows public %s", (ip) => { expect(isBlockedIp(ip)).toBe(false); });
  it("blocks non-public hostnames before DNS", () => {
    for (const h of ["localhost", "a.localhost", "x.internal", "box.local", "router.lan", "single"]) expect(isBlockedHostname(h)).toBe(true);
    expect(isBlockedHostname("api.openai.com")).toBe(false);
  });
});

describe("SSRF guard after DNS resolution", () => {
  const resolver = (map: Record<string, string[]>) => (h: string, cb: (e: Error | null, a: { address: string; family: number }[]) => void) =>
    cb(null, (map[h] ?? []).map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));

  it("refuses a hostname that resolves to a private address (incl. one bad address among good ones)", async () => {
    const look = guardedLookup(resolver({ "evil.example": ["8.8.8.8", "127.0.0.1"] }));
    const err = await new Promise((r) => (look as unknown as (h: string, o: object, cb: (e: unknown) => void) => void)("evil.example", { all: true }, r));
    expect(err).toBeInstanceOf(BlockedAddressError);
  });
  it("passes public addresses through (single and all forms)", async () => {
    const look = guardedLookup(resolver({ "good.example": ["8.8.8.8"] })) as unknown as (h: string, o: object, cb: (...a: unknown[]) => void) => void;
    expect(await new Promise((r) => look("good.example", { all: true }, (e, a) => r([e, a])))).toEqual([null, [{ address: "8.8.8.8", family: 4 }]]);
    expect(await new Promise((r) => look("good.example", {}, (e, a, f) => r([e, a, f])))).toEqual([null, "8.8.8.8", 4]);
  });
  it("never connects to a local server reached through DNS rebinding", async () => {
    let hits = 0;
    const srv = http.createServer((_q, s) => { hits++; s.end("secret"); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const port = (srv.address() as AddressInfo).port;
    try {
      await expect(safeFetch(`http://rebind.example:${port}/`, {}, resolver({ "rebind.example": ["127.0.0.1"] }))).rejects.toBeInstanceOf(BlockedAddressError);
      await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(BlockedAddressError);
      expect(hits).toBe(0);
    } finally { srv.close(); }
  });
  it("resolvesPublic checks every address", async () => {
    const { resolvesPublic: realResolvesPublic } = await vi.importActual<typeof import("@/lib/server/safeFetch")>("@/lib/server/safeFetch");
    expect(await realResolvesPublic("a.example", resolver({ "a.example": ["8.8.8.8"] }))).toBe(true);
    expect(await realResolvesPublic("b.example", resolver({ "b.example": ["8.8.8.8", "10.0.0.1"] }))).toBe(false);
    expect(await realResolvesPublic("127.0.0.1")).toBe(false);
  });
  it("caps response size", async () => {
    await expect(readCapped(new Response("x".repeat(5000)), 1000)).rejects.toThrow("too large");
    expect(await readCapped(new Response("ok"), 1000)).toBe("ok");
  });
});

describe("key handling", () => {
  beforeEach(() => { vi.stubEnv("CONNECTOR_ENCRYPTION_KEY", KEY); });
  afterEach(() => vi.unstubAllEnvs());
  it("masks keys to at most the last 4 characters", () => {
    expect(maskKey(SECRET)).toBe("sk-••••1234");
    expect(maskKey("short")).toBe("••••");
    expect(maskKey("abcdefghijklmnopqrstuvwxyz")).toBe("••••wxyz");
    expect(maskKey(SECRET)).not.toContain("abcdef");
  });
  it("seals the key bound to its owner", () => {
    const s = sealKey(A, SECRET);
    expect(s.key_box).not.toContain(SECRET);
    expect(openKey(A, s.key_box)).toBe(SECRET);
    expect(() => openKey(B, s.key_box)).toThrow();
  });
  it("scrubs keys out of upstream error text", () => {
    expect(scrub(`bad key ${SECRET}`, SECRET)).not.toContain(SECRET);
    expect(scrub("token sk-abcdefghijklmnopqrstuv leaked")).toBe("token sk-•••• leaked");
  });
  it("validates provider input", () => {
    expect(providerInput.safeParse({ name: "G", baseUrl: "https://x.example/v1", apiKey: SECRET, models: ["llama-3.3-70b"] }).success).toBe(true);
    expect(providerInput.safeParse({ name: "", baseUrl: "https://x.example/v1", apiKey: SECRET, models: ["m"] }).success).toBe(false);
    expect(providerInput.safeParse({ name: "G", baseUrl: "https://x.example/v1", apiKey: "has space", models: ["m"] }).success).toBe(false);
    expect(providerInput.safeParse({ name: "G", baseUrl: "https://x.example/v1", apiKey: SECRET, models: [] }).success).toBe(false);
    expect(providerInput.safeParse({ name: "G", baseUrl: "https://x.example/v1", apiKey: SECRET, models: ["bad id"] }).success).toBe(false);
  });
  it("picker ids round-trip and reject junk", () => {
    const id = customModelId(P, "meta-llama/Llama-3.3-70B:free");
    expect(parseCustomModelId(id)).toEqual({ providerId: P, model: "meta-llama/Llama-3.3-70B:free" });
    expect(parseCustomModelId("custom:not-a-uuid:m")).toBeNull();
    expect(parseCustomModelId("nvidia:x")).toBeNull();
    expect(customOptions([{ id: P, name: "Mine", base_url: "", models: ["a/b"], key_preview: "", created_at: "", updated_at: "" }])[0]).toMatchObject({ id: `custom:${P}:a/b`, label: "b · Mine", provider: "custom" });
  });
});

describe("unknown model errors", () => {
  it("treats 404 and OpenRouter-style 400 'not a valid model ID' as an unknown model", () => {
    expect(isUnknownModelError(404, "")).toBe(true);
    expect(isUnknownModelError(400, '{"error":{"message":"nonexistent/zzz is not a valid model ID","code":400}}')).toBe(true);
    expect(isUnknownModelError(422, '{"error":"The model `foo` does not exist"}')).toBe(true);
    expect(isUnknownModelError(400, '{"error":"tools not supported"}')).toBe(false);
    expect(isUnknownModelError(429, "model is rate-limited")).toBe(false);
    expect(isUnknownModelError(500, "model not found")).toBe(false);
  });
});

describe("routing", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const sse = (t: string) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\ndata: [DONE]\n\n`, { status: 200 });

  it("a custom model uses only that endpoint and key (no NVIDIA/OpenRouter, no extras)", async () => {
    vi.stubEnv("NVIDIA_API_KEY", "nv"); vi.stubEnv("OPENROUTER_API_KEY", "or");
    const global = vi.fn(); vi.stubGlobal("fetch", global);
    const own = vi.fn(async () => sse("hi"));
    const r = await llm({ messages: [{ role: "user", content: "x" }], stream: true, custom: { name: "Mine", url: chatUrl("https://api.example.com/v1"), key: SECRET, model: "m1", fetch: own } });
    expect(await r.text()).toContain("hi");
    expect(global).not.toHaveBeenCalled();
    expect(own).toHaveBeenCalledTimes(1);
    const [url, init] = own.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe(`Bearer ${SECRET}`);
    const body = JSON.parse(init.body);
    expect(body.model).toBe("m1");
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });
  it("does not fall back to the built-in models when the custom one fails", async () => {
    vi.stubEnv("NVIDIA_API_KEY", "nv");
    const global = vi.fn(); vi.stubGlobal("fetch", global);
    const own = vi.fn(async () => new Response("nope", { status: 401 }));
    await expect(llm({ messages: [], stream: true, custom: { name: "Mine", url: "https://a.example/v1/chat/completions", key: SECRET, model: "m", fetch: own } }))
      .rejects.toMatchObject({ message: expect.stringContaining("rejected the API key") });
    expect(global).not.toHaveBeenCalled();
  });
  it("flags tool refusal so chat retries without tools", async () => {
    const own = vi.fn(async () => new Response("tools not supported", { status: 400 }));
    const e = await llm({ messages: [], stream: true, tools: [{ type: "function" }], custom: { name: "Mine", url: "https://a.example/v1/chat/completions", key: SECRET, model: "m", fetch: own } }).catch((x) => x);
    expect(e).toBeInstanceOf(LLMError);
    expect(e.toolsRejected).toBe(true);
  });
  it("default (no custom) still uses the built-in providers", async () => {
    vi.stubEnv("NVIDIA_API_KEY", "nv"); vi.stubEnv("NVIDIA_MODELS", "a"); vi.stubEnv("OPENROUTER_API_KEY", "");
    const f = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await llm({ messages: [] });
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain("integrate.api.nvidia.com");
  });
  it("resolvePick: own custom model → route; someone else's or removed model → Auto", async () => {
    vi.stubEnv("CONNECTOR_ENCRYPTION_KEY", KEY);
    const fake = new FakeDb({ custom_providers: [{ id: P, user_id: A, name: "Mine", base_url: "https://api.example.com/v1", models: ["m1"], ...sealKey(A, SECRET) }] });
    const admin = fake.admin();
    const ok = await resolvePick(admin, A, customModelId(P, "m1"));
    expect(ok.custom).toMatchObject({ name: "Mine", url: "https://api.example.com/v1/chat/completions", key: SECRET, model: "m1" });
    expect((await resolvePick(admin, B, customModelId(P, "m1"))).custom).toBeNull();
    expect((await resolvePick(admin, A, customModelId(P, "gone"))).custom).toBeNull();
    expect((await resolvePick(admin, A, "auto")).custom).toBeNull();
  });
});

describe("API routes", () => {
  const req = (body: unknown, method = "POST") => new Request("http://t/x", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  beforeEach(() => { vi.stubEnv("CONNECTOR_ENCRYPTION_KEY", KEY); db = new FakeDb().as(A); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("creates a provider, stores the key encrypted and never returns it", async () => {
    const r = await listRoute.POST(req({ name: "Groq", baseUrl: "https://api.groq.example/openai/v1/chat/completions", apiKey: SECRET, models: ["llama", "llama"] }));
    expect(r.status).toBe(201);
    const j = await r.json();
    expect(JSON.stringify(j)).not.toContain(SECRET);
    expect(j.provider).toMatchObject({ name: "Groq", base_url: "https://api.groq.example/openai/v1", models: ["llama"], key_preview: "sk-••••1234" });
    expect(j.provider.key_box).toBeUndefined();
    const row = db.rows("custom_providers")[0];
    expect(row.key_box).toBeTruthy();
    expect(String(row.key_box)).not.toContain(SECRET);
    const list = await (await listRoute.GET()).json();
    expect(JSON.stringify(list)).not.toContain(SECRET);
    expect(JSON.stringify(list)).not.toContain(String(row.key_box));
  });
  it("refuses private addresses and http in production", async () => {
    expect((await listRoute.POST(req({ name: "x", baseUrl: "https://api.private.example/v1", apiKey: SECRET, models: ["m"] }))).status).toBe(400);
    expect((await listRoute.POST(req({ name: "x", baseUrl: "https://127.0.0.1/v1", apiKey: SECRET, models: ["m"] }))).status).toBe(400);
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await listRoute.POST(req({ name: "x", baseUrl: "http://api.example.com/v1", apiKey: SECRET, models: ["m"] }))).status).toBe(400);
  });
  it("is per-user: another user can't see, edit, delete or pick it", async () => {
    db = new FakeDb({ custom_providers: [{ id: P, user_id: A, name: "Mine", base_url: "https://api.example.com/v1", models: ["m1"], ...sealKey(A, SECRET) }] }).as(B);
    expect((await (await listRoute.GET()).json()).providers).toEqual([]);
    expect((await oneRoute.PATCH(req({ name: "hacked" }, "PATCH"), ctx(P))).status).toBe(404);
    expect((await oneRoute.DELETE(req({}, "DELETE"), ctx(P))).status).toBe(404);
    expect((await settingsRoute.PATCH(req({ preferred_model: customModelId(P, "m1") }, "PATCH"))).status).toBe(400);
    expect((await modelsRoute.POST(req({ id: P }))).status).toBe(404);
    expect(db.rows("custom_providers")[0].name).toBe("Mine");
  });
  it("edit keeps the saved key, but a new host needs the key again", async () => {
    db = new FakeDb({ custom_providers: [{ id: P, user_id: A, name: "Mine", base_url: "https://api.example.com/v1", models: ["m1"], ...sealKey(A, SECRET) }] }).as(A);
    const r = await oneRoute.PATCH(req({ name: "Renamed", apiKey: "", models: ["m1", "m2"] }, "PATCH"), ctx(P));
    expect(r.status).toBe(200);
    expect(openKey(A, String(db.rows("custom_providers")[0].key_box))).toBe(SECRET);
    const moved = await oneRoute.PATCH(req({ baseUrl: "https://other.example/v1" }, "PATCH"), ctx(P));
    expect(moved.status).toBe(400);
    expect((await moved.json()).field).toBe("apiKey");
    const own = await modelsRoute.POST(req({ id: P, baseUrl: "https://other.example/v1" }));
    expect(own.status).toBe(400);
  });
  it("picker lists own custom models; settings accepts them; delete resets the pick", async () => {
    db = new FakeDb({ custom_providers: [{ id: P, user_id: A, name: "Mine", base_url: "https://api.example.com/v1", models: ["m1"], ...sealKey(A, SECRET) }] }).as(A);
    expect((await settingsRoute.PATCH(req({ preferred_model: customModelId(P, "m1") }, "PATCH"))).status).toBe(200);
    const pick = await (await pickerRoute.GET()).json();
    expect(pick.selected).toBe(customModelId(P, "m1"));
    expect(pick.options.some((o: { id: string }) => o.id === customModelId(P, "m1"))).toBe(true);
    expect(JSON.stringify(pick)).not.toContain(SECRET);
    expect((await oneRoute.DELETE(req({}, "DELETE"), ctx(P))).status).toBe(200);
    expect(db.rows("user_settings")[0].preferred_model).toBeNull();
  });
});
