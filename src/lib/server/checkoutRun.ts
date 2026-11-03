import type { Db } from "@/lib/server/auth";
import { decryptWithAny, decryptionKeys, encryptSecret, primaryKey } from "@/lib/connectors/crypto";
import { checkoutPost, payGoal, type CheckoutInputs } from "@/lib/checkout";
import { kickCloudWorker } from "@/lib/server/kickWorker";

/**
 * Server side of a store checkout (see lib/checkout.ts). The browser state captured at the pay step (cookies +
 * localStorage = the cart) is sealed with the server key, bound to the user, and only handed back to the approved pay job.
 */
type BrowserState = { cookies: Record<string, unknown>[]; origins: { origin: string; localStorage: { name: string; value: string }[] }[] };
const MAX_STATE = 500000;

export function cleanState(raw: unknown): BrowserState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { cookies?: unknown; origins?: unknown };
  const cookies = Array.isArray(r.cookies) ? (r.cookies as unknown[]).filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && typeof (c as { name?: unknown }).name === "string" && typeof (c as { value?: unknown }).value === "string" && typeof (c as { domain?: unknown }).domain === "string").slice(0, 300) : [];
  const origins = Array.isArray(r.origins) ? (r.origins as unknown[]).flatMap((o) => {
    const x = o as { origin?: unknown; localStorage?: unknown };
    if (!x || typeof x.origin !== "string" || !/^https?:\/\//.test(x.origin)) return [];
    const ls = Array.isArray(x.localStorage) ? (x.localStorage as unknown[]).filter((i): i is { name: string; value: string } => !!i && typeof (i as { name?: unknown }).name === "string" && typeof (i as { value?: unknown }).value === "string").slice(0, 200) : [];
    return [{ origin: x.origin.slice(0, 300), localStorage: ls }];
  }).slice(0, 20) : [];
  if (!cookies.length && !origins.length) return null;
  const st = { cookies, origins };
  return JSON.stringify(st).length <= MAX_STATE ? st : null;
}

export function sealState(userId: string, jobId: string, st: BrowserState): string {
  return encryptSecret(JSON.stringify({ v: 1, u: userId, j: jobId, s: st }), primaryKey());
}

/** Open the sealed state for this user; jobIds = the prepare job that captured it (the pay job carries its id). */
export function openState(box: string, userId: string, jobIds: string[]): BrowserState | null {
  try {
    const j = JSON.parse(decryptWithAny(box, decryptionKeys())) as { v?: number; u?: string; j?: string; s?: BrowserState };
    if (j.v !== 1 || j.u !== userId || !j.j || !jobIds.includes(j.j) || !j.s) return null;
    return j.s;
  } catch { return null; }
}

function httpUrl(u: unknown): string | null {
  if (typeof u !== "string" || u.length > 2000) return null;
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; }
}

/** The prepare job reached the pay page: keep its browser state (sealed) and that page's URL. */
export async function checkoutReady(db: Db, job: { id: string; user_id: string; inputs: Record<string, unknown> }, c: CheckoutInputs, state: unknown, url: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (c.phase !== "prepare" || !c.pending) return { ok: false, error: "This job isn't at the pay step" };
  const st = cleanState(state);
  const pay_url = httpUrl(url);
  if (!st || !pay_url) return { ok: false, error: "Bad browser state" };
  const inputs = job.inputs;
  await db.from("browser_jobs").update({ inputs: { ...inputs, checkout: { ...(inputs.checkout as Record<string, unknown>), state_box: sealState(job.user_id, job.id, st), pay_url } } }).eq("id", job.id);
  return { ok: true };
}

/** For an approved pay job: the cart's browser state captured by its prepare job. */
export function checkoutState(userId: string, jobId: string, c: CheckoutInputs): BrowserState | null {
  if (c.phase !== "pay" || !c.state_box || !c.prepare_job_id) return null;
  void jobId;
  return openState(c.state_box, userId, [c.prepare_job_id]);
}

async function post(db: Db, userId: string, conversationId: string | null, content: string) {
  if (!conversationId) return;
  await db.from("messages").insert({ conversation_id: conversationId, user_id: userId, role: "assistant", content });
  await db.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
}

/**
 * A checkout job ended. Prepare + reached the pay page -> a pay job waiting for approval and the approval card in chat
 * (items, total and payment exactly as the page showed them). Pay -> the outcome. Nothing else creates a pay job.
 */
export async function finishCheckout(
  db: Db, job: { id: string; user_id: string; conversation_id: string | null; inputs: Record<string, unknown>; goal: string },
  c: CheckoutInputs, okIn: boolean, result: string | null, error: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  // Re-read: pending / state_box were written during this run.
  const { data: fresh } = await db.from("browser_jobs").select("inputs").eq("id", job.id).maybeSingle();
  const { checkoutOf } = await import("@/lib/checkout");
  const cur = checkoutOf((fresh as { inputs?: unknown } | null)?.inputs) ?? c;
  let ok = okIn;
  let detail = error ?? "";

  if (cur.phase === "prepare") {
    if (ok && (!cur.pending || !cur.state_box || !cur.pay_url)) { ok = false; detail = "Stopped before reaching the pay page."; }
    await db.from("browser_jobs").update({ status: ok ? "done" : "failed", result: result ? result.slice(0, 20000) : null, error: ok ? null : detail.slice(0, 500), finished_at: now }).eq("id", job.id).eq("status", "running");
    if (!ok) { await post(db, job.user_id, job.conversation_id, checkoutPost(cur, false, detail.slice(0, 400))); return; }
    const approved = cur.pending!;
    const payInputs: CheckoutInputs = { ...cur, phase: "pay", approved, pending: null, prepare_job_id: job.id };
    payInputs.goal = payGoal(payInputs);
    const secrets = [cur.payment_secret_id, cur.login_secret_id].filter((x): x is string => !!x);
    const { data: payJob } = await db.from("browser_jobs").insert({
      user_id: job.user_id, mode: "auto", goal: `Pay ${approved.total} at ${cur.merchant}`.slice(0, 500), start_url: cur.pay_url!,
      steps: [], allowed_secrets: secrets, max_steps: 20, status: "needs_approval", conversation_id: job.conversation_id,
      inputs: { checkout: payInputs },
    }).select("id").single();
    if (!payJob) { await post(db, job.user_id, job.conversation_id, checkoutPost(cur, false, "Couldn't prepare the payment step.")); return; }
    const summary = `Pay ${approved.total} at ${cur.merchant}`.slice(0, 300);
    const { data: ap } = await db.from("approval_requests").insert({
      user_id: job.user_id, action_type: "purchase", summary, destination: cur.merchant, status: "pending", conversation_id: job.conversation_id,
      payload: { browser_job_id: payJob.id, items: approved.items, total: approved.total, payment: approved.payment || "As selected on the store's page", deliver_to: cur.deliver_to ?? "" },
    }).select("id").single();
    if (!ap) { await post(db, job.user_id, job.conversation_id, checkoutPost(cur, false, "Couldn't prepare the approval card.")); return; }
    const block = `\`\`\`actions\n${JSON.stringify([{ type: "approval", id: ap.id }])}\n\`\`\``;
    await post(db, job.user_id, job.conversation_id, `${checkoutPost(cur, true, "")}\n\n${block}`);
    return;
  }

  await db.from("browser_jobs").update({ status: ok ? "done" : "failed", result: result ? result.slice(0, 20000) : null, error: ok ? null : detail.slice(0, 500), finished_at: now, inputs: { ...job.inputs, checkout: { ...(job.inputs.checkout as Record<string, unknown>), state_box: null } } }).eq("id", job.id).eq("status", "running");
  const body = ok ? (result ?? "").replace(/\n\nFinal page:[\s\S]*$/, "").slice(0, 3000) : "";
  await post(db, job.user_id, job.conversation_id, [checkoutPost(cur, ok, ok ? "" : detail.slice(0, 400)), body].filter(Boolean).join("\n\n"));
}

/** The checkout tool: queue the prepare job (adding to a cart and walking to the pay page pays nothing). */
export async function queueCheckout(db: Db, userId: string, conversationId: string | null, c: CheckoutInputs, startUrl: string): Promise<string> {
  const inputs: CheckoutInputs = { ...c, phase: "prepare" };
  const { prepareGoal } = await import("@/lib/checkout");
  inputs.goal = prepareGoal(inputs);
  const secrets = [c.login_secret_id].filter((x): x is string => !!x);
  const { data, error } = await db.from("browser_jobs").insert({
    user_id: userId, mode: "auto", goal: `Get ${c.merchant} checkout ready (stop before paying)`.slice(0, 500), start_url: startUrl, steps: [],
    allowed_secrets: secrets, max_steps: 40, status: "queued", conversation_id: conversationId, inputs: { checkout: inputs },
  }).select("id").single();
  if (error || !data) throw new Error("Couldn't start the checkout");
  await kickCloudWorker();
  return data.id as string;
}
