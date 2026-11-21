import { json } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { auditFailure, auditFirst, readConfirmed } from "@/lib/server/adminWrite";
import {
  bloggerAccessToken, bloggerStatus, clearBloggerBlog, listBloggerBlogs, saveBloggerBlog,
} from "@/lib/server/socialBlogger";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The Blogger destination's settings for /admin/social (migration 0025). Connecting itself happens
 * through the standard connector flow (/api/connectors/blogger/connect — Google OAuth, tokens sealed in
 * `connections`); this route only handles what is social-specific:
 *   GET    — the caller's Blogger status plus their blogs (from the Blogger API) for the picker.
 *   POST   — choose which blog posts go to. The client sends only a blog id; the name/URL are taken
 *            from the API listing server-side, never trusted from the request. Confirm + audit first;
 *            the audit detail carries the blog id and name (public facts), never a token.
 *   DELETE — forget the chosen blog (the composer also calls this when disconnecting Blogger).
 */
export async function GET() {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const status = await bloggerStatus(a.db, a.user.id);
  if (!status.connected) return json({ status, blogs: [] });
  const t = await bloggerAccessToken(a.user.id);
  if (!t.ok) return json({ status, blogs: [], error: t.error });
  const list = await listBloggerBlogs(t.accessToken);
  if (!list.ok) return json({ status, blogs: [], error: list.error });
  return json({ status, blogs: list.blogs });
}

export async function POST(req: Request) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const c = await readConfirmed(req);
  if (c instanceof Response) return c;
  const blogId = typeof c.body.blogId === "string" ? c.body.blogId.trim() : "";
  if (!blogId) return json({ error: "Pick a blog first." }, 400);

  const t = await bloggerAccessToken(a.user.id);
  if (!t.ok) return json({ error: t.error }, 400);
  const list = await listBloggerBlogs(t.accessToken);
  if (!list.ok) return json({ error: list.error }, 502);
  const blog = list.blogs.find((b) => b.id === blogId);
  if (!blog) return json({ error: "That blog isn't on the connected Blogger account. Pick one from the list." }, 400);

  const entry = {
    action: "social.blogger.select",
    targetType: "social_blogger_settings",
    targetId: blog.id,
    detail: { blogId: blog.id, blogName: blog.name },
  };
  const blocked = await auditFirst(a, entry);
  if (blocked) return blocked;
  try {
    await saveBloggerBlog(a.db, a.user.id, blog);
  } catch {
    await auditFailure(a.db, a, entry, "save failed");
    return json({ error: "Could not save the blog choice. If this keeps happening, migration 0025 may not have run yet." }, 500);
  }
  return json({ status: await bloggerStatus(a.db, a.user.id) });
}

export async function DELETE(req: Request) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const c = await readConfirmed(req);
  if (c instanceof Response) return c;
  const entry = { action: "social.blogger.clear", targetType: "social_blogger_settings", targetId: a.user.id, detail: {} };
  const blocked = await auditFirst(a, entry);
  if (blocked) return blocked;
  try {
    await clearBloggerBlog(a.db, a.user.id);
  } catch {
    await auditFailure(a.db, a, entry, "clear failed");
    return json({ error: "Could not clear the blog choice." }, 500);
  }
  return json({ status: await bloggerStatus(a.db, a.user.id) });
}
