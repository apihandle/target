import { AsyncLocalStorage } from "node:async_hooks";

/**
 * AI usage logging (table ai_usage, migration 0020). SERVER ONLY.
 *
 * One row per model attempt made by llm() (src/lib/llm.ts): provider, model, feature, tokens when the API returns
 * them, latency, time to first token, success / error code, race outcome. Rows are built from a fixed whitelist of
 * fields, so prompt text, response text, keys and custom provider names/URLs can never reach the table.
 *
 * Fire-and-forget: logAiUsage() returns immediately, never throws and never rejects. A missing service-role key,
 * a missing table or a database that is down only means the row is dropped; the chat carries on untouched.
 */

export type AiProvider = "nim" | "openrouter" | "custom";
export type AiUsageContext = { userId?: string | null; feature?: string };

export type AiUsageRow = {
  user_id: string | null;
  request_id: string | null;
  provider: AiProvider;
  model: string;
  feature: string;
  attempt: number | null;
  streamed: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  ttft_ms: number | null;
  success: boolean;
  error_code: string | null;
  race_won: boolean | null;
};

export type AiUsageInput = Partial<Omit<AiUsageRow, "provider" | "model">> & { provider: string; model: string };

/** Features the admin page knows by name (anything else is stored as given if it is a safe slug, else "other"). */
export const AI_FEATURES = ["chat", "chat_quick", "scheduled", "browser", "video", "research", "memory", "suggestions", "proactive", "panels", "other"] as const;

const store = new AsyncLocalStorage<AiUsageContext>();

/** Run fn with a user/feature attached to every llm() call made inside it (including after awaits). */
export function withAiUsage<T>(ctx: AiUsageContext, fn: () => T): T {
  const parent = store.getStore();
  return store.run({ ...parent, ...ctx }, fn);
}

export function aiUsageContext(): AiUsageContext {
  return store.getStore() ?? {};
}

export function providerKey(name: string): AiProvider | null {
  return name === "nvidia" || name === "nim" ? "nim" : name === "openrouter" ? "openrouter" : name === "custom" ? "custom" : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9_]{1,32}$/;
const CODE = /^[a-z0-9_]{1,40}$/;
const int = (v: unknown, max = 2_000_000_000): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : null);

/** Whitelist + clamp. Anything unexpected becomes null; unknown keys are dropped. Returns null when unusable. */
export function sanitizeAiUsage(input: AiUsageInput): AiUsageRow | null {
  const provider = providerKey(String(input.provider ?? ""));
  const model = typeof input.model === "string" ? input.model.trim().slice(0, 160) : "";
  if (!provider || !model) return null;
  const feature = typeof input.feature === "string" && SLUG.test(input.feature) ? input.feature : "other";
  const code = typeof input.error_code === "string" ? input.error_code.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40) : null;
  return {
    user_id: typeof input.user_id === "string" && UUID.test(input.user_id) ? input.user_id : null,
    request_id: typeof input.request_id === "string" && UUID.test(input.request_id) ? input.request_id : null,
    provider, model, feature,
    attempt: int(input.attempt, 100),
    streamed: input.streamed === true,
    input_tokens: int(input.input_tokens),
    output_tokens: int(input.output_tokens),
    latency_ms: int(input.latency_ms),
    ttft_ms: int(input.ttft_ms),
    success: input.success === true,
    error_code: code && CODE.test(code) ? code : null,
    race_won: typeof input.race_won === "boolean" ? input.race_won : null,
  };
}

/** Where rows go. Default: insert with the service-role client. Tests swap it with setAiUsageSink(). */
export type AiUsageSink = (row: AiUsageRow) => PromiseLike<unknown> | void;

const defaultSink: AiUsageSink = async (row) => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const insert = Promise.resolve(createAdminClient().from("ai_usage").insert(row)).then((r) => { if (r.error) throw new Error("insert failed"); });
  insert.catch(() => undefined); // handled right away (it may fail while after() is loading); still awaited below
  // Keep the serverless function alive until the row is written (Vercel waitUntil via next/server's after()).
  // Outside a request scope after() throws; the insert simply runs on its own then.
  try { const { after } = await import("next/server"); after(() => insert.catch(() => undefined)); } catch { /* no request scope */ }
  await insert;
};

let sink: AiUsageSink = defaultSink;
export function setAiUsageSink(s: AiUsageSink | null) { sink = s ?? defaultSink; }

/** Off switch for local experiments: AI_USAGE_LOG=off. */
const enabled = () => (process.env.AI_USAGE_LOG ?? "").toLowerCase() !== "off";

let failures = 0;
/** Log one attempt. Never awaits the insert, never throws, never rejects. */
export function logAiUsage(input: AiUsageInput): void {
  try {
    if (!enabled()) return;
    const row = sanitizeAiUsage(input);
    if (!row) return;
    const p = sink(row);
    if (p && typeof (p as Promise<unknown>).then === "function") {
      Promise.resolve(p).then(undefined, () => {
        // One quiet line per 50 failures, so a missing table doesn't flood the logs.
        if (failures++ % 50 === 0) console.warn("[ai-usage] insert failed (migration 0020 not run, or the database is down); usage row dropped");
      });
    }
  } catch {
    if (failures++ % 50 === 0) console.warn("[ai-usage] logging skipped");
  }
}

/** Pulls token counts out of an OpenAI-style `usage` object (null when absent). */
export function readUsage(u: unknown): { input: number | null; output: number | null } {
  if (!u || typeof u !== "object") return { input: null, output: null };
  const o = u as Record<string, unknown>;
  return { input: int(o.prompt_tokens ?? o.input_tokens), output: int(o.completion_tokens ?? o.output_tokens) };
}

/** Finds the last `usage` object in a chunk of SSE text (OpenRouter sends it in the final chunk). */
export function usageFromSse(text: string): { input: number | null; output: number | null } | null {
  if (!text.includes("\"usage\"")) return null;
  let found: { input: number | null; output: number | null } | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("data:") || !line.includes("\"usage\"")) continue;
    try {
      const u = readUsage(JSON.parse(line.slice(5).trim()).usage);
      if (u.input != null || u.output != null) found = u;
    } catch { /* partial line */ }
  }
  return found;
}
