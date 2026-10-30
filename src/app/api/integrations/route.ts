import { dbError, json, requireUser, unauthorized } from "@/lib/server/auth";
import { integrationViews } from "@/lib/integrations/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  const { data, error } = await a.db.from("connections").select("provider, account_label, connected_at").eq("user_id", a.user.id);
  if (error) return dbError(error, "Could not load connections");
  return json({ integrations: integrationViews(process.env, data ?? []) });
}
