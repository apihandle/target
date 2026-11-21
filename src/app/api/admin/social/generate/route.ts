import { json, readJson } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { isDraftTone, SOCIAL_TOPIC_MAX } from "@/lib/socialConfig";
import { loadGeminiKey } from "@/lib/server/socialKeys";
import { generateSocialDraft } from "@/lib/server/socialDraft";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * "Draft with AI": write a post draft from a topic/brief with the caller's own stored Gemini key
 * (Settings-style per-user key, see lib/server/socialKeys.ts). Returns only the draft text; publishing is
 * a separate, confirmed action. 503 when no key is saved yet.
 */
export async function POST(req: Request) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const body = await readJson(req);
  if (!body) return json({ error: "Bad JSON" }, 400);
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) return json({ error: "Write a topic or brief first." }, 400);
  if (topic.length > SOCIAL_TOPIC_MAX) return json({ error: `Keep the brief under ${SOCIAL_TOPIC_MAX} characters.` }, 400);
  const tone = isDraftTone(body.tone) ? body.tone : "announcement";
  const key = await loadGeminiKey(a.db, a.user.id);
  if (!key) return json({ error: "Add your Gemini API key first — it's the field at the top of this page. TARGET stores it like any other provider key and only ever shows a masked preview." }, 503);
  const draft = await generateSocialDraft({ apiKey: key.apiKey, model: key.model, topic, tone });
  if (!draft.ok) return json({ error: draft.error }, 502);
  return json({ text: draft.text });
}
