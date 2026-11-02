import { badRequest, json, notFound, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { isUuid } from "@/lib/ids";

export const dynamic = "force-dynamic";

/** Dismiss a "For you" card, or mark it done after the user acted on it. */
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const b = await readJson(req);
  if (b?.status !== "dismissed" && b?.status !== "done") return badRequest("status must be dismissed or done");
  const { data } = await a.db.from("suggestions").update({ status: b.status }).eq("id", params.id).eq("user_id", a.user.id).select("id");
  if (!data?.length) return notFound();
  return json({ ok: true });
}
