import { json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { apiKeyProblem, isSocialAiProvider, NVIDIA_API_BASE, type SocialAiProvider } from "@/lib/socialConfig";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * "Test key" for the AI key cards on /app/connectors: checks a pasted key against the provider
 * (Gemini's models endpoint with the key in the x-goog-api-key header; NVIDIA's models endpoint
 * with the key as a Bearer token — the same headers the real calls use) and reports whether the
 * provider accepts it. The service comes from the body's `provider` field (default "gemini", the
 * original card's contract). Nothing is saved — saving is the separate POST /api/social/key, so a
 * user can verify a key before deciding to store it.
 */
export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  if (!body) return json({ error: "Bad JSON" }, 400);
  const problem = apiKeyProblem(body.apiKey);
  if (problem) return json({ error: problem }, 400);
  const apiKey = String(body.apiKey).trim();
  const provider: SocialAiProvider = isSocialAiProvider(body.provider) ? body.provider : "gemini";
  try {
    const r = provider === "nvidia"
      ? await fetch(`${NVIDIA_API_BASE}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(20000),
          cache: "no-store",
        })
      : await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
          headers: { "x-goog-api-key": apiKey },
          signal: AbortSignal.timeout(20000),
          cache: "no-store",
        });
    if (r.status === 401 || r.status === 403) {
      return json({
        error: provider === "nvidia"
          ? "NVIDIA rejected that key. Check it at build.nvidia.com and paste it again."
          : "Google rejected that key. Check it in AI Studio and paste it again.",
      }, 400);
    }
    if (!r.ok) return json({ error: `${provider === "nvidia" ? "NVIDIA" : "Google"} returned an error (HTTP ${r.status}). Try again in a moment.` }, 502);
    return json({ ok: true });
  } catch {
    return json({ error: `Couldn't reach ${provider === "nvidia" ? "NVIDIA" : "Google"}. Try again in a moment.` }, 502);
  }
}
