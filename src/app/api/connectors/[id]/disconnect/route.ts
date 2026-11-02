import { json, notFound, requireUser, unauthorized } from "@/lib/server/auth";
import { CONNECTOR_ID, getConnector } from "@/lib/connectors/registry";
import { removeConnection } from "@/lib/connectors/store";
import { checkLimit, LIMITS, tooMany } from "@/lib/connectors/rateLimit";
import { logActivity } from "@/lib/server/activity";
import { deleteSiteSessions } from "@/lib/server/siteSessions";

export const dynamic = "force-dynamic";

/** Revoke the token at the provider where possible, then delete the user's own connection row. */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await requireUser();
  if (!a) return unauthorized();
  const c = CONNECTOR_ID.test(params.id) ? getConnector(params.id) : undefined;
  if (!c) return notFound();
  if (!(await checkLimit(LIMITS.connect(a.user.id)))) return tooMany();
  let removed = false;
  let signedOut = 0;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Unlinking Google also signs TARGET out of every website it joined with that Gmail.
    if (c.id === "google") {
      const { data: row } = await a.db.from("connections").select("account_label").eq("user_id", a.user.id).eq("connector_id", "google").maybeSingle();
      const email = String(row?.account_label ?? "");
      if (email.includes("@")) { try { signedOut = await deleteSiteSessions(a.user.id, { viaGoogleEmail: email }); } catch { /* best effort */ } }
    }
    try { removed = await removeConnection(a.user.id, c); } catch { return json({ error: "Couldn't disconnect. Try again." }, 500); }
  } else {
    // Without the service role the server can't read credentials to revoke them; remove the user's own row (RLS).
    const { data } = await a.db.from("connections").delete().eq("user_id", a.user.id).eq("connector_id", c.id).select("id");
    removed = !!data?.length;
  }
  if (!removed) return notFound();
  await logActivity(a.db, a.user.id, { category: "connection", title: `Disconnected ${c.name}`, detail: signedOut ? `Also signed out of ${signedOut} website${signedOut === 1 ? "" : "s"} joined with this account.` : undefined });
  return json({ ok: true, signedOutSites: signedOut });
}
