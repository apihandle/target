import { json, notFound, requireUser, unauthorized } from "@/lib/server/auth";
import { getIntegration, isConfigured } from "@/lib/integrations/registry";
import { logActivity } from "@/lib/server/activity";

export const dynamic = "force-dynamic";

/** Disconnect: revoke at the provider (best effort) and delete stored tokens. */
export async function DELETE(_req: Request, { params }: { params: { provider: string } }) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const i = getIntegration(params.provider);
  if (!i || i.kind !== "oauth") return notFound();
  if (!isConfigured(i, process.env)) {
    // Without the service role we can still remove the visible row the user owns.
    const { data } = await a.db.from("connections").delete().eq("user_id", a.user.id).eq("provider", i.id).select("id");
    if (!data?.length) return notFound();
  } else {
    const { removeConnection } = await import("@/lib/integrations/store");
    if (!(await removeConnection(a.user.id, i.id))) return notFound();
  }
  await logActivity(a.db, a.user.id, { category: "connection", title: `Disconnected ${i.name}` });
  return json({ ok: true });
}
