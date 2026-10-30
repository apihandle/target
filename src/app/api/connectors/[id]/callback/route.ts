import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { CONNECTOR_ID, getConnector, isConfigured } from "@/lib/connectors/registry";
import { exchangeCode } from "@/lib/connectors/oauth";
import { consumeState } from "@/lib/connectors/state";
import { saveConnection } from "@/lib/connectors/store";
import { resumeTasksFor } from "@/lib/connectors/resume";
import { redact } from "@/lib/connectors/safety";
import { logActivity } from "@/lib/server/activity";

export const dynamic = "force-dynamic";

/** OAuth callback: verify state (single-use, this user + connector), exchange the code, encrypt, save. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const url = new URL(req.url);
  const origin = url.origin;
  const page = (q: string) => NextResponse.redirect(`${origin}/app/connectors?${q}`, { status: 303 });
  const a = await requireUser();
  if (!a) return NextResponse.redirect(`${origin}/login?next=/app/connectors`, { status: 303 });
  const c = CONNECTOR_ID.test(params.id) ? getConnector(params.id) : undefined;
  if (!c || !c.oauth || !isConfigured(c, process.env)) return page("error=setup");

  // Consume the state first, even when the provider reports an error, so it can't be replayed.
  const st = await consumeState(url.searchParams.get("state") ?? "", a.user.id, c.id).catch(() => null);
  if (url.searchParams.get("error")) return page(`error=denied&connector=${c.id}`);
  if (!st) return page(`error=state&connector=${c.id}`);
  const code = url.searchParams.get("code");
  if (!code || code.length > 2000) return page(`error=denied&connector=${c.id}`);

  try {
    const t = await exchangeCode(c, process.env, { code, redirectUri: `${origin}/api/connectors/${c.id}/callback`, codeVerifier: st.codeVerifier });
    await saveConnection(a.user.id, c.id, { creds: t.creds, accountLabel: t.accountLabel, scopes: t.scopes });
  } catch (e) {
    console.error(`[connectors] ${c.id} connect failed:`, redact(e instanceof Error ? e.message : String(e)).slice(0, 200));
    return page(`error=exchange&connector=${c.id}`);
  }
  await logActivity(a.db, a.user.id, { category: "connection", title: `Connected ${c.name}` });
  await resumeTasksFor(a.db, a.user.id, c);
  if (st.returnTo) return NextResponse.redirect(`${origin}${st.returnTo}`, { status: 303 });
  return page(`connected=${c.id}`);
}
