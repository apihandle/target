import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/server/auth";
import { getIntegration, isConfigured } from "@/lib/integrations/registry";
import { loadKey, verifyState } from "@/lib/integrations/crypto";
import { exchangeCode } from "@/lib/integrations/google";
import { saveConnection } from "@/lib/integrations/store";
import { logActivity } from "@/lib/server/activity";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { provider: string } }) {
  const url = new URL(req.url);
  const origin = url.origin;
  const back = (q: string) => {
    const r = NextResponse.redirect(`${origin}/app/settings/connections?${q}`, { status: 303 });
    r.cookies.set("target_oauth_nonce", "", { path: "/api/integrations", maxAge: 0 });
    return r;
  };
  const a = await requireUser();
  if (!a) return NextResponse.redirect(`${origin}/login?next=/app/settings/connections`, { status: 303 });
  const i = getIntegration(params.provider);
  if (!i || i.kind !== "oauth" || !isConfigured(i, process.env)) return back("error=setup");
  if (url.searchParams.get("error")) return back("error=denied");

  const state = verifyState(url.searchParams.get("state") ?? "", loadKey(process.env.TOKEN_ENCRYPTION_KEY));
  const nonce = cookies().get("target_oauth_nonce")?.value;
  // State must be signed by us, for this user and provider, and match the browser's nonce cookie.
  if (!state || state.uid !== a.user.id || state.provider !== i.id || !nonce || state.nonce !== nonce) return back("error=state");
  const code = url.searchParams.get("code");
  if (!code) return back("error=denied");

  try {
    const { tokens, email } = await exchangeCode(process.env, code, `${origin}/api/integrations/${i.id}/callback`);
    const granted = (tokens.scope ?? "").split(" ");
    if (!granted.includes("https://www.googleapis.com/auth/calendar.events")) return back("error=scope");
    await saveConnection(a.user.id, i.id, tokens, email || "Google account", granted.filter(Boolean).slice(0, 10));
  } catch (e) {
    console.error("[oauth] connect failed:", e instanceof Error ? e.message : e);
    return back("error=exchange");
  }
  await logActivity(a.db, a.user.id, { category: "connection", title: `Connected ${i.name}` });
  return back(`connected=${i.id}`);
}
