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

/** Chat message incl. the OpenAI tool-calling shapes used by the connector agent loop. */
export type LLMMessage = ChatMsg | {
  role: "assistant" | "tool"; content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

export type LLMOpts = {
  messages: LLMMessage[]; stream?: boolean; temperature?: number; maxTokens?: number; timeoutMs?: number;
  /** OpenAI-compatible function tools. Models/providers that reject them are skipped. */
  tools?: unknown[];
};

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
  for (const p of ps) {
    for (const model of p.models) {
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
      // OpenRouter routes across its own list itself; one model attempt per provider is enough after a 429.
      if (p.name === "openrouter" && last === 429) break;
    }
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
