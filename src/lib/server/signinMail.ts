import { getConnector } from "@/lib/connectors/registry";
import { getCredentials } from "@/lib/connectors/store";
import { canReadGmail, extractVerification } from "@/lib/connectors/google";

/**
 * Read a sign-in code from the user's connected Gmail for a browser sign-in job. Only the code is
 * returned (never the email). "unavailable" = Gmail isn't connected with read access.
 */
export async function gmailSigninCode(userId: string, site: string, sinceMs: number, f: typeof fetch = fetch): Promise<string | null | "unavailable"> {
  const r = await gmailVerification(userId, site, sinceMs, f);
  return r === "unavailable" ? r : r?.code ?? null;
}

/**
 * The newest verification / password-reset link the site emailed (only links on the site's own domain).
 * Used when a site sends a link instead of a code. Never returns the email itself.
 */
export async function gmailSiteLink(userId: string, site: string, sinceMs: number, f: typeof fetch = fetch): Promise<string | null | "unavailable"> {
  const r = await gmailVerification(userId, site, sinceMs, f, "link");
  return r === "unavailable" ? r : r?.link ?? null;
}

async function gmailVerification(userId: string, site: string, sinceMs: number, f: typeof fetch, want: "code" | "link" = "code"): Promise<{ code?: string; link?: string } | null | "unavailable"> {
  const google = getConnector("google");
  if (!google) return "unavailable";
  let token = "";
  try {
    const { creds, info } = await getCredentials(userId, google, f);
    if (!canReadGmail(info.scopes ?? [])) return "unavailable";
    token = creds.access_token;
  } catch { return "unavailable"; }
  const auth = { Authorization: `Bearer ${token}` };
  const base = site.replace(/^www\./, "");
  try {
    const q = `from:${base} newer_than:1h`;
    const list = (await (await f(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&q=${encodeURIComponent(q)}`, { headers: auth, signal: AbortSignal.timeout(10000) })).json()) as { messages?: { id: string }[] };
    for (const m of list.messages ?? []) {
      const full = (await (await f(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, { headers: auth, signal: AbortSignal.timeout(10000) })).json()) as Record<string, unknown>;
      if (Number(full.internalDate ?? 0) < sinceMs) continue;
      const text = `${String(full.snippet ?? "")}\n${bodyText(full.payload as Part, want === "link")}`;
      const v = extractVerification(text, base);
      if (want === "code" ? v.code : v.link) return v;
    }
  } catch { return null; }
  return null;
}

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] };
function bodyText(p: Part | undefined, keepLinks = false): string {
  if (!p) return "";
  const dec = (d: string) => Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  if (p.mimeType === "text/plain" && p.body?.data) return dec(p.body.data);
  for (const c of p.parts ?? []) { const t = bodyText(c, keepLinks); if (t) return t; }
  if (p.mimeType === "text/html" && p.body?.data) {
    const html = dec(p.body.data);
    // Links in HTML mail sit in href attributes; keep them as text so the reset/verify link can be found.
    const withLinks = keepLinks ? html.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi, " $1 ").replace(/&amp;/g, "&") : html;
    return withLinks.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  }
  return "";
}
