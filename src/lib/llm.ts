import type { ChatMsg } from "@/lib/ai";
import { aiUsageContext, logAiUsage, readUsage, usageFromSse, type AiUsageContext } from "@/lib/aiUsage";

type Provider = {
  name: string; url: string; key: string; models: string[]; extra?: Record<string, unknown>; headers?: Record<string, string>; minTokens?: number;
  /** Request extras for quick turns (small talk): no thinking, so the first word arrives in about a second. */
  fastExtra?: Record<string, unknown>;
  /** Quick-turn models on this provider, in order. */
  fastModels?: string[];
  /** Transport override (custom providers use the SSRF-guarded fetch). Defaults to global fetch. */
  fetch?: (url: string, init: { method: "POST"; signal: AbortSignal; headers: Record<string, string>; body: string }) => Promise<Response>;
};

/**
 * A user's own OpenAI-compatible provider (Settings → AI providers). When set, llm() calls only this endpoint:
 * no NVIDIA/OpenRouter race, no fallback, no provider-specific extras.
 */
export type CustomRoute = { name: string; url: string; key: string; model: string; fetch?: Provider["fetch"] };

const list = (v: string | undefined, d: string) => (v || d).split(",").map((m) => m.trim()).filter(Boolean);

/** Providers in priority order: NVIDIA NIM (free credits) first, OpenRouter free tier as fallback. */
export function providers(env: Record<string, string | undefined> = process.env): Provider[] {
  const out: Provider[] = [];
  if (env.NVIDIA_API_KEY) out.push({
    name: "nvidia", url: "https://integrate.api.nvidia.com/v1/chat/completions", key: env.NVIDIA_API_KEY,
    // Measured Nov 2026: nemotron-3-ultra starts answering in ~1 s and handles tools well; mistral-large-4 often
    // thinks for 60-90 s before the first word, so it is only a fallback now.
    models: list(env.NVIDIA_MODELS, "nvidia/nemotron-3-ultra-550b-a55b,mistralai/mistral-large-4-1t-a52b,nvidia/nemotron-3.5-lightning-30b-a3b,openai/gpt-oss-20b"),
    // These models think before answering; keep it short and leave room for the visible reply.
    extra: { reasoning_effort: "low" }, minTokens: 2000,
    fastModels: list(env.NVIDIA_FAST_MODELS, "nvidia/nemotron-3-ultra-550b-a55b,nvidia/nemotron-3.5-bolt-e4b,nvidia/nemotron-3.5-lightning-30b-a3b"),
    fastExtra: { reasoning_effort: "none" },
  });
  if (env.OPENROUTER_API_KEY) out.push({
    name: "openrouter", url: "https://openrouter.ai/api/v1/chat/completions", key: env.OPENROUTER_API_KEY,
    models: list(env.OPENROUTER_MODEL, "nvidia/nemotron-3.5-super-vl:free,nvidia/nemotron-3-ultra-550b-a55b:free,openrouter/free"),
    extra: { reasoning: { effort: "low", exclude: true } },
    fastModels: list(env.OPENROUTER_FAST_MODELS, "openrouter/free"),
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
  /** Quick turn (small talk, short questions without tools): use the fast models with thinking off. */
  fast?: boolean;
  /**
   * Streaming only: if a model has not produced its first word (text or a tool call) after this long, start the
   * next model alongside it and keep whichever answers first. Default 8 s (3 s for fast turns).
   */
  firstTokenMs?: number;
  /** The user picked one of their own custom models: use only that endpoint (see CustomRoute). */
  custom?: CustomRoute | null;
  /**
   * Who / what this call is for, recorded in ai_usage (never the prompt or the reply). Merged over the context set
   * with withAiUsage() by the caller's route; missing feature = "other".
   */
  usage?: AiUsageContext;
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
    // A task model (e.g. the coding model) may not be in the picker list: try it first on its provider.
    const p = ps.find((x) => x.name === prefer.provider);
    if (i < 0 && p && !only) list = [{ p, model: prefer.model }, ...list];
  }
  return list;
}

export class LLMError extends Error {
  /** True when every model refused the request while tools were attached (likely no tool-calling support). */
  public toolsRejected = false;
  constructor(msg: string, public status: number) { super(msg); }
}

type Candidate = { p: Provider; model: string };
type Win = { win: Response; ctrl: AbortController };
type Fail = { status: number; toolRefused: boolean; code: string };

/**
 * One ai_usage row per attempt, written at most once (the first finish wins). Holds only counters and labels:
 * the prompt and the reply never pass through here.
 */
type Rec = {
  start: number; ttft: number | null; raceWon: boolean | null; done: boolean;
  finish: (o: { success: boolean; code?: string | null; tokens?: { input: number | null; output: number | null } | null; raceWon?: boolean | null }) => void;
};
type RecBase = { provider: string; model: string; requestId: string; attempt: number; streamed: boolean; ctx: AiUsageContext };

function recorder(b: RecBase): Rec {
  const rec: Rec = {
    start: Date.now(), ttft: null, raceWon: null, done: false,
    finish(o) {
      if (rec.done) return;
      rec.done = true;
      try {
        logAiUsage({
          user_id: b.ctx.userId ?? null, request_id: b.requestId, provider: b.provider, model: b.model, feature: b.ctx.feature ?? "other",
          attempt: b.attempt, streamed: b.streamed, input_tokens: o.tokens?.input ?? null, output_tokens: o.tokens?.output ?? null,
          latency_ms: Date.now() - rec.start, ttft_ms: rec.ttft, success: o.success, error_code: o.code ?? null,
          race_won: o.raceWon !== undefined ? o.raceWon : rec.raceWon,
        });
      } catch { /* logging never breaks a call */ }
    },
  };
  return rec;
}

function usageCtx(opts: LLMOpts): AiUsageContext {
  const out: AiUsageContext = { ...aiUsageContext() };
  if (opts.usage?.userId !== undefined) out.userId = opts.usage.userId;
  if (opts.usage?.feature !== undefined) out.feature = opts.usage.feature;
  return out;
}

const newRequestId = () => { try { return globalThis.crypto.randomUUID(); } catch { return ""; } };

/** Non-streaming winner: read token counts from a clone of the JSON body in the background, then log. */
function finishFromJson(win: Response, rec: Rec) {
  let copy: Response;
  try { copy = win.clone(); } catch { rec.finish({ success: true }); return; }
  copy.json().then((j: { usage?: unknown }) => rec.finish({ success: true, tokens: readUsage(j?.usage) }), () => rec.finish({ success: true }));
}

/** True once an SSE buffer holds a visible word or a tool call (thinking deltas don't count). */
export function sseHasAnswer(buffer: string): "answer" | "empty" | null {
  for (const raw of buffer.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return "empty";
    try {
      const c = JSON.parse(data).choices?.[0];
      const d = c?.delta ?? c?.message ?? {};
      if ((typeof d.content === "string" && d.content) || (Array.isArray(d.tool_calls) && d.tool_calls.length)) return "answer";
    } catch { /* partial line */ }
  }
  return null;
}

const sleep = (ms: number) => { let t: ReturnType<typeof setTimeout> | undefined; const p = new Promise<null>((r) => { t = setTimeout(() => r(null), Math.max(0, ms)); }); return { p, cancel: () => clearTimeout(t) }; };

/** Body for a streaming Response that replays what was already read, then the rest; errors if it goes quiet. */
function replay(prefix: Uint8Array[], reader: ReadableStreamDefaultReader<Uint8Array>, ctrl: AbortController, idleMs: number, rec?: Rec): ReadableStream<Uint8Array> {
  // Token counts arrive in the stream's last chunk(s) as a `usage` object; only lines mentioning it are parsed.
  const dec = new TextDecoder();
  let tail = "";
  let tokens: { input: number | null; output: number | null } | null = null;
  const scan = (b: Uint8Array) => {
    if (!rec) return;
    try {
      tail += dec.decode(b, { stream: true });
      const cut = tail.lastIndexOf("\n");
      if (cut < 0) { if (tail.length > 65536) tail = ""; return; }
      const u = usageFromSse(tail.slice(0, cut));
      if (u) tokens = u;
      tail = tail.slice(cut + 1);
    } catch { /* counting is best effort */ }
  };
  const end = (success: boolean, code: string | null) => {
    if (!rec) return;
    if (tail) { const u = usageFromSse(tail); if (u) tokens = u; tail = ""; }
    rec.finish({ success, code, tokens });
  };
  for (const b of prefix) scan(b);
  return new ReadableStream<Uint8Array>({
    start(c) { for (const b of prefix) c.enqueue(b); },
    async pull(c) {
      const idle = sleep(idleMs);
      try {
        const r = await Promise.race([reader.read(), idle.p]);
        if (r === null) { ctrl.abort(); end(false, "stream_idle"); c.error(new Error("AI stream went quiet")); return; }
        if (r.done) { c.close(); end(true, null); } else { scan(r.value); c.enqueue(r.value); }
      } catch (e) { end(false, "stream_error"); c.error(e); } finally { idle.cancel(); }
    },
    // The reader stopped early (user pressed stop, or the caller had what it needed): the model did answer.
    cancel() { end(true, "client_closed"); reader.cancel().catch(() => undefined); ctrl.abort(); },
  });
}

async function attempt(c: Candidate, opts: LLMOpts, ctrl: AbortController, rec?: Rec): Promise<Win | Fail> {
  const withTools = !!opts.tools?.length;
  const fast = !!opts.fast && !!c.p.fastModels?.includes(c.model);
  try {
    const doFetch = c.p.fetch ?? ((u: string, i: RequestInit) => fetch(u, i));
    const r = await doFetch(c.p.url, {
      method: "POST", signal: ctrl.signal,
      headers: { Authorization: `Bearer ${c.p.key}`, "Content-Type": "application/json", ...(c.p.headers ?? {}) },
      body: JSON.stringify({
        model: c.model, messages: opts.messages, stream: !!opts.stream,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        max_tokens: fast ? (opts.maxTokens ?? 2048) : Math.max(opts.maxTokens ?? 2048, c.p.minTokens ?? 0),
        ...((fast ? c.p.fastExtra : undefined) ?? c.p.extra ?? {}),
        ...(withTools ? { tools: opts.tools, tool_choice: "auto" } : {}),
      }),
    });
    if (!r.ok || !r.body) {
      await r.text().catch(() => "");
      // 400/404/422 with tools attached usually means "this model/route can't do tool calling".
      return { status: r.ok ? 502 : r.status, toolRefused: withTools && (r.status === 400 || r.status === 404 || r.status === 422), code: r.ok ? "no_body" : `http_${r.status}` };
    }
    if (!opts.stream) return { win: r, ctrl };
    // Read until the first visible word / tool call, so a model that is still "thinking" can be raced.
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    const prefix: Uint8Array[] = [];
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        // A body with no SSE at all (e.g. a plain-text proxy) is passed through; an SSE stream with no words is empty.
        if (prefix.length && !/^\s*data:/m.test(buf)) { if (rec) rec.ttft = Date.now() - rec.start; break; }
        return { status: 502, toolRefused: false, code: "empty" };
      }
      prefix.push(value);
      buf += dec.decode(value, { stream: true });
      const seen = sseHasAnswer(buf);
      if (seen === "answer") { if (rec) rec.ttft = Date.now() - rec.start; break; }
      if (seen === "empty") return { status: 502, toolRefused: false, code: "empty" };
      // Keep only the unfinished last line plus a little context.
      if (buf.length > 20000) buf = buf.slice(buf.lastIndexOf("\n", buf.length - 1) - 10000);
    }
    return { win: new Response(replay(prefix, reader, ctrl, opts.timeoutMs ?? 60000, rec), { status: r.status, headers: r.headers }), ctrl };
  } catch {
    return { status: 504, toolRefused: false, code: ctrl.signal.aborted ? "timeout" : "network" };
  }
}

/** Candidates for a quick turn: each provider's fast models (that's NVIDIA thinking-off, then OpenRouter). */
function fastCandidates(ps: Provider[], prefer?: ModelRef | null): Candidate[] {
  const fast = ps.flatMap((p) => (p.fastModels ?? []).map((model) => ({ p, model })));
  if (!prefer) return fast;
  // The user's own model pick still goes first; the fast models are raced in if it is slow to start.
  const first = orderCandidates(ps, prefer)[0];
  return [first, ...fast.filter((c) => !(c.p.name === first.p.name && c.model === first.model))];
}

const MAX_PARALLEL = 3;

/**
 * Ask the providers for a reply. Errors (404, 429, 5xx) fall through to the next model at once. When streaming,
 * a model that hasn't started answering within `firstTokenMs` gets the next model raced alongside it (up to 3 at a
 * time); the first to produce a word wins and the others are cancelled. Returns the raw Response (SSE when stream).
 */
export async function llm(opts: LLMOpts): Promise<Response> {
  if (opts.custom) return llmCustom(opts, opts.custom);
  const ps = providers();
  if (!ps.length) throw new LLMError("AI is not configured", 503);
  const withTools = !!opts.tools?.length;
  const queue = opts.fast && !opts.only ? fastCandidates(ps, opts.prefer) : orderCandidates(ps, opts.prefer, opts.only);
  if (!queue.length) throw new LLMError("No AI model is available for this request", 503);
  const totalMs = opts.timeoutMs ?? 45000;
  // Streams: `timeoutMs` bounds the wait for the first word across all models. Plain calls: per model, as before.
  // With firstTokenMs set (models raced), `timeoutMs` bounds the whole call too.
  const deadline = Date.now() + (opts.stream || opts.firstTokenMs ? totalMs : totalMs * queue.length);
  const hedgeMs = opts.firstTokenMs ?? (opts.stream ? (opts.fast ? 3000 : 8000) : Infinity);
  let last = 502, rateLimited = false, toolRefusals = 0, attempts = 0, n = 0;
  const skip = new Set<string>(); // OpenRouter routes across its own list itself; one attempt is enough after a 429.
  const running = new Map<number, { ctrl: AbortController; done: Promise<{ i: number; r: Win | Fail; c: Candidate }>; timer: ReturnType<typeof setTimeout>; rec: Rec }>();
  const ctx = usageCtx(opts);
  const requestId = newRequestId();
  const startNext = (): boolean => {
    while (queue.length) {
      const c = queue.shift()!;
      if (skip.has(c.p.name)) continue;
      const i = n++;
      const ctrl = new AbortController();
      const rec = recorder({ provider: c.p.name, model: c.model, requestId, attempt: i, streamed: !!opts.stream, ctx });
      // Non-streaming calls (and the wait for headers) are capped per attempt; streams are capped by the deadline.
      const perAttempt = opts.stream ? Math.max(0, deadline - Date.now()) : Math.min(totalMs, Math.max(0, deadline - Date.now()));
      const timer = setTimeout(() => ctrl.abort(), perAttempt);
      running.set(i, { ctrl, timer, rec, done: attempt(c, opts, ctrl, rec).then((r) => ({ i, r, c })) });
      return true;
    }
    return false;
  };
  // Models still running when the call ends: "cancelled" (another model won the race) or "timeout" (deadline).
  const stopAll = (code: "cancelled" | "timeout") => {
    for (const r of running.values()) { r.rec.finish({ success: false, code, raceWon: code === "cancelled" ? false : null }); clearTimeout(r.timer); r.ctrl.abort(); }
    running.clear();
  };
  startNext();
  while (running.size) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) { last = 504; break; }
    const canHedge = running.size < MAX_PARALLEL && queue.length > 0;
    const wait = sleep(canHedge ? Math.min(hedgeMs, remaining) : remaining);
    const got = await Promise.race([...Array.from(running.values()).map((r) => r.done), wait.p]);
    wait.cancel();
    if (!got) { if (canHedge) startNext(); continue; }
    const slot = running.get(got.i)!;
    clearTimeout(slot.timer);
    running.delete(got.i);
    attempts++;
    if ("win" in got.r) {
      // Won the race when at least one other model was tried (in parallel or before it).
      slot.rec.raceWon = n > 1 ? true : null;
      stopAll("cancelled");
      if (!opts.stream) finishFromJson(got.r.win, slot.rec);
      return got.r.win;
    }
    slot.rec.finish({ success: false, code: got.r.code });
    last = got.r.status;
    if (last === 429) { rateLimited = true; if (got.c.p.name === "openrouter") skip.add("openrouter"); }
    if (got.r.toolRefused) toolRefusals++;
    if (!running.size) startNext();
  }
  stopAll("timeout");
  const e = new LLMError(rateLimited && last === 429 ? "TARGET's free AI quota is used up for now. Try again later." : `AI error ${last}`, rateLimited && last === 429 ? 429 : 502);
  e.toolsRejected = withTools && toolRefusals > 0 && !rateLimited && toolRefusals >= Math.ceil(attempts / 2);
  throw e;
}

/** Chat completions URL for a normalised base URL ("https://host/v1" → "https://host/v1/chat/completions"). */
export const chatUrl = (base: string) => `${base.replace(/\/+$/, "")}/chat/completions`;

/** One attempt against the user's own provider. Same Response contract as llm(); errors say it was their provider. */
async function llmCustom(opts: LLMOpts, c: CustomRoute): Promise<Response> {
  const p: Provider = { name: "custom", url: c.url, key: c.key, models: [c.model], fetch: c.fetch };
  const ctrl = new AbortController();
  // Logged as provider "custom" + the model id only: never the provider's name, URL or key.
  const rec = recorder({ provider: "custom", model: c.model, requestId: newRequestId(), attempt: 0, streamed: !!opts.stream, ctx: usageCtx(opts) });
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45000);
  const r = await attempt({ p, model: c.model }, opts, ctrl, rec).finally(() => clearTimeout(timer));
  if ("win" in r) { if (!opts.stream) finishFromJson(r.win, rec); return r.win; }
  rec.finish({ success: false, code: r.code });
  const s = r.status;
  const msg = s === 401 || s === 403 ? `${c.name} rejected the API key (error ${s}). Check it in Settings → AI providers.`
    : s === 429 ? `${c.name} is rate-limiting requests right now (429). Try again in a bit.`
    : s === 404 ? `${c.name} doesn't know the model "${c.model}" (404). Check the model id in Settings → AI providers.`
    : s === 504 ? `${c.name} didn't answer in time (or its address isn't reachable).`
    : `${c.name} returned error ${s}.`;
  const e = new LLMError(msg, s === 429 ? 429 : 502);
  e.toolsRejected = !!opts.tools?.length && r.toolRefused;
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
