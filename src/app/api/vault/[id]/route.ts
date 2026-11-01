import { json, notFound, requireUser, unauthorized } from "@/lib/server/auth";
import { isUuid } from "@/lib/ids";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const { data } = await a.db.from("vault_secrets").delete().eq("id", params.id).eq("user_id", a.user.id).select("id");
  if (!data?.length) return notFound();
  return json({ ok: true });
}
