import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { isConfigured } from "@/lib/connectors/registry";
import { meta } from "@/lib/connectors/meta";
import { consumeState } from "@/lib/connectors/state";
import { saveConnection } from "@/lib/connectors/store";
import { redact } from "@/lib/connectors/safety";
import { logActivity } from "@/lib/server/activity";
import { META_SCOPES, metaGraphVersion } from "@/lib/socialConfig";

export const dynamic = "force-dynamic";

/**
 * Facebook Login callback for the per-user Meta connection. Facebook's code exchanges for a
 * SHORT-lived user token (~1–2h), which is immediately exchanged again (fb_exchange_token) for the
 * long-lived one (~60 days) — that is why this flow can't use the generic connector callback, whose
 * single exchange would store a token that dies within hours. The long-lived token is sealed into
 * the user's "meta" connection row by saveConnection, exactly like every other provider secret; the
 * user's Pages are NOT fetched here — the Page pick happens on /app/connectors via /api/social/meta.
 * Tokens are never put in a URL we control, a log line or an error message.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const page = (q: string) => NextResponse.redirect(`${origin}/app/connectors?${q}`, { status: 303 });
  const a = await requireUser();
  if (!a) return NextResponse.redirect(`${origin}/login?next=/app/connectors`, { status: 303 });
  if (!isConfigured(meta, process.env)) return page("error=setup&connector=facebook");

  // Consume the state first, even when Facebook reports an error, so it can't be replayed.
  const st = await consumeState(url.searchParams.get("state") ?? "", a.user.id, "meta").catch(() => null);
  if (url.searchParams.get("error")) return page("error=denied&connector=facebook");
  if (!st) return page("error=state&connector=facebook");
  const code = url.searchParams.get("code");
  if (!code || code.length > 2000) return page("error=denied&connector=facebook");

  try {
    const v = metaGraphVersion(process.env);
    const appId = process.env.META_APP_ID ?? "";
    const appSecret = process.env.META_APP_SECRET ?? "";
    const tokenUrl = `https://graph.facebook.com/${v}/oauth/access_token`;

    const exchange = async (params: Record<string, string>): Promise<{ token: string; expiresIn?: number }> => {
      const r = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(20000),
        cache: "no-store",
      });
      const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: unknown };
      if (!r.ok || j.error || !j.access_token) throw new Error(`Meta token exchange failed (HTTP ${r.status})`);
      const { access_token: tok, expires_in: exp } = j;
      return { token: tok, expiresIn: exp };
    };

    const short = await exchange({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: `${origin}/api/connectors/meta/callback`,
      code,
    });
    const long = await exchange({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: short.token,
    });

    let name = "";
    let fbUserId = "";
    try {
      const r = await fetch(`https://graph.facebook.com/${v}/me?fields=id,name&access_token=${encodeURIComponent(long.token)}`, {
        signal: AbortSignal.timeout(20000),
        cache: "no-store",
      });
      const me = (await r.json().catch(() => ({}))) as { id?: string; name?: string };
      if (r.ok) { name = String(me.name ?? ""); fbUserId = String(me.id ?? ""); }
    } catch { /* the name is cosmetic; the connection works without it */ }

    await saveConnection(a.user.id, "meta", {
      creds: {
        type: "oauth",
        "access_token": long.token,
        expires_at: long.expiresIn && long.expiresIn > 0 ? Date.now() + long.expiresIn * 1000 : undefined,
        scope: META_SCOPES.join(" "),
        meta: { fb_user_id: fbUserId, fb_user_name: name },
      },
      accountLabel: name || "Facebook account",
      scopes: [...META_SCOPES],
    });
  } catch (e) {
    console.error("[connectors] meta connect failed:", redact(e instanceof Error ? e.message : String(e)).slice(0, 200));
    return page("error=exchange&connector=facebook");
  }
  await logActivity(a.db, a.user.id, { category: "connection", title: "Connected Meta" });
  if (st.returnTo) return NextResponse.redirect(`${origin}${st.returnTo}`, { status: 303 });
  return page("connected=facebook");
}
