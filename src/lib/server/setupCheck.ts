import { createAdminClient } from "@/lib/supabase/admin";
import type { Db } from "@/lib/server/auth";
import { isOnline, workerBeats, type WorkerBeat } from "@/lib/server/workerStatus";

export type Check = { key: string; label: string; ok: boolean; required: boolean; fix: string };

/** Environment variables, by what they unlock. Only presence is ever reported, never a value. */
export const ENV_CHECKS: { name: string | string[]; label: string; required: boolean; fix: string }[] = [
  { name: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"], label: "Database (Supabase)", required: true, fix: "Vercel: add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", label: "Server database key", required: true, fix: "Vercel: add SUPABASE_SERVICE_ROLE_KEY (Supabase > Project Settings > API)" },
  { name: ["NVIDIA_API_KEY", "OPENROUTER_API_KEY"], label: "AI model", required: true, fix: "Vercel: add NVIDIA_API_KEY or OPENROUTER_API_KEY" },
  { name: ["CONNECTOR_ENCRYPTION_KEY", "TOKEN_ENCRYPTION_KEY"], label: "Encryption for connectors and vault", required: true, fix: "Vercel: add CONNECTOR_ENCRYPTION_KEY" },
  { name: "CRON_SECRET", label: "Reminders and scheduled prompts", required: true, fix: "Vercel and GitHub Actions secrets: add the same CRON_SECRET" },
  { name: "TAVILY_API_KEY", label: "Web search", required: false, fix: "Vercel: add TAVILY_API_KEY (free key at tavily.com)" },
  { name: ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"], label: "Phone notifications", required: false, fix: "Vercel: add NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY" },
  { name: "ADMIN_EMAIL", label: "Owner email (error alerts)", required: false, fix: "Vercel: add ADMIN_EMAIL with your sign-in email" },
  { name: "SESSION_WORKER_SECRET", label: "Worker secret", required: false, fix: "Vercel: add SESSION_WORKER_SECRET (same value on the worker)" },
  { name: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"], label: "Google connector (Gmail, Calendar)", required: false, fix: "Vercel: add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET" },
  { name: "POLLINATIONS_KEY", label: "AI photo edits", required: false, fix: "Vercel: add POLLINATIONS_KEY" },
];

/** One table (or column) each migration adds; if it can be read, that migration has run. */
export const MIGRATION_CHECKS: { file: string; table: string; column?: string }[] = [
  { file: "0006_workspace", table: "tasks" },
  { file: "0007_connectors", table: "connector_oauth_states" },
  { file: "0008_features", table: "scheduled_jobs" },
  { file: "0009_push_errors", table: "push_subscriptions" },
  { file: "0010_work", table: "work_links" },
  { file: "0011_site_sessions", table: "site_sessions" },
  { file: "0012_reminders", table: "scheduled_jobs", column: "interval_hours" },
  { file: "0013_capabilities", table: "browser_jobs" },
  { file: "0014_round2", table: "suggestions" },
  { file: "0015_round3", table: "worker_heartbeats" },
  { file: "0016_browser_help", table: "browser_jobs", column: "help_inputs" },
];

export function envChecks(env: Record<string, string | undefined> = process.env): Check[] {
  return ENV_CHECKS.map((c) => {
    const names = Array.isArray(c.name) ? c.name : [c.name];
    // A pair like URL + key needs both; an "either" group (AI keys, encryption) needs one.
    const either = c.label === "AI model" || c.label.startsWith("Encryption");
    const has = (n: string) => !!env[n]?.trim();
    const ok = either ? names.some(has) : names.every(has);
    return { key: `env:${names.join("+")}`, label: c.label, ok, required: c.required, fix: c.fix };
  });
}

export async function migrationChecks(): Promise<Check[]> {
  let db: Db | null = null;
  try { db = createAdminClient() as unknown as Db; } catch { db = null; }
  return Promise.all(MIGRATION_CHECKS.map(async (m) => {
    let ok = false;
    if (db) {
      try { const { error } = await db.from(m.table).select(m.column ?? "*", { head: true, count: "exact" }).limit(1); ok = !error; } catch { ok = false; }
    }
    return { key: `db:${m.file}`, label: `Migration ${m.file}`, ok, required: true, fix: db ? `Supabase SQL Editor: run supabase/migrations/${m.file}.sql` : "Add SUPABASE_SERVICE_ROLE_KEY first, then this can be checked" };
  }));
}

export function workerCheck(beats: WorkerBeat[]): Check {
  const ok = isOnline(beats);
  return { key: "worker", label: "Worker (smart browser)", ok, required: false, fix: "Start the free Hugging Face Space from SETUP-REMAINING.md. Without it, code still runs in your browser." };
}

export async function runSetupCheck(): Promise<{ env: Check[]; db: Check[]; worker: Check }> {
  const [db, beats] = await Promise.all([migrationChecks(), workerBeats()]);
  return { env: envChecks(), db, worker: workerCheck(beats) };
}

/** Owner only once ADMIN_EMAIL is set; before that, any signed-in user (the owner setting the app up). */
export function canSeeSetup(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  const a = env.ADMIN_EMAIL?.trim().toLowerCase();
  return !a || (!!email && email.toLowerCase() === a);
}
