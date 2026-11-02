import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_HEADERS } from "@/lib/builtins/round2";

export const dynamic = "force-dynamic";

/**
 * A custom website the owner published with TARGET. Served with a CSP sandbox (no allow-same-origin),
 * so the page runs in an opaque origin: its scripts can never read TARGET's cookies or call its APIs.
 */
export async function GET(_req: Request, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  if (!/^[a-z0-9-]{6,80}$/.test(params.slug)) return notFound();
  try {
    const db = createAdminClient();
    const { data } = await db.from("pages").select("html, format").eq("slug", params.slug).eq("published", true).maybeSingle();
    if (!data || data.format !== "html" || !data.html) return notFound();
    return new Response(data.html as string, { headers: SITE_HEADERS });
  } catch { return notFound(); }
}
