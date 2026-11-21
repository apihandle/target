// @vitest-environment node
// Video Maker (/api/video/render + lib/server/videoRender.ts): a template slideshow rendered on
// the compute worker by a FIXED Python program queued as a browser_jobs code job. These tests pin
// the safety contract: signed-in users only; only 3–6 public https image URLs (no credentials, no
// private/local hosts, and the DNS-level resolvesPublic check must pass); captions can never
// become code, shell, or ffmpeg filter syntax (they travel as a JSON literal into the program and
// as plain text files into drawtext, and "%" — drawtext's one expansion trigger — is rejected);
// the ffmpeg command is built by the program as an argv list (asserted: no shell anywhere).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "child_process";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, pub: true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.db }));
vi.mock("@/lib/server/safeFetch", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/server/safeFetch")>();
  return { ...orig, resolvesPublic: async () => h.pub };
});

import { GET, POST } from "@/app/api/video/render/route";
import {
  buildRenderCode, parseVideoSlides, videoSpec,
  VIDEO_FONT_INPUT, VIDEO_FONT_URL, VIDEO_RENDER_GOAL,
} from "@/lib/server/videoRender";

const ME = "66666666-6666-4666-8666-666666666666";
const OTHER = "77777777-7777-4777-8777-777777777777";

const slide = (i: number, over: Partial<{ url: string; caption: string }> = {}) => ({
  url: `https://images.example.com/pic${i}.jpg`,
  caption: `Caption ${i}`,
  ...over,
});
const goodBody = (n = 3) => ({ slides: Array.from({ length: n }, (_, i) => slide(i)) });
const post = (body: unknown) => POST(new Request("http://t/api/video/render", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}));
const get = (id: string) => GET(new Request(`http://t/api/video/render?id=${id}`));
const jobs = () => h.db.rows("browser_jobs");

beforeEach(() => { h.db = new FakeDb(); h.db.as(ME); h.pub = true; });

describe("parseVideoSlides", () => {
  it("accepts 3–6 https slides and trims captions", () => {
    const out = parseVideoSlides({ slides: [slide(0, { caption: "  Hello there  " }), slide(1), slide(2)] });
    expect("slides" in out && out.slides[0]).toEqual({ url: "https://images.example.com/pic0.jpg", caption: "Hello there" });
    expect("slides" in out && out.slides).toHaveLength(3);
    expect("slides" in parseVideoSlides(goodBody(6))).toBe(true);
  });

  it("rejects too few and too many slides", () => {
    expect(parseVideoSlides(goodBody(2))).toMatchObject({ error: expect.stringContaining("at least 3") });
    expect(parseVideoSlides(goodBody(7))).toMatchObject({ error: expect.stringContaining("At most 6") });
    expect(parseVideoSlides({})).toHaveProperty("error");
    expect(parseVideoSlides({ slides: "nope" })).toHaveProperty("error");
    expect(parseVideoSlides(null)).toHaveProperty("error");
  });

  it("rejects non-https, credentialed, and private/local image URLs", () => {
    const bad = [
      "http://images.example.com/pic.jpg",
      "ftp://images.example.com/pic.jpg",
      "https://user:pass@images.example.com/pic.jpg",
      "https://localhost/pic.jpg",
      "https://127.0.0.1/pic.jpg",
      "https://192.168.1.9/pic.jpg",
      "https://[::1]/pic.jpg",
      "https://metadata.google.internal/pic.jpg",
      "https://intranet/pic.jpg",
      "not a url",
      "",
    ];
    for (const url of bad) {
      const out = parseVideoSlides({ slides: [slide(0, { url }), slide(1), slide(2)] });
      expect(out, url).toHaveProperty("error");
    }
  });

  it("rejects captions that are empty, overlong, or carry render-unsafe characters", () => {
    const bad = ["", "   ", "x".repeat(91), "50% off today", "back\\slash", "line\nbreak", "tab\there", "%{n} frame"];
    for (const caption of bad) {
      const out = parseVideoSlides({ slides: [slide(0, { caption }), slide(1), slide(2)] });
      expect(out, JSON.stringify(caption)).toHaveProperty("error");
    }
    // Ordinary punctuation, quotes and shell metacharacters are fine — they are data, never code.
    const ok = parseVideoSlides({ slides: [slide(0, { caption: `a "quoted" ; rm -rf / ; $(whoami) 'thing'` }), slide(1), slide(2)] });
    expect(ok).toHaveProperty("slides");
  });
});

describe("buildRenderCode", () => {
  it("embeds the spec as a JSON literal and builds ffmpeg as an argv list — no shell, no os.system", () => {
    const caption = `a "quoted" ; rm -rf / ; $(whoami) 'thing'`;
    const parsed = parseVideoSlides({ slides: [slide(0, { caption }), slide(1), slide(2)] });
    if (!("slides" in parsed)) throw new Error("fixture should parse");
    const code = buildRenderCode(videoSpec(parsed.slides));
    // The program is fixed: subprocess with an argument list, never a shell.
    expect(code).toContain("subprocess.run(args");
    expect(code).not.toContain("shell=True");
    expect(code).not.toContain("os.system");
    expect(code).not.toContain("os.popen");
    // Captions reach ffmpeg only through drawtext text files, never inline in the filter graph.
    expect(code).toContain("textfile=");
    expect(code).not.toMatch(/drawtext=[^,]*:text=/);
    // The caption exists ONLY inside the embedded JSON literal: strip the literal out and no
    // fragment of the caption remains anywhere in the program.
    const literal = code.match(/json\.loads\(("(?:[^"\\]|\\.)*")\)/)?.[1];
    expect(literal).toBeTruthy();
    const rest = code.replace(literal as string, "");
    expect(rest).not.toContain("rm -rf");
    expect(rest).not.toContain("whoami");
    expect(rest).not.toContain("quoted");
    // And the literal really is our spec, recoverable as JSON, caption intact.
    const spec = JSON.parse(JSON.parse(literal as string)) as ReturnType<typeof videoSpec>;
    expect(spec.slides.map((s) => s.file)).toEqual(["img0", "img1", "img2"]);
    expect(spec.slides[0].caption).toBe(caption);
  });

  it("builds its graph in a loop: a zoompan segment template, xfades between slides, one final upscale", () => {
    const parsed = parseVideoSlides(goodBody(6));
    if (!("slides" in parsed)) throw new Error("fixture should parse");
    const code = buildRenderCode(videoSpec(parsed.slides));
    expect(code).toContain("for i, s in enumerate(slides)");
    expect(code.match(/zoompan=/g)).toHaveLength(1); // one template, applied per slide by the loop
    expect(code).toContain("for j in range(1, n)");
    expect(code).toContain("xfade=transition=fade");
    expect(code).toContain("OUT_W, OUT_H = 1080, 1920");
    expect(code).toContain("scale=%d:%d");
    expect(code).toContain("out/video.mp4");
    // Alternating zoom directions keep it from feeling mechanical.
    expect(code).toContain("1+0.15*on/");
    expect(code).toContain("1.15-0.15*on/");
  });

  it("generates Python that parses (when python3 is available)", () => {
    const parsed = parseVideoSlides(goodBody(4));
    if (!("slides" in parsed)) throw new Error("fixture should parse");
    const code = buildRenderCode(videoSpec(parsed.slides));
    try {
      execFileSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: code });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return; // no python3 on this machine — skip
      throw e;
    }
  });
});

describe("POST /api/video/render", () => {
  it("signed out → 401, and nothing is queued", async () => {
    h.db.as(null);
    expect((await post(goodBody())).status).toBe(401);
    expect(jobs()).toHaveLength(0);
  });

  it("queues exactly one code job with the fixed program, the images and the font as inputs", async () => {
    const r = await post(goodBody(4));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.status).toBe("queued");
    expect(jobs()).toHaveLength(1);
    const job = jobs()[0];
    expect(job.id).toBe(j.job_id);
    expect(job.user_id).toBe(ME);
    expect(job.mode).toBe("code");
    expect(job.language).toBe("python");
    expect(job.goal).toBe(VIDEO_RENDER_GOAL);
    expect(job.status).toBe("queued");
    expect(job.conversation_id).toBeNull();
    const inputs = job.inputs as { name: string; url: string }[];
    expect(inputs.map((i) => i.name)).toEqual(["img0", "img1", "img2", "img3", VIDEO_FONT_INPUT]);
    expect(inputs[0].url).toBe("https://images.example.com/pic0.jpg");
    expect(inputs[4].url).toBe(VIDEO_FONT_URL);
    expect(String(job.code)).toContain("ffmpeg");
    expect(String(job.code)).not.toContain("shell=True");
  });

  it("invalid slides → 400 and nothing is queued", async () => {
    expect((await post(goodBody(2))).status).toBe(400);
    expect((await post({ slides: [slide(0, { url: "http://x.example.com/a.jpg" }), slide(1), slide(2)] })).status).toBe(400);
    expect((await post({ slides: [slide(0, { caption: "50% off" }), slide(1), slide(2)] })).status).toBe(400);
    expect(jobs()).toHaveLength(0);
  });

  it("a host that does not resolve to a public address → 400 and nothing is queued", async () => {
    h.pub = false;
    expect((await post(goodBody())).status).toBe(400);
    expect(jobs()).toHaveLength(0);
  });
});

describe("GET /api/video/render", () => {
  async function queuedJob(): Promise<string> {
    const r = await post(goodBody());
    return (await r.json()).job_id as string;
  }

  it("signed out → 401; missing or malformed id → 400", async () => {
    h.db.as(null);
    expect((await get("66666666-6666-4666-8666-666666666666")).status).toBe(401);
    h.db.as(ME);
    expect((await GET(new Request("http://t/api/video/render"))).status).toBe(400);
    expect((await get("not-a-uuid")).status).toBe(400);
  });

  it("reports queued, then done with the stored mp4, scoped to the owner", async () => {
    const id = await queuedJob();
    expect(await (await get(id)).json()).toEqual({ status: "queued" });
    const job = jobs()[0];
    job.status = "done";
    job.files = [{ name: "video.mp4", url: "https://gettarget.vercel.app/api/files/abc" }, { name: "notes.txt", url: "https://x/y" }];
    expect(await (await get(id)).json()).toEqual({
      status: "done", video: { name: "video.mp4", url: "https://gettarget.vercel.app/api/files/abc" },
    });
    h.db.as(OTHER);
    expect((await get(id)).status).toBe(404);
  });

  it("a done job with no mp4 reads as failed, and a failed job carries its error", async () => {
    const id = await queuedJob();
    const job = jobs()[0];
    job.status = "done";
    job.files = [];
    const done = await (await get(id)).json();
    expect(done.status).toBe("failed");
    expect(done.error).toContain("without a video");
    job.status = "failed";
    job.error = "The render took too long";
    expect(await (await get(id)).json()).toEqual({ status: "failed", error: "The render took too long" });
  });

  it("another kind of job is a 404 even for its owner", async () => {
    await h.db.from("browser_jobs").insert({
      user_id: ME, mode: "code", goal: "Some other code run", language: "python", code: "print(1)", inputs: [], status: "done",
    });
    const other = jobs().find((j) => j.goal !== VIDEO_RENDER_GOAL);
    expect((await get(String(other?.id))).status).toBe(404);
  });
});
