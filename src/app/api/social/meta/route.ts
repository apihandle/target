import { json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import {
  clearMetaPageChoice, listMetaPages, metaAccessToken, metaPagePublic, metaStatus, saveMetaPageChoice,
} from "@/lib/server/socialMeta";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The signed-in user's own Meta destination settings, for the Page picker on /app/connectors.
 * This is the user-level twin pattern of /api/social/blogger: connecting itself happens through
 * Facebook Login (/api/connectors/meta/start — tokens sealed per user in `connections` under the
 * provider id "meta"); this route only handles which of the user's Pages social posts go to.
 *   GET    — the caller's Meta status plus their Pages (from the Graph API) for the picker. Page
 *            access tokens are never included in the response.
 *   POST   — choose the Page. The client sends only a Page id; the name, the Page access token and
 *            the linked Instagram account are taken from the API listing server-side.
 *   DELETE — forget the chosen Page (the connection itself stays).
 * Everything is scoped to the caller's own user id: one user can never see or change another's pick.
 */
export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  const status = await metaStatus(a.db, a.user.id);
  if (!status.connected) return json({ status, pages: [] });
  const t = await metaAccessToken(a.user.id);
  if (!t.ok) return json({ status, pages: [], error: t.error });
  const list = await listMetaPages(t.accessToken);
  if (!list.ok) return json({ status, pages: [], error: list.error });
  return json({ status, pages: list.pages.map(metaPagePublic) });
}

export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  const pageId = typeof body?.pageId === "string" ? body.pageId.trim() : "";
  if (!pageId) return json({ error: "Pick a Page first." }, 400);

  const t = await metaAccessToken(a.user.id);
  if (!t.ok) return json({ error: t.error }, 400);
  const list = await listMetaPages(t.accessToken);
  if (!list.ok) return json({ error: list.error }, 502);
  const page = list.pages.find((p) => p.id === pageId);
  if (!page) return json({ error: "That Page isn't on your connected Facebook account. Pick one from the list." }, 400);

  try {
    await saveMetaPageChoice(a.user.id, page);
  } catch {
    return json({ error: "Could not save the Page choice." }, 500);
  }
  return json({ status: await metaStatus(a.db, a.user.id) });
}

export async function DELETE() {
  const a = await requireUser();
  if (!a) return unauthorized();
  try {
    await clearMetaPageChoice(a.user.id);
  } catch {
    return json({ error: "Could not clear the Page choice." }, 500);
  }
  return json({ status: await metaStatus(a.db, a.user.id) });
}
