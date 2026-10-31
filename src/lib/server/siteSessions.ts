import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, decryptWithAny, decryptionKeys, encryptSecret, primaryKey } from "@/lib/connectors/crypto";
import { MAX_SESSIONS_PER_USER, cleanVia, liveCookies, normalizeSite, sanitizeCookies, sessionExpiry, type Cookie, type SessionVia } from "@/lib/sessions";
import { logActivity } from "@/lib/server/activity";

/**
 * Server-only vault for website sessions. Cookies are encrypted at rest, never sent to the browser,
 * never given to the AI model, and only returned to the trusted session worker for the same user and site.
 */
export async function saveSiteSession(p: { userId: string; site: string; accountEmail?: string; via?: SessionVia | string; cookies: unknown }) {
  const domain = normalizeSite(p.site);
  if (!domain) return { ok: false as const, error: "Invalid site" };
  const cookies = sanitizeCookies(p.cookies, domain);
  if (!cookies) return { ok: false as const, error: "No valid cookies for this site" };
  const admin = createAdminClient();
  const email = (p.accountEmail ?? "").trim().toLowerCase().slice(0, 320);
  const { count } = await admin.from("site_sessions").select("id", { count: "exact", head: true }).eq("user_id", p.userId);
  const { data: existing } = await admin.from("site_sessions").select("id").eq("user_id", p.userId).eq("domain", domain).eq("account_email", email).maybeSingle();
  if (!existing && (count ?? 0) >= MAX_SESSIONS_PER_USER) return { ok: false as const, error: "Too many saved sessions" };
  const now = new Date().toISOString();
  const { data, error } = await admin.from("site_sessions").upsert({
    user_id: p.userId, domain, account_email: email, via: cleanVia(p.via),
    encrypted_cookies: sealCookies(p.userId, domain, cookies),
    cookie_count: cookies.length, status: "active", expires_at: sessionExpiry(cookies).toISOString(), updated_at: now,
  }, { onConflict: "user_id,domain,account_email" }).select("id").single();
  if (error || !data) return { ok: false as const, error: "Could not save the session" };
  await logActivity(admin, p.userId, { category: "connection", title: `Saved sign-in for ${domain}`, detail: email ? `Account ${email}` : undefined });
  return { ok: true as const, id: data.id as string, domain, cookieCount: cookies.length };
}

/**
 * Encrypted envelope bound to its owner and site: { v: 2, u: userId, d: domain, c: cookies }.
 * Even with database access, a ciphertext copied onto another user's or site's row is refused.
 */
export function sealCookies(userId: string, domain: string, cookies: Cookie[]): string {
  return encryptSecret(JSON.stringify({ v: 2, u: userId, d: domain, c: cookies }), primaryKey());
}

/** Decrypt and verify the envelope. `stale` = written with an older key, so re-encrypt it. */
export function openCookies(box: string, userId: string, domain: string): { cookies: Cookie[]; stale: boolean } | null {
  let plain: string, stale = false;
  try { plain = decryptSecret(box, primaryKey()); }
  catch {
    try { plain = decryptWithAny(box, decryptionKeys()); stale = true; } catch { return null; }
  }
  try {
    const j = JSON.parse(plain) as unknown;
    if (Array.isArray(j)) return { cookies: j as Cookie[], stale: true }; // v1 rows: upgrade to the bound format
    const e = j as { v?: number; u?: string; d?: string; c?: Cookie[] };
    if (e.v !== 2 || e.u !== userId || e.d !== domain || !Array.isArray(e.c)) return null;
    return { cookies: e.c, stale };
  } catch { return null; }
}

/** Decrypted, still-valid cookies for a user's site, or null (marks the row expired when nothing is left). */
export async function loadSiteCookies(userId: string, site: string, accountEmail?: string): Promise<Cookie[] | null> {
  const domain = normalizeSite(site);
  if (!domain) return null;
  const admin = createAdminClient();
  let q = admin.from("site_sessions").select("id, encrypted_cookies, status, expires_at").eq("user_id", userId).eq("domain", domain).eq("status", "active");
  if (accountEmail !== undefined) q = q.eq("account_email", accountEmail.trim().toLowerCase());
  const { data } = await q.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const row = data as { id: string; encrypted_cookies: string; expires_at: string };
  const opened = openCookies(row.encrypted_cookies, userId, domain);
  const cookies = opened ? liveCookies(opened.cookies) : [];
  if (!cookies.length || Date.parse(row.expires_at) <= Date.now()) {
    await admin.from("site_sessions").update({ status: "expired", encrypted_cookies: "" }).eq("id", row.id).eq("user_id", userId);
    return null;
  }
  await admin.from("site_sessions").update({
    last_used_at: new Date().toISOString(),
    ...(opened?.stale ? { encrypted_cookies: sealCookies(userId, domain, cookies) } : {}),
  }).eq("id", row.id).eq("user_id", userId);
  return cookies;
}

/** The website logged us out (or rejected the cookies): mark it expired and wipe the cookies. */
export async function invalidateSiteSession(userId: string, site: string, accountEmail?: string) {
  const domain = normalizeSite(site);
  if (!domain) return 0;
  let q = createAdminClient().from("site_sessions").update({ status: "expired", encrypted_cookies: "", updated_at: new Date().toISOString() })
    .eq("user_id", userId).eq("domain", domain);
  if (accountEmail !== undefined) q = q.eq("account_email", accountEmail.trim().toLowerCase());
  const { data } = await q.select("id");
  return (data ?? []).length;
}

/** Sign out of saved sessions: wipes the encrypted cookies too (the row is deleted). */
export async function deleteSiteSessions(userId: string, filter: { id?: string; viaGoogleEmail?: string } = {}) {
  const admin = createAdminClient();
  let q = admin.from("site_sessions").delete().eq("user_id", userId);
  if (filter.id) q = q.eq("id", filter.id);
  if (filter.viaGoogleEmail) q = q.eq("via", "google").eq("account_email", filter.viaGoogleEmail.toLowerCase());
  const { data } = await q.select("id");
  return (data ?? []).length;
}

/** Housekeeping for the cron: past-expiry rows lose their cookies now and are deleted after 7 days. */
export async function purgeExpiredSessions() {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  await admin.from("site_sessions").update({ status: "expired", encrypted_cookies: "" }).lt("expires_at", now).eq("status", "active");
  await admin.from("site_sessions").delete().lt("expires_at", new Date(Date.now() - 7 * 86400000).toISOString());
}
