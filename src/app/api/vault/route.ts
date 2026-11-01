import { badRequest, dbError, json, readJson, requireUser, unauthorized, type Db } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_VAULT_ITEMS, sealVault, vaultInput } from "@/lib/builtins/vault";
import { hasEncryptionKey } from "@/lib/connectors/crypto";
import { checkLimit } from "@/lib/connectors/rateLimit";

export const dynamic = "force-dynamic";
const LIST = "id, kind, label, site, preview, last_used_at, created_at";

/** List vault items: names and previews only. Secret values never leave the server. */
export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  const { data, error } = await a.db.from("vault_secrets").select(LIST).eq("user_id", a.user.id).order("created_at", { ascending: false });
  if (error) return dbError(error, "Could not load your vault");
  return json({ items: data ?? [] });
}

export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!hasEncryptionKey()) return json({ error: "The vault isn't set up on this server yet (encryption key missing)." }, 503);
  if (!(await checkLimit({ key: `vault:${a.user.id}`, limit: 20, windowSec: 600 }))) return json({ error: "Too many changes. Try again in a few minutes." }, 429);
  const b = await readJson(req);
  if (!b) return badRequest("Bad JSON");
  const v = vaultInput.safeParse(b);
  if (!v.success) return json({ error: v.error.issues[0]?.message ?? "Check the details", field: String(v.error.issues[0]?.path[0] ?? "") }, 400);
  let db: Db;
  try { db = createAdminClient() as unknown as Db; } catch { return json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" }, 503); }
  const { count } = await db.from("vault_secrets").select("id", { count: "exact", head: true }).eq("user_id", a.user.id);
  if ((count ?? 0) >= MAX_VAULT_ITEMS) return badRequest(`You can keep up to ${MAX_VAULT_ITEMS} items. Delete one first.`);
  const sealed = sealVault(a.user.id, v.data);
  const { data, error } = await db.from("vault_secrets").insert({ user_id: a.user.id, kind: v.data.kind, label: v.data.label, ...sealed }).select(LIST).single();
  if (error || !data) return dbError(error, "Could not save to your vault");
  return json({ item: data }, 201);
}
