import { json, notFound, requireUser, unauthorized, type Db } from "@/lib/server/auth";
import { ATTACHMENT_BUCKET } from "@/lib/attachments";
import { isUuid } from "@/lib/ids";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Download a file TARGET made for you: owner only, via a 60-second signed link. */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await requireUser();
  if (!a) return Response.redirect(new URL(`/login?next=/api/files/${encodeURIComponent(params.id)}`, process.env.NEXT_PUBLIC_SITE_URL || "https://gettarget.vercel.app"), 302);
  if (!isUuid(params.id)) return notFound();
  const { data: row } = await a.db.from("generated_files").select("name, storage_path").eq("id", params.id).eq("user_id", a.user.id).maybeSingle();
  if (!row) return notFound();
  let store: Db = a.db;
  try { store = createAdminClient() as unknown as Db; } catch { /* user client */ }
  const { data } = await store.storage.from(ATTACHMENT_BUCKET).createSignedUrl(row.storage_path as string, 60, { download: row.name as string });
  if (!data?.signedUrl) return json({ error: "File is not available" }, 404);
  return new Response(null, { status: 302, headers: { Location: data.signedUrl, "Cache-Control": "no-store" } });
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const { data } = await a.db.from("generated_files").delete().eq("id", params.id).eq("user_id", a.user.id).select("storage_path");
  if (!data?.length) return notFound();
  try { await (createAdminClient() as unknown as Db).storage.from(ATTACHMENT_BUCKET).remove([data[0].storage_path as string]); } catch { /* row is gone */ }
  return json({ ok: true });
}
