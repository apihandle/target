import { dbError, json, requireUser, unauthorized } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  const { data, error } = await a.db.from("pages").select("id, slug, title, published, created_at").eq("user_id", a.user.id).order("created_at", { ascending: false }).limit(100);
  if (error) return dbError(error, "Could not load Pages");
  return json({ pages: data ?? [] });
}
