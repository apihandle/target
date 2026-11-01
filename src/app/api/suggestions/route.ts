import { json, requireUser, unauthorized } from "@/lib/server/auth";
import { SUGGESTION_COLS } from "@/lib/server/proactive";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  const { data, error } = await a.db.from("suggestions").select(SUGGESTION_COLS).eq("user_id", a.user.id).eq("status", "open").order("created_at", { ascending: false }).limit(8);
  return json({ suggestions: error ? [] : data ?? [] });
}
