import { badRequest, json, requireUser, unauthorized, type Db } from "@/lib/server/auth";
import { cleanQuery, likePattern, mergeHits } from "@/lib/chatSearch";

export const dynamic = "force-dynamic";

type ConvRow = { id: string; title: string; pinned?: boolean | null };

/** Select conversations with the pinned flag, falling back to the pre-0008 columns if needed. */
async function convs(db: Db, build: (cols: string) => PromiseLike<{ data: unknown; error: unknown }>): Promise<ConvRow[]> {
  const r = await build("id, title, pinned");
  if (!r.error) return (r.data ?? []) as ConvRow[];
  const r2 = await build("id, title");
  return (r2.data ?? []) as ConvRow[];
}

/** GET /api/conversations/search?q=… : the signed-in user's chats whose title or messages contain q. */
export async function GET(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const q = cleanQuery(new URL(req.url).searchParams.get("q"));
  if (!q) return badRequest("Type at least 2 characters");
  const pattern = likePattern(q);
  const uid = a.user.id;

  const titleRows = await convs(a.db, (cols) => a.db.from("conversations").select(cols).eq("user_id", uid).ilike("title", pattern).order("updated_at", { ascending: false }).limit(20));
  const { data: msgData } = await a.db.from("messages").select("conversation_id, content").eq("user_id", uid).ilike("content", pattern).order("created_at", { ascending: false }).limit(60);
  const messageRows = (msgData ?? []) as { conversation_id: string; content: string }[];

  const missing = Array.from(new Set(messageRows.map((m) => m.conversation_id))).filter((id) => !titleRows.some((t) => t.id === id)).slice(0, 30);
  const extra = missing.length ? await convs(a.db, (cols) => a.db.from("conversations").select(cols).eq("user_id", uid).in("id", missing)) : [];
  const titles = new Map(extra.map((c) => [c.id, { title: c.title, pinned: c.pinned }]));
  return json({ results: mergeHits(titleRows, messageRows, titles, q) });
}
