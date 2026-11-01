import { dbError, json, requireUser, unauthorized } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  const { data, error } = await a.db.from("generated_files").select("id, name, mime, size_bytes, created_at").eq("user_id", a.user.id).order("created_at", { ascending: false }).limit(100);
  if (error) return dbError(error, "Could not load files");
  return json({ files: data ?? [] });
}
