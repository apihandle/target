import { json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { serviceDb } from "@/lib/server/serviceDb";
import { autopilotProblem, autopilotSettings, saveAutopilotSettings } from "@/lib/server/socialAutopilot";

export const dynamic = "force-dynamic";

/**
 * The caller's Blogger autopilot settings, backing the autopilot card on /app/social: an on/off
 * switch plus the topic the automatic posts are written about. The blog choice and the Gemini key
 * autopilot depends on have their own routes (/api/social/blogger, /api/social/key) — this route
 * only stores the switch and the topic (migration 0026). Writes go through the service-role client
 * because the migration grants `authenticated` no INSERT/UPDATE on social_autopilot_settings; every
 * query is scoped to the caller's own user id, so one user can never see or change another's row.
 *   GET  — the caller's settings ({ enabled: false, topic: "" } when never saved).
 *   POST — save { enabled, topic }. Turning it on requires a topic.
 */
export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  return json({ autopilot: await autopilotSettings(serviceDb(a.db), a.user.id) });
}

export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  if (!body) return json({ error: "Bad JSON" }, 400);
  const input = {
    enabled: body.enabled === true,
    topic: typeof body.topic === "string" ? body.topic : "",
  };
  const problem = autopilotProblem(input);
  if (problem) return json({ error: problem }, 400);
  try {
    const saved = await saveAutopilotSettings(serviceDb(a.db), a.user.id, input);
    return json({ autopilot: saved });
  } catch {
    return json({ error: "Could not save the autopilot settings. If this keeps happening, migration 0026 may not have run yet." }, 500);
  }
}
