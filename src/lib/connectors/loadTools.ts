import { z } from "zod";
import type { Db } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { CONNECTORS, getConnector, isConfigured } from "@/lib/connectors/registry";
import { getCredentials, NotConnectedError, PUBLIC_COLS, touchLastUsed } from "@/lib/connectors/store";
import { checkLimit, LIMITS } from "@/lib/connectors/rateLimit";
import { redact, safeJson, untrusted } from "@/lib/connectors/safety";
import { ConnectorError } from "@/lib/connectors/http";
import { logActivity } from "@/lib/server/activity";
import type { ConnectionInfo, ConnectorDef, Env, ToolDef } from "@/lib/connectors/types";
import { BUILTIN_ID, BUILTIN_TOOLS, getBuiltin } from "@/lib/builtins/tools";

/** Separator between connector id and tool name in the names the model sees. */
export const SEP = "__";
export const META_TOOL = "request_connector";

export type LoadedTool = { name: string; connector: ConnectorDef; def: ToolDef; connection: ConnectionInfo };

type Lister = { from: Db["from"] };

/** The user's connection rows (non-secret columns only). */
async function connectionsFor(userId: string, client?: Lister): Promise<ConnectionInfo[]> {
  const db = client ?? (createAdminClient() as unknown as Lister);
  const { data } = await db.from("connections").select(PUBLIC_COLS).eq("user_id", userId);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    connector_id: String(r.connector_id), status: (r.status as ConnectionInfo["status"]) ?? "connected",
    scopes: (r.scopes as string[]) ?? [], account_label: String(r.account_label ?? ""), last_used_at: (r.last_used_at as string | null) ?? null,
  }));
}

/**
 * Tools the agent may use for this user: ONLY connectors whose connection status is "connected"
 * (and that are configured on this server). Expired/revoked/missing connectors contribute nothing.
 */
export async function loadToolsForUser(userId: string, client?: Lister, env: Env = process.env): Promise<{ tools: LoadedTool[]; connected: Set<string>; connections: ConnectionInfo[] }> {
  const connections = await connectionsFor(userId, client);
  const tools: LoadedTool[] = [];
  const connected = new Set<string>();
  for (const conn of connections) {
    if (conn.status !== "connected") continue;
    const c = getConnector(conn.connector_id);
    if (!c || !isConfigured(c, env)) continue;
    connected.add(c.id);
    for (const def of c.getTools(conn)) tools.push({ name: `${c.id}${SEP}${def.name}`, connector: c, def, connection: conn });
  }
  return { tools, connected, connections };
}

function jsonSchema(s: z.ZodTypeAny): Record<string, unknown> {
  const js = z.toJSONSchema(s, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

/** OpenAI-compatible `tools` array: the connected tools plus request_connector for everything else. */
export function toOpenAITools(tools: LoadedTool[], connected: Set<string>) {
  const others = CONNECTORS.filter((c) => !connected.has(c.id)).map((c) => c.id);
  const specs = tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: `[${t.connector.name}] ${t.def.description}${t.def.requiresApproval ? " (may require user approval)" : ""}`.slice(0, 1000), parameters: jsonSchema(t.def.input) },
  }));
  // TARGET's own tools (images, charts, files, Pages, video, parallel research, browser jobs): always available.
  for (const b of BUILTIN_TOOLS) specs.push({ type: "function" as const, function: { name: `${BUILTIN_ID}${SEP}${b.name}`, description: `[TARGET] ${b.description}`.slice(0, 1000), parameters: jsonSchema(b.input) } });
  if (others.length) specs.push({
    type: "function" as const,
    function: {
      name: META_TOOL,
      description: `Call this when the task needs one of the user's accounts that is not connected yet (${others.join(", ")}). The user will be asked to connect it and the task pauses until they do.`,
      parameters: { type: "object", properties: { connector: { type: "string", enum: others }, reason: { type: "string", description: "Short reason shown to the user" } }, required: ["connector"], additionalProperties: false },
    },
  });
  return specs;
}

export function toolsPrompt(tools: LoadedTool[], connected: Set<string>): string {
  const names = CONNECTORS.filter((c) => connected.has(c.id)).map((c) => c.name);
  return `\n\nCONNECTORS: ${names.length ? `The user has connected: ${names.join(", ")}. Use their tools when the request needs them.` : "The user hasn't connected any accounts."} ` +
    `If a request needs an account that isn't connected, call ${META_TOOL} instead of guessing or pretending. ` +
    "Some tools need the user's approval; when a tool returns approval_required, tell the user it is waiting for their approval and stop. " +
    "Never claim an action happened unless a tool result says so.";
}

export type ToolCtx = { db: Db; userId: string; projectId: string | null; conversationId: string | null; taskId: string | null; f?: typeof fetch; autoApproveBrowser?: boolean; /** The user's own recent messages (latest last), for tools that only run on an explicit ask. */ userTexts?: string[] };

export type ToolOutcome =
  | { kind: "result"; content: string; connector: string; tool: string }
  | { kind: "error"; content: string; connector?: string; tool?: string }
  | { kind: "needs_connection"; content: string; connector: string; status: string; reason?: string }
  | { kind: "approval"; content: string; approvalId: string; summary: string; connector: string; tool: string };

const err = (o: Record<string, unknown>) => JSON.stringify(o);
export const notConnected = (connector: string, status = "missing") => ({ error: "connector_not_connected", connector, ...(status !== "missing" ? { status } : {}) });

function parseArgs(raw: string | Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (raw && typeof raw === "object") return raw;
  if (!raw) return {};
  try { const j = JSON.parse(raw); return j && typeof j === "object" && !Array.isArray(j) ? j : null; } catch { return null; }
}

/**
 * Handle one tool call requested by the model. This path can NEVER run a requiresApproval tool:
 * those become pending approval requests that only the owner can approve (runApprovedTool).
 */
export async function executeToolCall(ctx: ToolCtx, name: string, rawArgs: string | Record<string, unknown> | undefined, loaded?: { tools: LoadedTool[]; connected: Set<string> }): Promise<ToolOutcome> {
  const args = parseArgs(rawArgs);
  if (name === META_TOOL) {
    const id = typeof args?.connector === "string" ? args.connector : "";
    const c = getConnector(id);
    if (!c) return { kind: "error", content: err({ error: "unknown_connector", connector: id }) };
    const state = loaded ?? await loadToolsForUser(ctx.userId, ctx.db);
    if (state.connected.has(c.id)) return { kind: "error", content: err({ error: "already_connected", connector: c.id, hint: `Use the ${c.id}${SEP}* tools.` }) };
    const reason = typeof args?.reason === "string" ? args.reason.slice(0, 200) : undefined;
    return { kind: "needs_connection", connector: c.id, status: "missing", reason, content: err(notConnected(c.id)) };
  }

  const [cid, tname] = name.split(SEP);
  if (cid === BUILTIN_ID) return runBuiltin(ctx, tname ?? "", args);
  const c = cid ? getConnector(cid) : undefined;
  if (!c || !tname) return { kind: "error", content: err({ error: "unknown_tool", tool: name.slice(0, 80) }) };

  if (!(await checkLimit(LIMITS.toolCall(ctx.userId)))) return { kind: "error", connector: c.id, tool: tname, content: err({ error: "rate_limited", message: "Too many tool calls; try again in a minute." }) };

  // Fresh status check on every call: the user may have disconnected mid-conversation.
  const state = loaded ?? await loadToolsForUser(ctx.userId, ctx.db);
  const t = state.tools.find((x) => x.name === name);
  if (!state.connected.has(c.id) || !t) {
    if (!state.connected.has(c.id)) return { kind: "needs_connection", connector: c.id, status: "missing", content: err(notConnected(c.id)) };
    return { kind: "error", connector: c.id, content: err({ error: "unknown_tool", tool: name.slice(0, 80) }) };
  }
  if (args === null) return { kind: "error", connector: c.id, tool: tname, content: err({ error: "invalid_arguments", message: "Arguments must be a JSON object" }) };
  const parsed = t.def.input.safeParse(args);
  if (!parsed.success) return { kind: "error", connector: c.id, tool: tname, content: err({ error: "invalid_arguments", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }) };

  const needsApproval = typeof t.def.requiresApproval === "function" ? !!t.def.requiresApproval(parsed.data) : !!t.def.requiresApproval;
  if (needsApproval) {
    const p = await proposeToolCall(ctx, c, t.def, args, t.connection.account_label);
    if (!p.ok) return { kind: "error", connector: c.id, tool: tname, content: err({ error: "approval_failed", message: p.reason }) };
    return { kind: "approval", connector: c.id, tool: tname, approvalId: p.id, summary: p.summary, content: err({ status: "approval_required", approval_id: p.id, message: "Waiting for the user to approve this action. Do not retry it." }) };
  }

  return runTool(ctx.userId, c, t.def, parsed.data, ctx.f);
}

/** TARGET's built-in tools: no account needed, rate limited, writes go through the server with the owner's id. */
async function runBuiltin(ctx: ToolCtx, tname: string, args: Record<string, unknown> | null): Promise<ToolOutcome> {
  const b = getBuiltin(tname);
  if (!b) return { kind: "error", content: err({ error: "unknown_tool", tool: tname.slice(0, 80) }) };
  if (!(await checkLimit(LIMITS.toolCall(ctx.userId)))) return { kind: "error", connector: BUILTIN_ID, tool: tname, content: err({ error: "rate_limited", message: "Too many tool calls; try again in a minute." }) };
  if (args === null) return { kind: "error", connector: BUILTIN_ID, tool: tname, content: err({ error: "invalid_arguments", message: "Arguments must be a JSON object" }) };
  const parsed = b.input.safeParse(args);
  if (!parsed.success) return { kind: "error", connector: BUILTIN_ID, tool: tname, content: err({ error: "invalid_arguments", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }) };
  let db = ctx.db;
  try { db = createAdminClient() as unknown as Db; } catch { /* fall back to the user's own client */ }
  try {
    const out = await b.execute(parsed.data, { db, userId: ctx.userId, conversationId: ctx.conversationId, fetch: ctx.f, autoApproveBrowser: ctx.autoApproveBrowser, userTexts: ctx.userTexts });
    // A built-in that prepared something for approval (an order card): pause exactly like a connector approval.
    const ap = (out as { __approval?: { id: string; summary: string } } | null)?.__approval;
    if (ap) return { kind: "approval", connector: BUILTIN_ID, tool: tname, approvalId: ap.id, summary: ap.summary, content: err({ status: "approval_required", approval_id: ap.id, message: "The approval card is waiting for the user to tap Approve. Nothing has been done yet (nothing bought, nothing changed). Do not retry." }) };
    return { kind: "result", connector: BUILTIN_ID, tool: tname, content: untrusted(BUILTIN_ID, tname, safeJson(out, [], 32000)) };
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 200) : "The tool failed";
    return { kind: "error", connector: BUILTIN_ID, tool: tname, content: err({ error: "tool_failed", message }) };
  }
}

async function runTool(userId: string, c: ConnectorDef, def: ToolDef, args: unknown, f: typeof fetch = fetch): Promise<ToolOutcome> {
  let token = "";
  try {
    const { creds, info } = await getCredentials(userId, c, f);
    token = creds.access_token;
    let out: unknown;
    try {
      out = await def.execute(args as never, { token, fetch: f, meta: info.meta ?? {} });
    } catch (e) {
      // The provider rejected a token we thought was valid (revoked early, clock skew): refresh once and retry.
      if (!(e instanceof ConnectorError && e.status === 401 && creds.refresh_token)) throw e;
      const fresh = await getCredentials(userId, c, f, { forceRefresh: true });
      token = fresh.creds.access_token;
      out = await def.execute(args as never, { token, fetch: f, meta: fresh.info.meta ?? {} });
    }
    await touchLastUsed(userId, c.id);
    return { kind: "result", connector: c.id, tool: def.name, content: untrusted(c.id, def.name, safeJson(out, [token])) };
  } catch (e) {
    if (e instanceof NotConnectedError) return { kind: "needs_connection", connector: c.id, status: e.status, content: err(notConnected(c.id, e.status)) };
    await touchLastUsed(userId, c.id);
    const message = e instanceof ConnectorError ? e.message : e instanceof z.ZodError ? "Invalid arguments" : "The tool failed";
    if (!(e instanceof ConnectorError)) console.error(`[connector] ${c.id}.${def.name} failed:`, redact(e instanceof Error ? e.message : String(e), [token]).slice(0, 300));
    return { kind: "error", connector: c.id, tool: def.name, content: err({ error: "tool_failed", message: redact(message, [token]) }) };
  }
}

/** Record a pending approval (and put the task into waiting_approval). Nothing runs here. */
async function proposeToolCall(ctx: ToolCtx, c: ConnectorDef, def: ToolDef, args: Record<string, unknown>, accountLabel: string): Promise<{ ok: true; id: string; summary: string } | { ok: false; reason: string }> {
  const parsed = def.input.safeParse(args);
  const summary = ((parsed.success && def.summarize ? def.summarize(parsed.data) : `${c.name}: ${def.name.replace(/_/g, " ")}`) || c.name).slice(0, 300);
  const destination = `${c.name}${accountLabel ? ` (${accountLabel})` : ""}`.slice(0, 300);
  let taskId = ctx.taskId;
  if (taskId) {
    await ctx.db.from("tasks").update({ status: "waiting_approval", progress: "Prepared by TARGET. Waiting for your approval.", updated_at: new Date().toISOString() }).eq("id", taskId).eq("user_id", ctx.userId);
  } else {
    const { data: t } = await ctx.db.from("tasks").insert({
      user_id: ctx.userId, title: summary.slice(0, 200), status: "waiting_approval", origin: "assistant",
      project_id: ctx.projectId, conversation_id: ctx.conversationId, progress: "Prepared by TARGET. Waiting for your approval.",
    }).select("id").single();
    taskId = (t?.id as string) ?? null;
  }
  const { data, error } = await ctx.db.from("approval_requests").insert({
    user_id: ctx.userId, action_type: "connector_tool", summary, destination,
    payload: { connector: c.id, tool: def.name, args }, status: "pending",
    project_id: ctx.projectId, conversation_id: ctx.conversationId, task_id: taskId,
  }).select("id").single();
  if (error || !data) return { ok: false, reason: "Couldn't prepare that action for approval." };
  await logActivity(ctx.db, ctx.userId, { category: "approval", title: `Approval requested: ${summary}`, detail: `Destination: ${destination}`, status: "pending", approval_id: data.id as string, task_id: taskId, project_id: ctx.projectId });
  return { ok: true, id: data.id as string, summary };
}

/**
 * Run a tool the owner has approved. Called ONLY by the approval execution gate
 * (src/lib/server/approvals.ts → executeApproval), which has already verified ownership,
 * approval status and single execution.
 */
export async function runApprovedTool(userId: string, payload: { connector?: unknown; tool?: unknown; args?: unknown }, f: typeof fetch = fetch): Promise<Record<string, unknown>> {
  const c = typeof payload.connector === "string" ? getConnector(payload.connector) : undefined;
  if (!c) throw new Error("Unknown connector");
  if (!(await checkLimit(LIMITS.toolCall(userId)))) throw new Error("Too many tool calls right now. Try again in a minute.");
  const state = await loadToolsForUser(userId);
  if (!state.connected.has(c.id)) throw new Error(`${c.name} isn't connected any more. Reconnect it, then approve again.`);
  const t = state.tools.find((x) => x.connector.id === c.id && x.def.name === payload.tool);
  if (!t) throw new Error("That tool isn't available for this connection.");
  const parsed = t.def.input.safeParse(payload.args ?? {});
  if (!parsed.success) throw new Error("The approved details are no longer valid.");
  const r = await runTool(userId, c, t.def, parsed.data, f);
  if (r.kind === "needs_connection") throw new Error(`${c.name} needs to be reconnected.`);
  if (r.kind !== "result") throw new Error(JSON.parse(r.content).message ?? "The action failed");
  // Strip the untrusted wrapper for storage; content is already redacted and size-capped.
  return { output: r.content.replace(/^<untrusted_data[^>]*>\n|\n<\/untrusted_data>$/g, "").slice(0, 4000) };
}
