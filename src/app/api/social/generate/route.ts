import { json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { serviceDb } from "@/lib/server/serviceDb";
import { isDraftTone, SOCIAL_TOPIC_MAX } from "@/lib/socialConfig";
import { loadSocialWriterKey } from "@/lib/server/socialKeys";
import { generateSocialDraft } from "@/lib/server/socialDraft";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * "Draft with AI" for the /app/social composer — the user-level twin of /api/admin/social/generate.
 * The draft is written with the CALLER's own stored writer key (their NVIDIA key when saved, else
 * their Gemini key — never another user's, never an env key); publishing stays a separate,
 * confirmed action in the composer.
 */
export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  if (!body) return json({ error: "Bad JSON" }, 400);
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) return json({ error: "Write a topic or brief first." }, 400);
  if (topic.length > SOCIAL_TOPIC_MAX) return json({ error: `Keep the brief under ${SOCIAL_TOPIC_MAX} characters.` }, 400);
  const tone = isDraftTone(body.tone) ? body.tone : "announcement";
  const key = await loadSocialWriterKey(serviceDb(a.db), a.user.id);
  if (!key) return json({ error: "Add your NVIDIA API key first — there's a card for it on the Connectors page (a Gemini key works too). TARGET stores it like any other provider key and only ever shows a masked preview." }, 503);
  const draft = await generateSocialDraft({ provider: key.provider, apiKey: key.apiKey, model: key.model, topic, tone });
  if (!draft.ok) return json({ error: draft.error }, 502);
  return json({ text: draft.text });
}
