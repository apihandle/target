import { dbError, json, notFound, requireUser, unauthorized } from "@/lib/server/auth";
import { isUuid } from "@/lib/ids";
import { hashShareToken, newShareToken, sharePath } from "@/lib/shares";
import { checkLimit, LIMITS, tooMany } from "@/lib/connectors/rateLimit";
import { logActivity } from "@/lib/server/activity";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

async function ownedConversation(db: NonNullable<Awaited<ReturnType<typeof requireUser>>>["db"], userId: string, id: string) {
  if (!isUuid(id)) return null;
  const { data } = await db.from("conversations").select("id, title").eq("id", id).eq("user_id", userId).maybeSingle();
  return data as { id: string; title: string } | null;
}

/** Active share links for one of the user's chats (the tokens themselves are never stored or returned again). */
export async function GET(_req: Request, { params }: Ctx) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!(await ownedConversation(a.db, a.user.id, params.id))) return notFound();
  const { data, error } = await a.db.from("conversation_shares").select("id, created_at, revoked_at").eq("conversation_id", params.id).eq("user_id", a.user.id).order("created_at", { ascending: false }).limit(20);
  if (error) return dbError(error, "Could not load share links");
  return json({ shares: ((data ?? []) as { id: string; created_at: string; revoked_at: string | null }[]).filter((s) => !s.revoked_at).map(({ id, created_at }) => ({ id, created_at })) });
}

/** Create a read-only public link. The full link is returned once, in this response only. */
export async function POST(_req: Request, { params }: Ctx) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const conv = await ownedConversation(a.db, a.user.id, params.id);
  if (!conv) return notFound();
  if (!(await checkLimit(LIMITS.share(a.user.id)))) return tooMany();
  const token = newShareToken();
  const { data, error } = await a.db.from("conversation_shares").insert({ user_id: a.user.id, conversation_id: conv.id, token_hash: hashShareToken(token) }).select("id, created_at").single();
  if (error || !data) return dbError(error, "Could not create a share link");
  await logActivity(a.db, a.user.id, { category: "outcome", title: `Shared chat “${conv.title}”`, detail: "Anyone with the link can read this chat until you revoke it." });
  return json({ share: data, path: sharePath(token) }, 201);
}
