import { badRequest, dbError, json, requireUser, unauthorized } from "@/lib/server/auth";
import { SESSION_COLS } from "@/lib/sessions";
import { UUID_RE } from "@/lib/server/worker";
import { logActivity } from "@/lib/server/activity";

export const dynamic = "force-dynamic";

/** The user's saved website sign-ins. Metadata only: cookie values never leave the server. */
export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  const { data, error } = await a.db.from("site_sessions").select(SESSION_COLS).eq("user_id", a.user.id).order("updated_at", { ascending: false }).limit(100);
  if (error) return dbError(error, "Could not load saved sign-ins");
  return json({ sessions: data ?? [] });
}

/** Sign out: ?id=<uuid> for one site, ?all=1 for every site. Deleting the row deletes its cookies. */
export async function DELETE(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const u = new URL(req.url);
  const id = u.searchParams.get("id");
  const all = u.searchParams.get("all") === "1";
  if (!all && !(id && UUID_RE.test(id))) return badRequest("Say which sign-in to remove");
  let q = a.db.from("site_sessions").delete().eq("user_id", a.user.id);
  if (!all && id) q = q.eq("id", id);
  const { data, error } = await q.select("domain");
  if (error) return dbError(error, "Could not sign out");
  const n = data?.length ?? 0;
  if (n) await logActivity(a.db, a.user.id, { category: "connection", title: all ? `Signed out of ${n} website${n === 1 ? "" : "s"}` : `Signed out of ${data![0].domain}` });
  return json({ ok: true, removed: n });
}
