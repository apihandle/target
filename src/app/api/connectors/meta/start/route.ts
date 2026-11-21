import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { isConfigured } from "@/lib/connectors/registry";
import { meta } from "@/lib/connectors/meta";
import { createState, safeReturnTo } from "@/lib/connectors/state";
import { checkLimit, LIMITS } from "@/lib/connectors/rateLimit";
import { META_SCOPES, metaGraphVersion } from "@/lib/socialConfig";

export const dynamic = "force-dynamic";

const page = (origin: string, q: string) => NextResponse.redirect(`${origin}/app/connectors?${q}`, { status: 303 });

/**
 * Start the per-user Facebook Login flow behind BOTH the Facebook and Instagram cards on
 * /app/connectors (the generic /api/connectors/facebook|instagram/connect routes redirect here).
 * Only app-level configuration is needed: META_APP_ID / META_APP_SECRET. The state is the standard
 * connector state (hashed, single-use, bound to this user, connector id "meta"); Facebook returns
 * to /api/connectors/meta/callback.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const a = await requireUser();
  if (!a) return NextResponse.redirect(`${origin}/login?next=/app/connectors`, { status: 303 });
  if (!isConfigured(meta, process.env)) return page(origin, "error=setup&connector=facebook");
  if (!(await checkLimit(LIMITS.connect(a.user.id)))) return page(origin, "error=rate&connector=facebook");
  try {
    const state = await createState({ userId: a.user.id, connectorId: "meta", returnTo: safeReturnTo(url.searchParams.get("return")) });
    const q = new URLSearchParams({
      client_id: process.env.META_APP_ID ?? "",
      redirect_uri: `${origin}/api/connectors/meta/callback`,
      response_type: "code",
      state,
      scope: META_SCOPES.join(","),
    });
    return NextResponse.redirect(`https://www.facebook.com/${metaGraphVersion(process.env)}/dialog/oauth?${q}`, { status: 303 });
  } catch {
    return page(origin, "error=start&connector=facebook");
  }
}
