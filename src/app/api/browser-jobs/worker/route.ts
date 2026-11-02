import { badRequest, json, readJson, type Db } from "@/lib/server/auth";
import { UUID_RE, workerAuth } from "@/lib/server/worker";
import { createAdminClient } from "@/lib/supabase/admin";
import { openVault } from "@/lib/builtins/vault";
import { checkLimit } from "@/lib/connectors/rateLimit";
import { sendPushToUser } from "@/lib/server/push";
import { ATTACHMENT_BUCKET } from "@/lib/attachments";
import { decideNext, describeVideo, snapshotSchema } from "@/lib/server/autoBrowser";
import { SITE } from "@/lib/builtins/helpers";
import { decryptWithAny, decryptionKeys } from "@/lib/connectors/crypto";
import { loadSiteCookies, saveSiteSession } from "@/lib/server/siteSessions";
import { gmailSigninCode } from "@/lib/server/signinMail";
import { WAITING_FOR_CODE } from "@/lib/builtins/signin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OUT_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", csv: "text/csv", txt: "text/plain", md: "text/markdown", json: "application/json", html: "text/html", pdf: "application/pdf", mp3: "audio/mpeg", mp4: "video/mp4", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };

/**
 * Trusted browser worker only (Bearer SESSION_WORKER_SECRET). Actions:
 *  claim  -> the oldest queued job (atomically moved to running) of a mode this worker supports
 *  next   -> smart mode: given the page snapshot, the AI's next action
 *  secret -> one vault field for a fill_secret step of a RUNNING job that lists that secret
 *  progress -> add one human-readable line to the job's live log
 *  cookies -> sign-in jobs: the saved session for the job's site (so an existing login is reused)
 *  code   -> sign-in jobs: a one-time code, from the user's Gmail or the code form in chat
 *  save_session -> sign-in jobs: store the signed-in cookies (encrypted) in site_sessions
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
    const modes = Array.isArray(b.modes) ? (b.modes as unknown[]).filter((m): m is string => typeof m === "string") : ["steps"];
    const { data: next } = await db.from("browser_jobs").select("id").eq("status", "queued").in("mode", modes).order("created_at", { ascending: true }).limit(1);
    if (!next?.length) return json({ job: null });
    const { data } = await db.from("browser_jobs").update({ status: "running", claimed_at: new Date().toISOString() })
      .eq("id", next[0].id).eq("status", "queued").select("id, user_id, goal, start_url, steps, mode, max_steps, language, code, inputs, allowed_secrets");
    return json({ job: data?.[0] ?? null });
  }

  const id = typeof b.job_id === "string" && UUID_RE.test(b.job_id) ? b.job_id : null;
  if (!id) return badRequest("job_id required");
  const { data: job } = await db.from("browser_jobs").select("id, user_id, goal, status, steps, mode, allowed_secrets, max_steps, log, conversation_id, inputs, claimed_at").eq("id", id).maybeSingle();
  if (!job || job.status !== "running") return json({ error: "Job is not running" }, 409);

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

  const signin = signinOf(job.inputs);
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
    const action = await decideNext(signin?.goal ?? (job.goal as string), snap.data, (secrets ?? []) as { id: string; kind: string; label: string; site: string | null }[], log, left);
    const line = action.do === "done" || action.do === "fail" ? action.do : `${action.do}${"i" in action ? ` [${action.i}]` : ""}${action.do === "fill_secret" ? ` ${action.field}` : ""}${"why" in action && action.why ? `: ${action.why}` : ""}`.slice(0, 200);
    await db.from("browser_jobs").update({ log: [...log, line] }).eq("id", id);
    return json({ action });
  }

  if (b.action === "finish") {
    const ok = b.status === "done";
    let result = typeof b.result === "string" ? b.result : null;
    // Video jobs: the worker sends frames + captions; TARGET turns them into a description.
    if (ok && job.mode === "video") {
      const frames = Array.isArray(b.frames) ? (b.frames as unknown[]).filter((f): f is string => typeof f === "string" && f.length < 400000).slice(0, 8) : [];
      result = await describeVideo(job.goal as string, typeof b.title === "string" ? b.title.slice(0, 300) : "", typeof b.captions === "string" ? b.captions : "", frames);
    }
    // Code jobs: files the program saved into out/ become downloads for the owner.
    const files: { name: string; url: string }[] = [];
    if (Array.isArray(b.files)) {
      for (const f of (b.files as { name?: unknown; base64?: unknown }[]).slice(0, 5)) {
        if (typeof f?.name !== "string" || typeof f.base64 !== "string") continue;
        const name = f.name.replace(/[^\w.\- ]/g, "_").slice(0, 100) || "file";
        const bytes = Buffer.from(f.base64, "base64");
        if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024) continue;
        const mime = OUT_MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
        const fid = crypto.randomUUID();
        const path = `${job.user_id}/generated/${fid}-${name}`;
        const up = await db.storage.from(ATTACHMENT_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
        if (up.error) continue;
        const { error } = await db.from("generated_files").insert({ id: fid, user_id: job.user_id, name, mime, size_bytes: bytes.byteLength, storage_path: path });
        if (!error) files.push({ name, url: `${SITE}/api/files/${fid}` });
      }
    }
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
    await db.from("browser_jobs").update({
      status: ok ? "done" : "failed", result: result ? result.slice(0, 20000) : null, files,
      error: ok ? null : String(b.error ?? "The browser task failed").slice(0, 500), finished_at: new Date().toISOString(),
    }).eq("id", id).eq("status", "running");
    if (job.conversation_id) {
      const head = ok ? `🌐 **Browser task done:** ${job.goal}` : `⚠️ **Browser task failed:** ${job.goal}`;
      const body = ok ? (result ?? "").slice(0, 6000) : String(b.error ?? "The browser task failed").slice(0, 500);
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

function signinOf(inputs: unknown): { site: string; via: string; goal?: string } | null {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return null;
  const s = (inputs as { signin?: { site?: unknown; via?: unknown; goal?: unknown } }).signin;
  if (!s || typeof s.site !== "string") return null;
  return { site: s.site, via: typeof s.via === "string" ? s.via : "password", goal: typeof s.goal === "string" ? s.goal : undefined };
}
