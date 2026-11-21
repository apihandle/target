import { isBlockedHostname } from "@/lib/customProvider";
import { SITE } from "@/lib/builtins/helpers";
import { VIDEO_CAPTION_MAX, VIDEO_MAX_SLIDES, VIDEO_MIN_SLIDES } from "@/lib/videoRenderShared";

export { VIDEO_CAPTION_MAX, VIDEO_MAX_SLIDES, VIDEO_MIN_SLIDES };

/**
 * Video Maker: a template slideshow rendered entirely inside TARGET — no outside video service.
 *
 * How a render runs (the same machinery as the run_code sandbox, round2.ts):
 *   1. POST /api/video/render validates the slides and queues ONE browser_jobs row (mode "code",
 *      language "python") whose program is the fixed template from buildRenderCode below — the
 *      user never supplies code; their captions and image file names reach the program only as a
 *      JSON literal, and the images themselves arrive as ordinary job inputs the compute worker
 *      downloads (each capped at 10 MB by the worker, private hosts refused by its safeUrl).
 *   2. The compute worker (worker/compute-worker.mjs, polls every 5 s) runs the program in its
 *      sandbox: 60 s wall clock, 60 CPU-seconds, 1 GB. The program builds the ffmpeg command as an
 *      argument list (never a shell) and writes out/video.mp4.
 *   3. The worker returns out/ files (max 8 MB each) to /api/compute/worker, which stores them via
 *      storeJobFiles as private downloads (/api/files/<id>) and lands them on the job row, where
 *      GET /api/video/render?id= picks the .mp4 up.
 *
 * The render itself: each image is cover-scaled to 1440x2560 and Ken-Burns zoomed (alternating
 * in/out) at 720x1280 / 24 fps for 3 s, its caption burned in at the bottom from a TEXT FILE
 * (drawtext textfile=, so caption text is never parsed as filter syntax), slides joined with
 * 0.5 s crossfades, then one lanczos upscale to 1080x1920 and a libx264 encode whose maxrate
 * keeps even the 6-slide worst case (~15.5 s) near 6 MB — under the worker's 8 MB file cap.
 * Worst case measured on a shared-CPU VM: ~16 s wall / ~22 CPU-s of the 60 s budgets.
 * There is no music bed in the repo, so renders are silent by design.
 *
 * The caption font is an input too: the worker image ships no fonts, so the route passes the
 * site's own bundled DejaVu Sans Bold (public/fonts/) as the last input.
 */

/** browser_jobs.goal marker, so the status route only ever reports Video Maker jobs. */
export const VIDEO_RENDER_GOAL = "Video Maker render";
export const VIDEO_FONT_INPUT = "font.ttf";
export const VIDEO_FONT_URL = `${SITE}/fonts/DejaVuSans-Bold.ttf`;
/** The worker refuses input downloads over 10 MB; mirrored here for the program's own check. */
export const VIDEO_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export type VideoSlideInput = { url: string; caption: string };
/** What the render program sees: local input file names + captions (never URLs). */
export type VideoSpec = { slides: { file: string; caption: string }[] };

/**
 * Caption characters that must never reach the render: control characters (incl. newlines),
 * backslash, and "%" — drawtext expands %{} sequences even in textfile content, so a percent
 * sign is the one printable character that could turn caption text into filter behaviour.
 * Everything else travels as data: a JSON literal into the program, a plain text file into
 * drawtext, and ffmpeg is always invoked as an argv list with no shell anywhere.
 */
const CAPTION_FORBIDDEN = /[%\\\u0000-\u001f\u007f]/;

export function parseVideoSlides(body: unknown): { slides: VideoSlideInput[] } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Expected a JSON object" };
  const raw = (body as Record<string, unknown>).slides;
  if (!Array.isArray(raw)) return { error: "Add your slides first" };
  if (raw.length < VIDEO_MIN_SLIDES) return { error: `Add at least ${VIDEO_MIN_SLIDES} images` };
  if (raw.length > VIDEO_MAX_SLIDES) return { error: `At most ${VIDEO_MAX_SLIDES} images per video` };
  const slides: VideoSlideInput[] = [];
  for (const [i, r] of raw.entries()) {
    const at = `Slide ${i + 1}`;
    if (!r || typeof r !== "object" || Array.isArray(r)) return { error: `${at}: expected an image link and a caption` };
    const { url, caption } = r as Record<string, unknown>;
    if (typeof url !== "string" || !url.trim()) return { error: `${at}: paste the image link` };
    const u = url.trim();
    if (u.length > 2000) return { error: `${at}: that image link is too long` };
    let parsed: URL;
    try { parsed = new URL(u); } catch { return { error: `${at}: that image link is not a valid URL` }; }
    if (parsed.protocol !== "https:") return { error: `${at}: image links must start with https://` };
    if (parsed.username || parsed.password) return { error: `${at}: image links must not contain a password` };
    if (isBlockedHostname(parsed.hostname)) return { error: `${at}: that image host is not allowed` };
    if (typeof caption !== "string") return { error: `${at}: add a caption` };
    const c = caption.trim();
    if (!c) return { error: `${at}: add a caption` };
    if (c.length > VIDEO_CAPTION_MAX) return { error: `${at}: captions are at most ${VIDEO_CAPTION_MAX} characters` };
    if (CAPTION_FORBIDDEN.test(c)) return { error: `${at}: captions can't contain %, \\ or line breaks` };
    slides.push({ url: u, caption: c });
  }
  return { slides };
}

/** The render program's view of the request: fixed local names img0..imgN + trimmed captions. */
export function videoSpec(slides: VideoSlideInput[]): VideoSpec {
  return { slides: slides.map((s, i) => ({ file: `img${i}`, caption: s.caption })) };
}

/**
 * The fixed Python render program. The ONLY variable part is the spec, embedded as a JSON
 * literal (JSON.stringify of the JSON text), so user input can never become Python syntax.
 * The program likewise builds ffmpeg as an argv list — there is no shell and no string-built
 * command anywhere in the pipeline.
 */
export function buildRenderCode(spec: VideoSpec): string {
  const py = `import glob, json, os, subprocess, sys

SPEC = json.loads(__SPEC_JSON__)
W, H = 720, 1280
OUT_W, OUT_H = 1080, 1920
SEG, FPS, FADE = 3.0, 24, 0.5
FRAMES = int(SEG * FPS)
MAX_OUT = 7900000

def fail(msg):
    print("ERROR: " + msg)
    sys.exit(1)

slides = SPEC["slides"]
for s in slides:
    p = s["file"]
    if not os.path.isfile(p):
        fail("An image could not be downloaded")
    if os.path.getsize(p) > ${VIDEO_IMAGE_MAX_BYTES}:
        fail("An image is larger than 10 MB")

font = "font.ttf"
if not os.path.isfile(font):
    font = None
    for pat in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                "/usr/share/fonts/**/DejaVuSans*.ttf",
                "/usr/share/fonts/**/*.ttf"):
        hits = sorted(glob.glob(pat, recursive=True))
        if hits:
            font = hits[0]
            break
if not font:
    fail("No font is available on the worker for captions")

for i, s in enumerate(slides):
    with open("cap%d.txt" % i, "w", encoding="utf-8") as f:
        f.write(s["caption"])

fc = []
for i, s in enumerate(slides):
    z = "1+0.15*on/%d" % FRAMES if i % 2 == 0 else "1.15-0.15*on/%d" % FRAMES
    fc.append(
        "[%d:v]scale=1440:2560:force_original_aspect_ratio=increase:flags=lanczos,"
        "crop=1440:2560,"
        "zoompan=z='%s':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=%d:s=%dx%d:fps=%d,"
        "drawtext=fontfile='%s':textfile='cap%d.txt':fontsize=40:fontcolor=white:"
        "box=1:boxcolor=black@0.45:boxborderw=16:x=(w-text_w)/2:y=h-text_h-56,"
        "format=yuv420p,setsar=1[v%d]" % (i, z, FRAMES, W, H, FPS, font, i, i)
    )
prev = "v0"
n = len(slides)
for j in range(1, n):
    out = "x%d" % j if j < n - 1 else "xf"
    fc.append("[%s][v%d]xfade=transition=fade:duration=%.2f:offset=%.2f[%s]" % (prev, j, FADE, j * (SEG - FADE), out))
    prev = out
fc.append("[%s]scale=%d:%d:flags=lanczos,format=yuv420p[vout]" % (prev, OUT_W, OUT_H))

args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
for s in slides:
    args += ["-i", s["file"]]
args += ["-filter_complex", ";".join(fc), "-map", "[vout]", "-an",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
         "-maxrate", "3200k", "-bufsize", "6400k",
         "-movflags", "+faststart", "out/video.mp4"]
os.makedirs("out", exist_ok=True)
try:
    r = subprocess.run(args, timeout=52, capture_output=True, text=True)
except subprocess.TimeoutExpired:
    fail("The render took too long")
if r.returncode != 0:
    print(r.stderr[-2000:])
    fail("ffmpeg could not render the video")
size = os.path.getsize("out/video.mp4")
if size > MAX_OUT:
    fail("The rendered video is too large to deliver")
print("Rendered video.mp4 %d bytes" % size)
`;
  return py.replace("__SPEC_JSON__", JSON.stringify(JSON.stringify(spec)));
}

/** Shape one browser_jobs row into the status the Video Maker card polls for. */
export function renderStatus(job: { status: string; error?: unknown; files?: unknown }):
  { status: string; video?: { name: string; url: string }; error?: string } {
  if (job.status === "queued" || job.status === "running") return { status: job.status };
  if (job.status === "failed") {
    return { status: "failed", error: typeof job.error === "string" && job.error ? job.error : "The render failed" };
  }
  if (job.status === "done") {
    const files = Array.isArray(job.files) ? (job.files as { name?: unknown; url?: unknown }[]) : [];
    const mp4 = files.find((f) => typeof f?.name === "string" && f.name.toLowerCase().endsWith(".mp4") && typeof f.url === "string");
    if (mp4) return { status: "done", video: { name: mp4.name as string, url: mp4.url as string } };
    return { status: "failed", error: "The render finished without a video file" };
  }
  return { status: "failed", error: "The render was cancelled" };
}
