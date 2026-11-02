import { json } from "@/lib/server/auth";
import { reportError } from "@/lib/server/errors";
import { hitMemory } from "@/lib/connectors/rateLimit";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Browser error reports (from the error boundaries and window.onerror). Small, rate-limited, never echoed back. */
export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "anon";
  if (!hitMemory({ key: `err:${ip}`, limit: 10, windowSec: 60 })) return json({ ok: true }, 202);
  const raw = await req.text();
  if (raw.length > 8000) return json({ error: "Too large" }, 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return json({ error: "Bad JSON" }, 400); }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return json({ error: "Missing message" }, 400);
  let userId: string | null = null;
  try { userId = (await (await createClient()).auth.getUser()).data.user?.id ?? null; } catch { /* signed out */ }
  await reportError({ source: "client", message, stack: typeof body.stack === "string" ? body.stack : null, url: typeof body.url === "string" ? body.url : null, userId });
  return json({ ok: true }, 202);
}
