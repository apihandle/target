import { json, requireUser, unauthorized } from "@/lib/server/auth";
import { connectorViews } from "@/lib/connectors/registry";
import { listConnections } from "@/lib/connectors/store";

export const dynamic = "force-dynamic";

/** All connectors with this user's status for each. Never returns credentials. */
export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  let connections: Awaited<ReturnType<typeof listConnections>> = [];
  let warning: string | undefined;
  try { connections = await listConnections(a.db, a.user.id); }
  catch { warning = "Connection status couldn't load (apply migration 0007)."; }
  return json({ connectors: connectorViews(process.env, connections), ...(warning ? { warning } : {}) });
}
