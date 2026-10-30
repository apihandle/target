import { json, notFound, requireUser, unauthorized } from "@/lib/server/auth";
import { CONNECTOR_ID, getConnector } from "@/lib/connectors/registry";
import { removeConnection } from "@/lib/connectors/store";
import { checkLimit, LIMITS, tooMany } from "@/lib/connectors/rateLimit";
import { logActivity } from "@/lib/server/activity";

export const dynamic = "force-dynamic";

/** Revoke the token at the provider where possible, then delete the user's own connection row. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const c = CONNECTOR_ID.test(params.id) ? getConnector(params.id) : undefined;
  if (!c) return notFound();
  if (!(await checkLimit(LIMITS.connect(a.user.id)))) return tooMany();
  let removed = false;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try { removed = await removeConnection(a.user.id, c); } catch { return json({ error: "Couldn't disconnect. Try again." }, 500); }
  } else {
    // Without the service role the server can't read credentials to revoke them; remove the user's own row (RLS).
    const { data } = await a.db.from("connections").delete().eq("user_id", a.user.id).eq("connector_id", c.id).select("id");
    removed = !!data?.length;
  }
  if (!removed) return notFound();
  await logActivity(a.db, a.user.id, { category: "connection", title: `Disconnected ${c.name}` });
  return json({ ok: true });
}
