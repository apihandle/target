import { badRequest, json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/server/errors";
import { isUuid } from "@/lib/ids";
import { isHttpsUrl } from "@/lib/work";

export const dynamic = "force-dynamic";

/** Owner-only management of the Work page's ad links. */
async function owner() {
  const a = await requireUser();
  if (!a) return { res: unauthorized() } as const;
  if (!isAdminEmail(a.user.email)) return { res: json({ error: "Only the site owner can manage work links" }, 403) } as const;
  try { return { db: createAdminClient() } as const; } catch { return { res: json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" }, 503) } as const; }
}

function clean(body: Record<string, unknown>) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const coins = Number(body.coins ?? 1);
  if (!title || title.length > 80) return "Title must be 1-80 characters";
  if (!isHttpsUrl(body.url)) return "Link must start with https://";
  if (!Number.isInteger(coins) || coins < 1 || coins > 1000) return "Coins must be a whole number from 1 to 1000";
  return { title, url: body.url as string, coins };
}

export async function GET() {
  const o = await owner();
  if ("res" in o) return o.res;
  const { data, error } = await o.db.from("work_links").select("id, title, url, coins, active, sort, created_at").order("sort").order("created_at").limit(200);
  if (error) return json({ error: "Could not load links. Has migration 0010 run?" }, 500);
  return json({ links: data });
}

export async function POST(req: Request) {
  const o = await owner();
  if ("res" in o) return o.res;
  const body = await readJson(req);
  if (!body) return badRequest("Bad JSON");
  const v = clean(body);
  if (typeof v === "string") return badRequest(v);
  const { data, error } = await o.db.from("work_links").insert(v).select("id, title, url, coins, active, sort, created_at").single();
  if (error) return json({ error: "Could not add the link" }, 500);
  return json({ link: data });
}

export async function PATCH(req: Request) {
  const o = await owner();
  if ("res" in o) return o.res;
  const body = await readJson(req);
  if (!body || typeof body.id !== "string" || !isUuid(body.id)) return badRequest("Invalid link");
  const patch: Record<string, unknown> = {};
  if (typeof body.active === "boolean") patch.active = body.active;
  if (body.title !== undefined || body.url !== undefined || body.coins !== undefined) {
    const v = clean(body);
    if (typeof v === "string") return badRequest(v);
    Object.assign(patch, v);
  }
  const { error } = await o.db.from("work_links").update(patch).eq("id", body.id);
  if (error) return json({ error: "Could not update the link" }, 500);
  return json({ ok: true });
}

export async function DELETE(req: Request) {
  const o = await owner();
  if ("res" in o) return o.res;
  const body = await readJson(req);
  if (!body || typeof body.id !== "string" || !isUuid(body.id)) return badRequest("Invalid link");
  const { error } = await o.db.from("work_links").delete().eq("id", body.id);
  if (error) return json({ error: "Could not delete the link" }, 500);
  return json({ ok: true });
}
