import { json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { apiKeyProblem } from "@/lib/socialConfig";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * "Test key" for the Gemini card on /app/connectors: checks a pasted key against Google's models
 * endpoint (the key travels only in the x-goog-api-key header, like every Gemini call in this
 * codebase) and reports whether Google accepts it. Nothing is saved — saving is the separate
 * POST /api/social/key, so a user can verify a key before deciding to store it.
 */
export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  if (!body) return json({ error: "Bad JSON" }, 400);
  const problem = apiKeyProblem(body.apiKey);
  if (problem) return json({ error: problem }, 400);
  const apiKey = String(body.apiKey).trim();
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    });
    if (r.status === 401 || r.status === 403) {
      return json({ error: "Google rejected that key. Check it in AI Studio and paste it again." }, 400);
    }
    if (!r.ok) return json({ error: `Google returned an error (HTTP ${r.status}). Try again in a moment.` }, 502);
    return json({ ok: true });
  } catch {
    return json({ error: "Couldn't reach Google. Try again in a moment." }, 502);
  }
}
