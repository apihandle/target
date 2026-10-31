import { redact } from "@/lib/connectors/safety";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Db } from "@/lib/server/auth";
import { sendPushToUser } from "@/lib/server/push";

export type ErrorReport = { source: "client" | "server" | "cron"; message: string; stack?: string | null; url?: string | null; userId?: string | null };

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");

/** Same error, same fingerprint: message plus first stack frame, with numbers stripped so ids and line numbers don't split it. */
export function fingerprint(r: Pick<ErrorReport, "source" | "message" | "stack">): string {
  const frame = (r.stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "";
  const key = `${r.source}|${r.message}|${frame}`.replace(/\d+/g, "#").replace(/\s+/g, " ");
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** One phone alert per error type per 30 minutes, per server instance (the database check below covers the rest). */
const lastAlert = new Map<string, number>();
const ALERT_EVERY_MS = 30 * 60 * 1000;

let adminId: string | null | undefined;
async function adminUserId(db: Db): Promise<string | null> {
  if (adminId !== undefined) return adminId;
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) return (adminId = null);
  try {
    const { data } = await (db as unknown as { auth: { admin: { listUsers: (o: { page: number; perPage: number }) => Promise<{ data: { users: { id: string; email?: string }[] } }> } } })
      .auth.admin.listUsers({ page: 1, perPage: 1000 });
    adminId = data.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
  } catch { adminId = null; }
  return adminId;
}

/** For tests. */
export function resetErrorState() { lastAlert.clear(); adminId = undefined; }

/**
 * Records an error: always in the Vercel logs, in error_events when the service key is set, and as a
 * push alert to ADMIN_EMAIL's phone the first time each kind of error shows up in a 30-minute window.
 * Never throws: error reporting must not cause errors of its own.
 */
export async function reportError(r: ErrorReport, dbIn?: Db): Promise<void> {
  // Never store or alert with a secret that slipped into an error message, stack or URL.
  const message = redact(clip(r.message, 500)) || "Unknown error";
  const stack = redact(clip(r.stack, 4000)) || null;
  const url = redact(clip(r.url, 500)) || null;
  const fp = fingerprint({ source: r.source, message, stack });
  console.error(`[error:${r.source}] ${message}${url ? ` (${url})` : ""} fp=${fp}`);
  let db = dbIn;
  try { db = db ?? (createAdminClient() as unknown as Db); } catch { return; }
  try {
    const since = new Date(Date.now() - ALERT_EVERY_MS).toISOString();
    const { count } = await db.from("error_events").select("id", { count: "exact", head: true }).eq("fingerprint", fp).gte("created_at", since);
    await db.from("error_events").insert({ source: r.source, message, stack, url, fingerprint: fp, user_id: r.userId ?? null });
    const now = Date.now();
    if ((count ?? 0) > 0 || now - (lastAlert.get(fp) ?? 0) < ALERT_EVERY_MS) return;
    lastAlert.set(fp, now);
    const admin = await adminUserId(db);
    if (admin) await sendPushToUser(db, admin, { title: `TARGET error (${r.source})`, body: message, url: "/app/settings/errors", tag: `err-${fp}` });
  } catch (e) {
    console.error("[error] could not record:", e instanceof Error ? e.message : e);
  }
}

export function isAdminEmail(email?: string | null): boolean {
  const a = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  return !!a && !!email && email.toLowerCase() === a;
}
