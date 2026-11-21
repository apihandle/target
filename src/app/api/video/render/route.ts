import { badRequest, dbError, json, notFound, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { resolvesPublic } from "@/lib/server/safeFetch";
import { UUID_RE } from "@/lib/server/worker";
import {
  buildRenderCode, parseVideoSlides, renderStatus, videoSpec,
  VIDEO_FONT_INPUT, VIDEO_FONT_URL, VIDEO_RENDER_GOAL,
} from "@/lib/server/videoRender";

export const dynamic = "force-dynamic";

/**
 * Video Maker renders (see lib/server/videoRender.ts for the full design). A render is one
 * browser_jobs code job on the compute worker — the same queue the chat's run_code tool uses —
 * so it needs the compute worker running, exactly like code runs do.
 *   POST — validate { slides: [{ url, caption }] } (3–6 public https images), run the DNS-level
 *          SSRF check the custom-provider routes use (resolvesPublic), then queue the job with
 *          the fixed render program; the images and the bundled caption font are its inputs.
 *          Answers { job_id, status: "queued" }.
 *   GET ?id= — the caller's own job only: { status } while it renders, { status: "done", video }
 *          with the private /api/files/ download once the worker has stored it, or the failure.
 * Rows are read and written with the caller's own client, so RLS scopes everything to them.
 */
export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  if (!body) return badRequest("Bad JSON");
  const parsed = parseVideoSlides(body);
  if ("error" in parsed) return badRequest(parsed.error);
  for (const s of parsed.slides) {
    if (!(await resolvesPublic(new URL(s.url).hostname))) {
      return badRequest("One of the image hosts could not be verified as a public address");
    }
  }
  const spec = videoSpec(parsed.slides);
  const inputs = [
    ...spec.slides.map((s, i) => ({ name: s.file, url: parsed.slides[i].url })),
    { name: VIDEO_FONT_INPUT, url: VIDEO_FONT_URL },
  ];
  const { data, error } = await a.db.from("browser_jobs").insert({
    user_id: a.user.id, mode: "code", goal: VIDEO_RENDER_GOAL, language: "python",
    code: buildRenderCode(spec), inputs, status: "queued", conversation_id: null,
  }).select("id").single();
  if (error || !data) return dbError(error, "Could not start the render");
  return json({ job_id: data.id as string, status: "queued" });
}

export async function GET(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!UUID_RE.test(id)) return badRequest("id required");
  const { data } = await a.db.from("browser_jobs")
    .select("id, status, error, files, goal")
    .eq("id", id).eq("user_id", a.user.id).maybeSingle();
  if (!data || data.goal !== VIDEO_RENDER_GOAL) return notFound();
  return json(renderStatus(data as { status: string; error?: unknown; files?: unknown }));
}
