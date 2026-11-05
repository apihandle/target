import type { Db } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  normalizeAnnouncement, normalizeFlags, normalizeMaintenance, ALL_ON,
  type Announcement, type Feature, type FeatureFlags, type Maintenance,
} from "@/lib/adminConfig";

/**
 * Site-wide admin settings (table admin_settings, migration 0019, service-role only).
 * Read through a short per-instance cache so the proxy, AppShell and the tool gates don't hit the database on
 * every request. A missing table, missing service key or a database error means "defaults" (everything on, no
 * banner, no maintenance): the admin panel must never be able to break the app by accident.
 */
export type AdminSettings = { announcement: Announcement; maintenance: Maintenance; features: FeatureFlags };
export const DEFAULT_SETTINGS: AdminSettings = { announcement: { enabled: false, text: "" }, maintenance: { enabled: false, message: "" }, features: { ...ALL_ON } };

export const CACHE_MS = 15_000;
let cache: { at: number; value: AdminSettings } | null = null;
let inflight: Promise<AdminSettings> | null = null;

export function clearAdminSettingsCache() { cache = null; inflight = null; }

function adminDb(db?: Db): Db | null {
  if (db) return db;
  try { return createAdminClient() as unknown as Db; } catch { return null; }
}

export async function loadAdminSettings(db?: Db): Promise<AdminSettings> {
  const c = adminDb(db);
  if (!c) return DEFAULT_SETTINGS;
  try {
    const { data, error } = await c.from("admin_settings").select("key, value").in("key", ["announcement", "maintenance", "features"]);
    if (error) return DEFAULT_SETTINGS;
    const by = new Map(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
    return { announcement: normalizeAnnouncement(by.get("announcement")), maintenance: normalizeMaintenance(by.get("maintenance")), features: normalizeFlags(by.get("features")) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Cached read (CACHE_MS). Pass db only in tests or when you need a fresh read. */
export async function getAdminSettings(db?: Db): Promise<AdminSettings> {
  if (db) return loadAdminSettings(db);
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  inflight ??= loadAdminSettings().then((value) => { cache = { at: Date.now(), value }; inflight = null; return value; }, () => { inflight = null; return DEFAULT_SETTINGS; });
  return inflight;
}

export async function featureOn(f: Feature, db?: Db): Promise<boolean> {
  return (await getAdminSettings(db)).features[f];
}

/** Write one setting (service role) and drop this instance's cache. Other instances catch up within CACHE_MS. */
export async function saveAdminSetting(db: Db, key: string, value: unknown, actorId: string | null): Promise<boolean> {
  const { error } = await db.from("admin_settings").upsert({ key, value, updated_at: new Date().toISOString(), updated_by: actorId }, { onConflict: "key" });
  clearAdminSettingsCache();
  if (error) console.error("[admin] could not save setting:", error.message);
  return !error;
}

export async function readAdminSetting(db: Db, key: string): Promise<{ value: unknown; updated_at: string | null } | null> {
  try {
    const { data, error } = await db.from("admin_settings").select("value, updated_at").eq("key", key).maybeSingle();
    if (error || !data) return null;
    return data as { value: unknown; updated_at: string | null };
  } catch { return null; }
}

/** Heartbeat for the health page: when a cron route last ran. Never throws. */
export async function recordCronRun(db: Db, which: "scheduled" | "proactive", info: Record<string, unknown>): Promise<void> {
  try {
    await db.from("admin_settings").upsert({ key: `cron:${which}`, value: { at: new Date().toISOString(), ...info }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  } catch { /* table may not exist yet (migration 0019) */ }
}

export type AuditEntry = { action: string; targetType?: string | null; targetId?: string | null; detail?: Record<string, unknown> };

/** Append to admin_audit_log. Returns false when the write failed (the caller decides whether that blocks). */
export async function audit(db: Db, actor: { id: string; email?: string | null }, e: AuditEntry): Promise<boolean> {
  try {
    const { error } = await db.from("admin_audit_log").insert({
      actor_id: actor.id, actor_email: (actor.email ?? "").slice(0, 320), action: e.action.slice(0, 60),
      target_type: e.targetType ?? null, target_id: e.targetId ? String(e.targetId).slice(0, 120) : null, detail: e.detail ?? {},
    });
    if (error) { console.error("[admin] audit write failed:", error.message); return false; }
    return true;
  } catch { return false; }
}
