import { json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import {
  bloggerAccessToken, bloggerStatus, clearBloggerBlog, listBloggerBlogs, saveBloggerBlog,
} from "@/lib/server/socialBlogger";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The signed-in user's own Blogger destination settings, for the blog picker on /app/connectors.
 * This is the user-level twin of /api/admin/social/blogger: connecting itself happens through the
 * standard connector flow (/api/connectors/blogger/connect — Google OAuth, tokens sealed per user in
 * `connections`); this route only handles which of the user's blogs social posts go to.
 *   GET    — the caller's Blogger status plus their blogs (from the Blogger API) for the picker.
 *   POST   — choose the blog. The client sends only a blog id; the name/URL are taken from the API
 *            listing server-side, never trusted from the request.
 *   DELETE — forget the chosen blog.
 * Everything is scoped to the caller's own user id: one user can never see or change another's choice.
 */
export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  const status = await bloggerStatus(a.db, a.user.id);
  if (!status.connected) return json({ status, blogs: [] });
  const t = await bloggerAccessToken(a.user.id);
  if (!t.ok) return json({ status, blogs: [], error: t.error });
  const list = await listBloggerBlogs(t.accessToken);
  if (!list.ok) return json({ status, blogs: [], error: list.error });
  return json({ status, blogs: list.blogs });
}

export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  const blogId = typeof body?.blogId === "string" ? body.blogId.trim() : "";
  if (!blogId) return json({ error: "Pick a blog first." }, 400);

  const t = await bloggerAccessToken(a.user.id);
  if (!t.ok) return json({ error: t.error }, 400);
  const list = await listBloggerBlogs(t.accessToken);
  if (!list.ok) return json({ error: list.error }, 502);
  const blog = list.blogs.find((b) => b.id === blogId);
  if (!blog) return json({ error: "That blog isn't on your connected Blogger account. Pick one from the list." }, 400);

  try {
    await saveBloggerBlog(a.db, a.user.id, blog);
  } catch {
    return json({ error: "Could not save the blog choice. If this keeps happening, migration 0025 may not have run yet." }, 500);
  }
  return json({ status: await bloggerStatus(a.db, a.user.id) });
}

export async function DELETE() {
  const a = await requireUser();
  if (!a) return unauthorized();
  try {
    await clearBloggerBlog(a.db, a.user.id);
  } catch {
    return json({ error: "Could not clear the blog choice." }, 500);
  }
  return json({ status: await bloggerStatus(a.db, a.user.id) });
}
