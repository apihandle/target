import { json } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { auditFirst } from "@/lib/server/adminWrite";
import { allUsers, isBanned } from "@/lib/server/adminData";
import { toCsv } from "@/lib/adminConfig";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Message counts for the export, 10 at a time; past 2000 users the column is left empty to stay within the time limit. */
async function messageCounts(db: NonNullable<Awaited<ReturnType<typeof requireAdmin>>>["db"], ids: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const todo = ids.slice(0, 2000);
  for (let i = 0; i < todo.length; i += 10) {
    await Promise.all(todo.slice(i, i + 10).map(async (id) => {
      const { count, error } = await db.from("messages").select("id", { count: "exact", head: true }).eq("user_id", id);
      out.set(id, error ? null : count ?? 0);
    }));
  }
  return out;
}

/** CSV of users (optionally filtered by ?q=). Recorded in the audit log. */
export async function GET(req: Request) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 100);
  let users;
  try { users = (await allUsers(a.db)).users; } catch { return json({ error: "Could not list users" }, 502); }
  const rows = (q ? users.filter((u) => u.email.toLowerCase().includes(q) || u.id === q) : users).sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
  const blocked = await auditFirst(a, { action: "export.users", targetType: "export", targetId: "users", detail: { rows: rows.length, q } });
  if (blocked) return blocked;
  const counts = await messageCounts(a.db, rows.map((u) => u.id));
  const csv = toCsv(["id", "email", "created_at", "last_sign_in_at", "disabled", "sign_in_method", "messages"],
    rows.map((u) => [u.id, u.email, u.created_at, u.last_sign_in_at ?? "", isBanned(u) ? "yes" : "no", u.provider, counts.get(u.id) ?? ""]));
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="target-users-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}
