import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { getIntegration, isConfigured } from "@/lib/integrations/registry";
import { loadKey, newNonce, signState } from "@/lib/integrations/crypto";
import { authorizeUrl } from "@/lib/integrations/google";

export const dynamic = "force-dynamic";

/** Starts OAuth. Only works when the provider's server credentials are configured. */
export async function GET(req: Request, { params }: { params: { provider: string } }) {
  const origin = new URL(req.url).origin;
  const back = (q: string) => NextResponse.redirect(`${origin}/app/settings/connections?${q}`, { status: 303 });
  const a = await requireUser();
  if (!a) return NextResponse.redirect(`${origin}/login?next=/app/settings/connections`, { status: 303 });
  const i = getIntegration(params.provider);
  if (!i || i.kind !== "oauth") return back("error=unknown");
  if (!isConfigured(i, process.env)) return back("error=setup");
  const nonce = newNonce();
  const state = signState({ uid: a.user.id, provider: i.id, nonce }, loadKey(process.env.TOKEN_ENCRYPTION_KEY));
  const res = NextResponse.redirect(authorizeUrl(process.env, `${origin}/api/integrations/${i.id}/callback`, state), { status: 303 });
  res.cookies.set("target_oauth_nonce", nonce, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/api/integrations", maxAge: 600 });
  return res;
}
