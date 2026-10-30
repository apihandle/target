import type { ChatMsg } from "@/lib/ai";

type Provider = { name: string; url: string; key: string; models: string[]; extra?: Record<string, unknown>; headers?: Record<string, string>; minTokens?: number };

const list = (v: string | undefined, d: string) => (v || d).split(",").map((m) => m.trim()).filter(Boolean);

/** Providers in priority order: NVIDIA NIM (free credits) first, OpenRouter free tier as fallback. */
export function providers(env: Record<string, string | undefined> = process.env): Provider[] {
  const out: Provider[] = [];
  if (env.NVIDIA_API_KEY) out.push({
    name: "nvidia", url: "https://integrate.api.nvidia.com/v1/chat/completions", key: env.NVIDIA_API_KEY,
    models: list(env.NVIDIA_MODELS, "mistralai/mistral-large-4-1t-a52b,openai/gpt-oss-20b,nvidia/nemotron-3.5-lightning-30b-a3b"),
    // These models think before answering; keep it short and leave room for the visible reply.
    extra: { reasoning_effort: "low" }, minTokens: 2000,
  });
  if (env.OPENROUTER_API_KEY) out.push({
    name: "openrouter", url: "https://openrouter.ai/api/v1/chat/completions", key: env.OPENROUTER_API_KEY,
    models: list(env.OPENROUTER_MODEL, "nvidia/nemotron-3.5-super-vl:free,nvidia/nemotron-3-ultra-550b-a55b:free,openrouter/free"),
    extra: { reasoning: { effort: "low", exclude: true } },
    headers: { "HTTP-Referer": "https://gettarget.vercel.app", "X-Title": "TARGET" },
  });
  return out;
}

/** OpenAI-style multimodal content (text + images) for vision-capable models. */
export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/** Chat message incl. the OpenAI tool-calling shapes used by the connector agent loop. */
export type LLMMessage = ChatMsg | { role: "user"; content: ContentPart[] } | {
  role: "assistant" | "tool"; content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

export type LLMOpts = {
  messages: LLMMessage[]; stream?: boolean; temperature?: number; maxTokens?: number; timeoutMs?: number;
  /** OpenAI-compatible function tools. Models/providers that reject them are skipped. */
  tools?: unknown[];
  /** Try this model first (from the model picker); every other configured model stays as fallback. */
  prefer?: ModelRef | null;
  /** Restrict to these models (e.g. vision-capable ones when images are attached). */
  only?: ModelRef[];
};

export type ModelRef = { provider: string; model: string };
export type ModelOption = ModelRef & { id: string; label: string; vision: boolean };

/** Stable id used by the model picker: "provider:model" (model ids may themselves contain ":"). */
export const modelId = (r: ModelRef) => `${r.provider}:${r.model}`;
export const AUTO_MODEL = "auto";

/** Models the server may use: exactly the configured NVIDIA_MODELS / OPENROUTER_MODEL lists (or their defaults). */
export function modelOptions(env: Record<string, string | undefined> = process.env): ModelOption[] {
  const vision = visionMatcher(env);
  return providers(env).flatMap((p) => p.models.map((model) => ({
    provider: p.name, model, id: modelId({ provider: p.name, model }),
    label: `${model.split("/").pop()} · ${p.name === "nvidia" ? "NVIDIA" : "OpenRouter"}`,
    vision: vision(p.name, model),
  })));
}

/** Validate a picker value against the allow-list. Anything unknown (or "auto") means no preference. */
export function resolveModel(value: unknown, env: Record<string, string | undefined> = process.env): ModelOption | null {
  if (typeof value !== "string" || !value || value === AUTO_MODEL || value.length > 200) return null;
  return modelOptions(env).find((o) => o.id === value) ?? null;
}

/**
 * Vision support: VISION_MODELS (comma list of "provider:model" or bare model ids) when set,
 * otherwise a name heuristic for well-known vision models ("-vl", "vision", llava, pixtral, gemma-3…).
 */
function visionMatcher(env: Record<string, string | undefined>) {
  const explicit = (env.VISION_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  if (explicit.length) return (provider: string, model: string) => explicit.includes(model) || explicit.includes(`${provider}:${model}`);
  return (_provider: string, model: string) => /(^|[-/_.])(vl|vision|llava|pixtral)([-_:.]|$)|gemma-3|llama-4|qwen2\.5-vl|-vl-/i.test(model);
}

export function visionModels(env: Record<string, string | undefined> = process.env): ModelRef[] {
  return modelOptions(env).filter((o) => o.vision).map(({ provider, model }) => ({ provider, model }));
}

/** Provider/model attempts in order: the preferred model first, then the normal NVIDIA → OpenRouter order. */
export function orderCandidates(ps: Provider[], prefer?: ModelRef | null, only?: ModelRef[]): { p: Provider; model: string }[] {
  let list = ps.flatMap((p) => p.models.map((model) => ({ p, model })));
  if (only) list = list.filter((c) => only.some((o) => o.provider === c.p.name && o.model === c.model));
  if (prefer) {
    const i = list.findIndex((c) => c.p.name === prefer.provider && c.model === prefer.model);
    if (i > 0) list = [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
  }
  return list;
}

export class LLMError extends Error {
  /** True when every model refused the request while tools were attached (likely no tool-calling support). */
  public toolsRejected = false;
  constructor(msg: string, public status: number) { super(msg); }
}

/** Try each provider/model until one answers OK. Returns the raw Response (SSE when stream). */
export async function llm(opts: LLMOpts): Promise<Response> {
  const ps = providers();
  if (!ps.length) throw new LLMError("AI is not configured", 503);
  let last = 502, rateLimited = false, toolRefusals = 0, attempts = 0;
  const withTools = !!opts.tools?.length;
  const candidates = orderCandidates(ps, opts.prefer, opts.only);
  if (!candidates.length) throw new LLMError("No AI model is available for this request", 503);
  const openrouter429 = new Set<string>();
  for (const { p, model } of candidates) {
    // OpenRouter routes across its own list itself; one model attempt per provider is enough after a 429.
    if (openrouter429.has(p.name)) continue;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 25000);
    try {
      const r = await fetch(p.url, {
        method: "POST", signal: ctrl.signal,
        headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json", ...(p.headers ?? {}) },
        body: JSON.stringify({
          model, messages: opts.messages, stream: !!opts.stream,
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
          max_tokens: Math.max(opts.maxTokens ?? 2048, p.minTokens ?? 0), ...(p.extra ?? {}),
          ...(withTools ? { tools: opts.tools, tool_choice: "auto" } : {}),
        }),
      });
      attempts++;
      if (r.ok && r.body) { clearTimeout(timer); return r; }
      last = r.status; if (r.status === 429) rateLimited = true;
      // 400/404/422 with tools attached usually means "this model/route can't do tool calling".
      if (withTools && (r.status === 400 || r.status === 404 || r.status === 422)) toolRefusals++;
      await r.text().catch(() => "");
    } catch { last = 504; attempts++; }
    clearTimeout(timer);
    if (p.name === "openrouter" && last === 429) openrouter429.add(p.name);
  }
  const e = new LLMError(rateLimited && last === 429 ? "TARGET's free AI quota is used up for now. Try again later." : `AI error ${last}`, rateLimited && last === 429 ? 429 : 502);
  e.toolsRejected = withTools && toolRefusals > 0 && !rateLimited && toolRefusals >= Math.ceil(attempts / 2);
  throw e;
}

/** Non-streaming helper: returns the reply text ("" on any failure). */
export async function llmText(opts: Omit<LLMOpts, "stream">): Promise<string> {
  try {
    const r = await llm({ ...opts, stream: false, timeoutMs: opts.timeoutMs ?? 20000 });
    const j = await r.json();
    return String(j.choices?.[0]?.message?.content ?? "").trim();
  } catch { return ""; }
}
