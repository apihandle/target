import { badRequest, json, readJson, type Db } from "@/lib/server/auth";
import { featureOn } from "@/lib/server/adminSettings";
import { COMPUTE_MODES, UUID_RE, computeEnabled, workerAuth } from "@/lib/server/worker";
import { storeJobFiles } from "@/lib/server/jobFiles";
import { createAdminClient } from "@/lib/supabase/admin";
import { openVault } from "@/lib/builtins/vault";
import { checkLimit } from "@/lib/connectors/rateLimit";
import { sendPushToUser } from "@/lib/server/push";
import { decideNext, describeVideo, snapshotSchema } from "@/lib/server/autoBrowser";
import { decryptWithAny, decryptionKeys } from "@/lib/connectors/crypto";
import { loadSiteCookies, saveSiteSession } from "@/lib/server/siteSessions";
import { gmailSigninCode, gmailSiteLink } from "@/lib/server/signinMail";
import { WAITING_FOR_CODE } from "@/lib/builtins/signin";
import { isLang, type Lang } from "@/lib/lang";
import { signinFailure, signinPostHead } from "@/lib/signin";
import { NOT_SIGNED_IN, resultSaysFailed, verifyLogin, verifySignup } from "@/lib/loginCheck";
import { accountOf, accountPost } from "@/lib/siteAccount";
import { settleSiteAccount } from "@/lib/server/siteAccountRun";
import { checkoutOf, guardCheckout, PAY_PRESSED } from "@/lib/checkout";
import { checkoutReady, checkoutState, finishCheckout } from "@/lib/server/checkoutRun";
import { CHECK_LINE, nextControl, PAUSE_MS, safeLiveUrl, STOPPED, type Control } from "@/lib/liveView";

/** Website job modes (code / video jobs are compute, not browser tasks). */
const BROWSER_MODES = ["steps", "auto"];

export const dynamic = "force-dynamic";
export const maxDuration = 60;


/**
 * Trusted browser worker only (Bearer SESSION_WORKER_SECRET). Actions:
 *  claim  -> the oldest queued job (atomically moved to running) of a mode this worker supports
 *  next   -> smart mode: given the page snapshot, the AI's next action
 *  secret -> one vault field for a fill_secret step of a RUNNING job that lists that secret
 *  progress -> add one human-readable line to the job's live log
 *  cookies -> sign-in jobs: the saved session for the job's site (so an existing login is reused)
 *  code   -> sign-in jobs: a one-time code, from the user's Gmail or the code form in chat
 *  save_session -> sign-in jobs: store the signed-in cookies (encrypted) in site_sessions
 *  checkout_ready -> checkout prepare jobs at the pay step: the browser state (sealed) and the pay page URL
 *  checkout_state -> checkout pay jobs (approved): that sealed state, so a new browser has the same cart
 *  live   -> the provider's interactive live-view URL for the chat panel (allow-listed hosts only)
 *  frame  -> the latest screenshot + page URL for the chat panel; answers who is in control
 *  control -> who is in control (agent / paused / user / stop)
 *  pause  -> the agent waits for the user (Cloudflare check, captcha); resume -> the agent carries on
 *  handoff -> a paused job's time ran out in this run: back to queued with the open session, for the next run
 *  finish -> store the result (done/failed) and notify the owner
 */
export async function POST(req: Request) {
  const auth = workerAuth(req);
  if (auth === "unconfigured") return json({ error: "Browser worker is not configured" }, 503);
  if (auth !== "ok") return json({ error: "Unauthorized" }, 401);
  const b = await readJson(req);
  if (!b) return badRequest("Bad JSON");
  let db: Db;
  try { db = createAdminClient() as unknown as Db; } catch { return json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" }, 503); }

  if (b.action === "claim") {
    // Jobs stuck in running for 10+ minutes are failed so they never block the queue.
    await db.from("browser_jobs").update({ status: "failed", error: "The browser worker stopped responding", finished_at: new Date().toISOString() })
      .eq("status", "running").lt("claimed_at", new Date(Date.now() - 600000).toISOString());
    // With the separate compute worker on, code / video jobs are only handed to it (it holds no vault access).
    const compute = computeEnabled();
    const browserOn = await featureOn("browser");
    const modes = (Array.isArray(b.modes) ? (b.modes as unknown[]).filter((m): m is string => typeof m === "string") : ["steps"])
      .filter((m) => !compute || !(COMPUTE_MODES as readonly string[]).includes(m))
      // Admin kill-switch: with browser tasks off, no website job (steps/auto) is handed to any worker.
      .filter((m) => browserOn || !BROWSER_MODES.includes(m));
    if (!modes.length) return json({ job: null });
    const { data: next } = await db.from("browser_jobs").select("id").eq("status", "queued").in("mode", modes).order("created_at", { ascending: true }).limit(1);
    if (!next?.length) return json({ job: null });
    const { data } = await db.from("browser_jobs").update({ status: "running", claimed_at: new Date().toISOString() })
      .eq("id", next[0].id).eq("status", "queued").select("id, user_id, goal, start_url, steps, mode, max_steps, language, code, inputs, allowed_secrets, resume");
    return json({ job: data?.[0] ?? null });
  }

  const id = typeof b.job_id === "string" && UUID_RE.test(b.job_id) ? b.job_id : null;
  if (!id) return badRequest("job_id required");
  const { data: job } = await db.from("browser_jobs").select("id, user_id, goal, status, steps, mode, allowed_secrets, max_steps, log, conversation_id, inputs, claimed_at, live, control, paused_until").eq("id", id).maybeSingle();
  if (!job || job.status !== "running") return json({ error: "Job is not running" }, 409);

  // ---- live view and control (the chat panel)
  const ctl = () => ({ control: (job.control as Control | null) ?? "agent", paused_until: job.paused_until ? new Date(job.paused_until as string).getTime() : 0 });
  if (b.action === "live") {
    const l = b.live as { provider?: unknown; url?: unknown; interactive?: unknown } | undefined;
    const url = safeLiveUrl(l?.url);
    if (!url) return badRequest("Live view URL not allowed");
    await db.from("browser_jobs").update({ live: { provider: String(l?.provider ?? "").slice(0, 30), url, interactive: l?.interactive === true } }).eq("id", id);
    return json({ ok: true });
  }
  if (b.action === "frame") {
    const shot = typeof b.shot === "string" && b.shot.length < 390000 && /^[A-Za-z0-9+/=]+$/.test(b.shot) ? b.shot : null;
    const url = typeof b.url === "string" ? b.url.slice(0, 2000) : null;
    await db.from("browser_jobs").update({ ...(shot ? { frame: shot } : {}), frame_url: url, frame_at: new Date().toISOString() }).eq("id", id);
    return json(ctl());
  }
  if (b.action === "control") return json(ctl());
  if (b.action === "pause" || b.action === "resume") {
    const interactive = !!(job.live as { interactive?: boolean } | null)?.interactive;
    const to = nextControl(job.control as Control | null, b.action === "pause" ? "pause" : "passed", { interactive });
    if (!to) return json(ctl());
    const reason = typeof b.reason === "string" ? b.reason.replace(/\s+/g, " ").trim().slice(0, 180) : CHECK_LINE;
    // One pause window per wait: a pause that is still open keeps its deadline (also across a worker handoff).
    const open = job.paused_until && new Date(job.paused_until as string).getTime() > Date.now();
    const until = b.action === "pause" ? (open ? (job.paused_until as string) : new Date(Date.now() + PAUSE_MS).toISOString()) : null;
    const log = ((job.log ?? []) as string[]).slice(-40);
    await db.from("browser_jobs").update({
      control: to, control_reason: b.action === "pause" ? reason : null, paused_until: until,
      ...(b.action === "pause" && job.control !== to ? { log: [...log, `Paused: ${reason}`.slice(0, 200)] } : {}),
    }).eq("id", id);
    if (b.action === "pause" && job.control !== to) {
      try { await sendPushToUser(db, job.user_id as string, { title: "The browser needs you", body: reason, url: "/app", tag: `browser-${id}` }); } catch { /* optional */ }
    }
    return json({ control: to, paused_until: until ? new Date(until).getTime() : 0 });
  }
  if (b.action === "handoff") {
    const r = b.resume as { provider?: unknown; id?: unknown } | undefined;
    if (typeof r?.provider !== "string" || typeof r?.id !== "string" || !/^[A-Za-z0-9-]{6,80}$/.test(r.id)) return badRequest("Bad resume");
    if (job.control !== "paused" && job.control !== "user") return json({ error: "Only a paused job is handed over" }, 409);
    await db.from("browser_jobs").update({ status: "queued", claimed_at: null, resume: { provider: r.provider.slice(0, 20), id: r.id } }).eq("id", id).eq("status", "running");
    return json({ ok: true });
  }

  if (b.action === "secret") {
    const sid = typeof b.secret_id === "string" ? b.secret_id : "";
    const field = typeof b.field === "string" ? b.field : "";
    const steps = (job.steps ?? []) as { action?: string; secret_id?: string; field?: string }[];
    const allowed = job.mode === "auto" ? ((job.allowed_secrets ?? []) as string[]).includes(sid) : steps.some((s) => s.action === "fill_secret" && s.secret_id === sid && s.field === field);
    if (!allowed) return json({ error: "That secret isn't part of this job" }, 403);
    if (!(await checkLimit({ key: `vault-read:${job.user_id}`, limit: 20, windowSec: 600 }))) return json({ error: "Too many requests" }, 429);
    const { data: row } = await db.from("vault_secrets").select("secret_box").eq("id", sid).eq("user_id", job.user_id).maybeSingle();
    if (!row) return json({ error: "Secret not found" }, 404);
    const fields = openVault(job.user_id as string, row.secret_box as string);
    await db.from("vault_secrets").update({ last_used_at: new Date().toISOString() }).eq("id", sid);
    if (!(field in fields)) return json({ error: "That field isn't saved" }, 404);
    return new Response(JSON.stringify({ value: fields[field] }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }

  const account = accountOf(job.inputs);
  const checkout = checkoutOf(job.inputs);
  // Sign-in, account (register / reset) and checkout jobs share the site session, code and link helpers.
  const signin = signinOf(job.inputs)
    ?? (account ? { site: account.site, via: "password", goal: account.goal, lang: account.lang ?? null } : null)
    ?? (checkout ? { site: checkout.site, via: "password", goal: checkout.goal, lang: checkout.lang ?? null } : null);
  if (b.action === "checkout_ready" || b.action === "checkout_state") {
    if (!checkout) return badRequest("Not a checkout job");
    if (b.action === "checkout_ready") {
      const r = await checkoutReady(db, job as { id: string; user_id: string; inputs: Record<string, unknown> }, checkout, b.state, b.url);
      return r.ok ? json({ ok: true }) : json({ error: r.error }, 400);
    }
    const state = checkoutState(job.user_id as string, id, checkout);
    if (!state) return json({ error: "No saved checkout state" }, 404);
    return new Response(JSON.stringify({ state }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  if (b.action === "link") {
    if (!signin) return badRequest("Not a sign-in job");
    const inputs = job.inputs as Record<string, unknown>;
    const askedAt = typeof inputs.link_asked_at === "number" ? inputs.link_asked_at : Date.now();
    if (inputs.link_asked_at === undefined) await db.from("browser_jobs").update({ inputs: { ...inputs, link_asked_at: askedAt } }).eq("id", id);
    const link = await gmailSiteLink(job.user_id as string, signin.site, askedAt - 120000).catch(() => null);
    if (link === "unavailable") return json({ link: null, error: "Gmail isn't connected, so the emailed link can't be opened" });
    return new Response(JSON.stringify({ link: link ?? null }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  if (b.action === "cookies" || b.action === "code" || b.action === "save_session") {
    if (!signin) return badRequest("Not a sign-in job");
    if (b.action === "cookies") {
      const cookies = await loadSiteCookies(job.user_id as string, signin.site).catch(() => null);
      return new Response(JSON.stringify({ cookies: cookies ?? [] }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }
    if (b.action === "save_session") {
      const r = await saveSiteSession({ userId: job.user_id as string, site: signin.site, via: signin.via, cookies: b.cookies }).catch(() => ({ ok: false as const, error: "save failed" }));
      return json({ ok: r.ok });
    }
    // code: the user's own entry wins, then the newest code in their Gmail; otherwise ask in chat.
    const inputs = job.inputs as Record<string, unknown>;
    if (typeof inputs.code_box === "string" && inputs.code_box) {
      let code: string | null = null;
      try { code = decryptWithAny(inputs.code_box, decryptionKeys()); } catch { code = null; }
      await db.from("browser_jobs").update({ inputs: { ...inputs, code_box: null } }).eq("id", id);
      if (code) return new Response(JSON.stringify({ code, from: "user" }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }
    const askedAt = typeof inputs.code_asked_at === "number" ? inputs.code_asked_at : Date.now();
    if (inputs.code_asked_at === undefined) await db.from("browser_jobs").update({ inputs: { ...inputs, code_asked_at: askedAt } }).eq("id", id);
    const fromMail = await gmailSigninCode(job.user_id as string, signin.site, askedAt - 120000).catch(() => null);
    if (fromMail && fromMail !== "unavailable") return new Response(JSON.stringify({ code: fromMail, from: "gmail" }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    const log = ((job.log ?? []) as string[]).slice(-40);
    // Ask the user once Gmail can't help (not connected, or nothing arrived in ~30s).
    if (!log.includes(WAITING_FOR_CODE) && (fromMail === "unavailable" || Date.now() - askedAt > 30000)) {
      await db.from("browser_jobs").update({ log: [...log, WAITING_FOR_CODE] }).eq("id", id);
    }
    return json({ code: null });
  }

  if (b.action === "progress") {
    const line = typeof b.line === "string" ? b.line.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    if (!line) return badRequest("line required");
    const log = ((job.log ?? []) as string[]).slice(-40);
    await db.from("browser_jobs").update({ log: [...log, line] }).eq("id", id);
    return json({ ok: true });
  }

  if (b.action === "next") {
    if (job.mode !== "auto") return badRequest("Not a smart job");
    const snap = snapshotSchema.safeParse(b.snapshot);
    if (!snap.success) return badRequest("Bad snapshot");
    const log = ((job.log ?? []) as string[]).slice(-40);
    const left = (job.max_steps as number) - log.length;
    if (left <= 0) return json({ action: { do: "fail", reason: "Ran out of steps before finishing" } });
    const ids = (job.allowed_secrets ?? []) as string[];
    const { data: secrets } = ids.length ? await db.from("vault_secrets").select("id, kind, label, site").eq("user_id", job.user_id).in("id", ids) : { data: [] };
    let pays = false;
    const guard = checkout ? (a: Parameters<typeof guardCheckout>[1]) => {
      const g = guardCheckout(checkout, a, snap.data, log);
      if ("action" in g && g.pays) pays = true;
      return g;
    } : undefined;
    let action = await decideNext(signin?.goal ?? (job.goal as string), snap.data, (secrets ?? []) as { id: string; kind: string; label: string; site: string | null }[], log, left, guard);
    if (action.do === "ready_to_pay") {
      if (checkout?.phase === "prepare") {
        // Remember what the pay page showed (already checked against it by the guard); the card is built from this.
        // The card isn't readable by this job at all; only its label is shown on the card.
        const { data: vault } = checkout.payment_secret_id
          ? await db.from("vault_secrets").select("label, preview").eq("id", checkout.payment_secret_id).eq("user_id", job.user_id).maybeSingle()
          : { data: null };
        const pending = { items: action.items, total: action.total, payment: action.payment || (vault ? `${`${vault.label ?? ""} ${vault.preview ?? ""}`.trim()} (from your vault, entered after you approve)` : ""), pay_i: action.i };
        const inputs = job.inputs as Record<string, unknown>;
        await db.from("browser_jobs").update({ inputs: { ...inputs, checkout: { ...(inputs.checkout as Record<string, unknown>), pending } } }).eq("id", id);
      } else action = { do: "done", result: `Reached the payment step (total ${action.total}). Stopped before paying.` };
    }
    if (action.do === "ready_to_confirm") {
      if (checkout?.phase === "prepare" && checkout.kind === "booking") {
        const pending = { items: [], total: action.price, payment: "", what: action.what || checkout.what || "", when: action.when, details: action.details, pay_i: action.i };
        const inputs = job.inputs as Record<string, unknown>;
        await db.from("browser_jobs").update({ inputs: { ...inputs, checkout: { ...(inputs.checkout as Record<string, unknown>), pending } } }).eq("id", id);
      } else action = { do: "done", result: `Reached the final confirm step (${action.when}). Stopped before confirming.` };
    }
    // A sign-in is only "done" when the page proves it (login form gone / logged-in markers, no Cloudflare check
    // pending, and the model's own summary doesn't say it failed). Otherwise it is a failure with the real reason.
    let verified = "";
    if (action.do === "done" && signinOf(job.inputs)) {
      const v = verifyLogin(snap.data, action.result);
      if (v.ok) verified = `verified: ${v.evidence}`;
      else action = { do: "fail", reason: `${v.code}: ${v.reason}`.slice(0, 400) };
    } else if (action.do === "done" && account?.flow === "register") {
      // An account is only "created" when the page shows it (no form error, form gone or a created / verify-email message).
      const v = verifySignup(snap.data, action.result);
      if (v.ok) verified = `verified: ${v.evidence}`;
      else action = { do: "fail", reason: `${v.code}: ${v.reason}`.slice(0, 400) };
    }
    const line = action.do === "done" || action.do === "fail" ? (verified ? `done: ${account?.flow === "register" ? "account created" : "signed in"}, ${verified}`.slice(0, 200) : action.do) : `${action.do}${"i" in action ? ` [${action.i}]` : ""}${action.do === "fill_secret" ? ` ${action.field}` : ""}${"why" in action && action.why ? `: ${action.why}` : ""}`.slice(0, 200);
    await db.from("browser_jobs").update({ log: [...log, line, ...(pays && action.do !== "done" && action.do !== "fail" ? [PAY_PRESSED] : [])] }).eq("id", id);
    return json({ action });
  }

  if (b.action === "finish") {
    let ok = b.status === "done";
    const finalShot = typeof b.shot === "string" && b.shot.length < 390000 && /^[A-Za-z0-9+/=]+$/.test(b.shot) ? b.shot : null;
    const stoppedByUser = job.control === "stop" || (typeof b.error === "string" && b.error.startsWith(STOPPED));
    await db.from("browser_jobs").update({ ...(finalShot ? { frame: finalShot, frame_at: new Date().toISOString() } : {}), control: null, control_reason: null, paused_until: null, resume: null }).eq("id", id);
    // Defense in depth: a sign-in "done" whose own report says the login didn't happen is a failure.
    if (ok && signinOf(job.inputs) && resultSaysFailed(typeof b.result === "string" ? b.result : "")) {
      ok = false;
      b.error = `${NOT_SIGNED_IN}: ${String(b.result).replace(/\s+/g, " ").slice(0, 300)}`;
    }
    let result = typeof b.result === "string" ? b.result : null;
    // Video jobs: the worker sends frames + captions; TARGET turns them into a description.
    if (ok && job.mode === "video") {
      const frames = Array.isArray(b.frames) ? (b.frames as unknown[]).filter((f): f is string => typeof f === "string" && f.length < 400000).slice(0, 8) : [];
      result = await describeVideo(job.goal as string, typeof b.title === "string" ? b.title.slice(0, 300) : "", typeof b.captions === "string" ? b.captions : "", frames);
    }
    // Code jobs: files the program saved into out/ become downloads for the owner.
    const files = await storeJobFiles(db, job.user_id as string, b.files);
    // The vault values this job could use (passwords, card numbers) never reach the result or the chat, even when
    // the page or the model's summary repeats them.
    const sids = (job.allowed_secrets ?? []) as string[];
    if (sids.length && (result || b.error)) {
      const { data: rows } = await db.from("vault_secrets").select("secret_box").eq("user_id", job.user_id).in("id", sids);
      const known: string[] = [];
      for (const r of (rows ?? []) as { secret_box: string }[]) {
        try { for (const [k, v] of Object.entries(openVault(job.user_id as string, r.secret_box))) if (typeof v === "string" && v.length >= 4 && !/^(username|email|label|site|name)$/i.test(k)) known.push(v); } catch { /* unreadable box */ }
      }
      const hide = (t: string) => known.reduce((acc, v) => acc.split(v).join("[hidden]"), t);
      if (result) result = hide(result);
      if (typeof b.error === "string") b.error = hide(b.error);
    }
    if (account) await settleSiteAccount(db, job.user_id as string, account, ok, ((job.log ?? []) as string[])).catch(() => undefined);
    if (checkout) {
      // Checkout jobs post their own message: the approval card after prepare, the outcome after pay.
      await finishCheckout(db, job as { id: string; user_id: string; conversation_id: string | null; inputs: Record<string, unknown>; goal: string }, checkout, ok, result, typeof b.error === "string" ? b.error : null);
      try { await sendPushToUser(db, job.user_id as string, { title: checkout.phase === "prepare" ? (ok ? "Checkout ready: approve to pay" : "Checkout stopped") : ok ? "Order placed" : "Payment stopped", body: checkout.merchant, url: "/app", tag: `browser-${id}` }); } catch { /* optional */ }
      return json({ ok: true });
    }
    await db.from("browser_jobs").update({
      status: ok ? "done" : stoppedByUser ? "cancelled" : "failed", result: result ? result.slice(0, 20000) : null, files,
      error: ok ? null : String(b.error ?? "The browser task failed").slice(0, 500), finished_at: new Date().toISOString(),
    }).eq("id", id).eq("status", "running");
    if (job.conversation_id) {
      const si = signinOf(job.inputs);
      const head = account ? accountPost(account, ok) : stoppedByUser ? `⏹ **Browser task stopped:** ${job.goal}` : si ? signinPostHead(si.site, ok, si.lang) : ok ? `🌐 **Browser task done:** ${job.goal}` : `⚠️ **Browser task failed:** ${job.goal}`;
      const body = ok ? (result ?? "").slice(0, 6000) : stoppedByUser ? "Stopped by you." : si ? signinFailure(String(b.error ?? ""), si.site, si.lang).line : String(b.error ?? "The browser task failed").slice(0, 500);
      const links = files.map((f) => `- [${f.name}](${f.url})`).join("\n");
      const content = [head, body, links].filter(Boolean).join("\n\n");
      await db.from("messages").insert({ conversation_id: job.conversation_id, user_id: job.user_id, role: "assistant", content });
      await db.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", job.conversation_id);
    }
    try { await sendPushToUser(db, job.user_id as string, { title: ok ? "Browser task done" : "Browser task failed", body: String(job.goal).slice(0, 120), url: "/app/settings/browser", tag: `browser-${id}` }); } catch { /* optional */ }
    return json({ ok: true });
  }
  return badRequest("Unknown action");
}

function signinOf(inputs: unknown): { site: string; via: string; goal?: string; lang: Lang | null } | null {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return null;
  const s = (inputs as { signin?: { site?: unknown; via?: unknown; goal?: unknown; lang?: unknown } }).signin;
  if (!s || typeof s.site !== "string") return null;
  return { site: s.site, via: typeof s.via === "string" ? s.via : "password", goal: typeof s.goal === "string" ? s.goal : undefined, lang: isLang(s.lang) ? s.lang : null };
}
