import { z } from "zod";
import { ATTACHMENT_BUCKET } from "@/lib/attachments";
import { SITE, slugFor } from "@/lib/builtins/helpers";
import type { BuiltinCtx, BuiltinTool } from "@/lib/builtins/tools";

const tool = <S extends z.ZodTypeAny>(t: BuiltinTool<S>): BuiltinTool => t as unknown as BuiltinTool;

/** Read-only view of a worker job the chat can show. */
export const JOB_VIEW = "id, mode, goal, status, result, error, files, created_at, finished_at";
type JobView = { id: string; mode: string; goal: string; status: string; result: string | null; error: string | null; files: unknown };

/** Wait (up to the chat's time budget) for a queued worker job to finish, so short jobs answer in the same reply. */
export async function waitForJob(ctx: BuiltinCtx, id: string, ms = 45000, every = 2500): Promise<JobView | null> {
  const until = Date.now() + ms;
  let last: JobView | null = null;
  for (;;) {
    const { data } = await ctx.db.from("browser_jobs").select(JOB_VIEW).eq("id", id).eq("user_id", ctx.userId).maybeSingle();
    last = (data as JobView | null) ?? last;
    if (!last || ["done", "failed", "cancelled", "needs_approval"].includes(last.status) || Date.now() + every > until) return last;
    await new Promise((r) => setTimeout(r, every));
  }
}

/** Files from this chat the worker may download: short-lived signed links, never public paths. */
export async function chatInputs(ctx: BuiltinCtx, names: string[]): Promise<{ name: string; url: string }[]> {
  if (!names.length) return [];
  if (!ctx.conversationId) throw new Error("Attach the file in this chat first");
  const { data } = await ctx.db.from("attachments").select("name, storage_path").eq("user_id", ctx.userId).eq("conversation_id", ctx.conversationId).in("name", names).limit(10);
  const rows = (data ?? []) as { name: string; storage_path: string }[];
  const missing = names.filter((n) => !rows.some((r) => r.name === n));
  if (missing.length) throw new Error(`Not found in this chat: ${missing.join(", ")}`);
  return Promise.all(rows.map(async (r) => {
    const s = await ctx.db.storage.from(ATTACHMENT_BUCKET).createSignedUrl(r.storage_path, 900);
    if (s.error || !s.data?.signedUrl) throw new Error("Couldn't prepare the file");
    return { name: r.name.replace(/[^\w.\- ]/g, "_").slice(0, 100), url: s.data.signedUrl };
  }));
}

function jobReply(j: JobView | null, id: string) {
  if (!j) return { job_id: id, status: "unknown" };
  if (j.status === "done") return { job_id: id, status: "done", result: j.result, files: j.files };
  if (j.status === "failed") return { job_id: id, status: "failed", error: j.error };
  return { job_id: id, status: j.status, note: "Still running on the worker. Tell the user it will show in Settings, Browser tasks, and that you can check with job_status." };
}

export const IMAGE_OPS = z.object({
  resize: z.object({ width: z.number().int().min(16).max(6000).optional(), height: z.number().int().min(16).max(6000).optional() }).optional(),
  crop: z.object({ left: z.number().int().min(0), top: z.number().int().min(0), width: z.number().int().min(1), height: z.number().int().min(1) }).optional(),
  rotate: z.number().int().min(-360).max(360).optional(),
  flip: z.enum(["horizontal", "vertical"]).optional(),
  grayscale: z.boolean().optional(),
  brightness: z.number().min(0.1).max(3).optional(),
  contrast: z.number().min(0.1).max(3).optional(),
  blur: z.number().min(0).max(30).optional(),
  format: z.enum(["png", "jpeg", "webp"]).optional(),
});
export type ImageOps = z.infer<typeof IMAGE_OPS>;

/** A fixed Pillow script built from validated numbers only. The model never writes this code. */
export function pillowScript(input: string, ops: ImageOps): string {
  const fmt = ops.format ?? "png";
  const L = [
    "from PIL import Image, ImageOps, ImageEnhance, ImageFilter", "import os",
    `im = Image.open(${JSON.stringify(input)})`, "im = ImageOps.exif_transpose(im)",
  ];
  if (ops.crop) L.push(`im = im.crop((${ops.crop.left}, ${ops.crop.top}, ${ops.crop.left + ops.crop.width}, ${ops.crop.top + ops.crop.height}))`);
  if (ops.resize) {
    const { width: w, height: h } = ops.resize;
    if (w && h) L.push(`im = im.resize((${w}, ${h}))`);
    else if (w) L.push(`im = im.resize((${w}, max(1, round(im.height * ${w} / im.width))))`);
    else if (h) L.push(`im = im.resize((max(1, round(im.width * ${h} / im.height)), ${h}))`);
  }
  if (ops.rotate) L.push(`im = im.rotate(${-ops.rotate}, expand=True)`);
  if (ops.flip === "horizontal") L.push("im = ImageOps.mirror(im)");
  if (ops.flip === "vertical") L.push("im = ImageOps.flip(im)");
  if (ops.grayscale) L.push("im = ImageOps.grayscale(im)");
  if (ops.brightness) L.push(`im = ImageEnhance.Brightness(im).enhance(${ops.brightness})`);
  if (ops.contrast) L.push(`im = ImageEnhance.Contrast(im).enhance(${ops.contrast})`);
  if (ops.blur) L.push(`im = im.filter(ImageFilter.GaussianBlur(${ops.blur}))`);
  if (fmt === "jpeg") L.push("im = im.convert('RGB')");
  L.push("os.makedirs('out', exist_ok=True)", `im.save('out/edited.${fmt === "jpeg" ? "jpg" : fmt}')`, "print('Saved', im.size)");
  return L.join("\n");
}

/** Strip a model-written site to something we can serve: one HTML document, no external <base>. */
export function cleanSiteHtml(html: string): string {
  let h = html.trim().replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "");
  h = h.replace(/<base\b[^>]*>/gi, "");
  if (!/<html[\s>]/i.test(h)) h = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${h}</body></html>`;
  return h;
}

/** Serve-time headers for a user's HTML Page: an opaque sandbox origin, so it can't touch TARGET's cookies or APIs. */
export const SITE_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-modals allow-popups-to-escape-sandbox; default-src 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src https:; frame-ancestors 'self'",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "public, max-age=60",
};

export const ROUND2_TOOLS: BuiltinTool[] = [
  tool({
    name: "run_code", label: "Running code",
    description: "Run Python 3 or JavaScript (Node) in TARGET's sandbox to calculate, analyse data, convert or process files (pandas, Pillow, matplotlib, ffmpeg are available on the worker). Name files the user attached in this chat in `files`; they are in the working folder. Save files to make downloadable into the folder `out/` (max 5). Print the answer. 60 second limit, no secrets. Needs TARGET's worker to be running.",
    input: z.object({ language: z.enum(["python", "javascript"]).default("python"), code: z.string().min(1).max(50000), purpose: z.string().min(3).max(200), files: z.array(z.string().min(1).max(200)).max(5).default([]) }),
    async execute(a, ctx) {
      const inputs = await chatInputs(ctx, a.files);
      const { data, error } = await ctx.db.from("browser_jobs").insert({
        user_id: ctx.userId, mode: "code", goal: a.purpose, language: a.language, code: a.code, inputs, status: "queued", conversation_id: ctx.conversationId,
      }).select("id").single();
      if (error || !data) throw new Error("Couldn't start the code run");
      return jobReply(await waitForJob(ctx, data.id as string), data.id as string);
    },
  }),
  tool({
    name: "job_status", label: "Checking the task",
    description: "Check a browser, code or video task started earlier (by its job_id) and get its result.",
    input: z.object({ job_id: z.string().uuid() }),
    async execute(a, ctx) {
      const { data } = await ctx.db.from("browser_jobs").select(JOB_VIEW).eq("id", a.job_id).eq("user_id", ctx.userId).maybeSingle();
      if (!data) throw new Error("No such task");
      return jobReply(data as JobView, a.job_id);
    },
  }),
  tool({
    name: "edit_image", label: "Editing the photo",
    description: "Edit a photo. For simple changes (resize, crop, rotate, flip, black and white, brightness, contrast, blur, convert format) pass `ops`; it runs exactly on the worker. For creative changes (remove or add objects, change background, style, outfit, sky) pass only `instruction`; an AI image model redraws it. `image` is the file name the user attached in this chat, or a public https image URL.",
    input: z.object({ image: z.string().min(1).max(2000), instruction: z.string().max(600).default(""), ops: IMAGE_OPS.optional() }),
    async execute(a, ctx) {
      const isUrl = /^https:\/\//.test(a.image);
      const src = isUrl ? { name: "input-image", url: a.image } : (await chatInputs(ctx, [a.image]))[0];
      if (a.ops && Object.keys(a.ops).length) {
        const { data, error } = await ctx.db.from("browser_jobs").insert({
          user_id: ctx.userId, mode: "code", goal: `Edit photo ${isUrl ? "" : a.image}`.trim().slice(0, 200), language: "python",
          code: pillowScript(src.name, a.ops), inputs: [src], status: "queued", conversation_id: ctx.conversationId,
        }).select("id").single();
        if (error || !data) throw new Error("Couldn't start the edit");
        return jobReply(await waitForJob(ctx, data.id as string), data.id as string);
      }
      if (!a.instruction.trim()) throw new Error("Say what to change, or give ops");
      const key = process.env.POLLINATIONS_KEY;
      if (!key) throw new Error("AI photo edits need POLLINATIONS_KEY on the server. Simple edits (crop, resize, filters) still work.");
      const f = ctx.fetch ?? fetch;
      const r = await f("https://gen.pollinations.ai/v1/images/edits", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: process.env.POLLINATIONS_EDIT_MODEL || "kontext", prompt: a.instruction, image: [src.url], response_format: "b64_json" }),
        signal: AbortSignal.timeout(55000),
      });
      if (!r.ok) throw new Error(`The image model refused (${r.status})`);
      const j = (await r.json()) as { data?: { b64_json?: string }[] };
      const b64 = j.data?.[0]?.b64_json;
      if (!b64) throw new Error("The image model returned nothing");
      const bytes = Buffer.from(b64, "base64");
      const id = crypto.randomUUID();
      const path = `${ctx.userId}/generated/${id}-edited.png`;
      const up = await ctx.db.storage.from(ATTACHMENT_BUCKET).upload(path, bytes, { contentType: "image/png", upsert: false });
      if (up.error) throw new Error("Couldn't store the edited photo");
      await ctx.db.from("generated_files").insert({ id, user_id: ctx.userId, name: "edited.png", mime: "image/png", size_bytes: bytes.byteLength, storage_path: path });
      return { image_url: `${SITE}/api/files/${id}`, show_as: "markdown image" };
    },
  }),
  tool({
    name: "analyze_video", label: "Watching the video",
    description: "Understand a video from a link (Instagram, X, Vimeo, Facebook, YouTube Shorts and most sites): the worker downloads it, takes still frames and any captions, and TARGET describes what happens. Use youtube_transcript instead for normal YouTube videos with speech.",
    input: z.object({ url: z.string().url().max(2000), question: z.string().max(300).default("") }),
    async execute(a, ctx) {
      if (!/^https?:\/\//.test(a.url)) throw new Error("Only http(s) links");
      const { data, error } = await ctx.db.from("browser_jobs").insert({
        user_id: ctx.userId, mode: "video", goal: (a.question || "Describe this video").slice(0, 300), start_url: a.url, status: "queued", conversation_id: ctx.conversationId,
      }).select("id").single();
      if (error || !data) throw new Error("Couldn't start the video task");
      return jobReply(await waitForJob(ctx, data.id as string, 50000), data.id as string);
    },
  }),
  tool({
    name: "checkout", label: "Preparing the order",
    description: "Buy or book something on a website for the user (an order, ticket, hotel, table). Give the store, every item with its price, the total exactly as the site shows it, the vault card to pay with (from list_vault), and the start URL. An order card with an Approve button appears in chat; NOTHING is bought until the user taps Approve. Then the browser worker completes the checkout on its own.",
    input: z.object({
      merchant: z.string().min(1).max(80), start_url: z.string().url().max(2000),
      items: z.array(z.object({ name: z.string().min(1).max(120), qty: z.number().int().min(1).max(99).default(1), price: z.string().max(30) })).min(1).max(20),
      total: z.string().min(1).max(30), payment_secret_id: z.string().uuid().optional(), login_secret_id: z.string().uuid().optional(),
      deliver_to: z.string().max(200).default(""), instructions: z.string().max(800).default(""),
    }),
    async execute(a, ctx) {
      if (!/^https?:\/\//.test(a.start_url)) throw new Error("Only http(s) sites");
      const secrets = [a.payment_secret_id, a.login_secret_id].filter((x): x is string => !!x);
      let payLabel = "";
      if (secrets.length) {
        const { data } = await ctx.db.from("vault_secrets").select("id, kind, label, preview").eq("user_id", ctx.userId).in("id", secrets);
        if ((data ?? []).length !== new Set(secrets).size) throw new Error("A vault item doesn't exist");
        const card = (data ?? []).find((d) => d.id === a.payment_secret_id);
        if (a.payment_secret_id && card?.kind !== "card") throw new Error("payment_secret_id must be a saved card");
        payLabel = card ? `${card.label} ${card.preview}`.trim() : "";
      }
      const goal = `Buy at ${a.merchant}: ${a.items.map((i) => `${i.qty} x ${i.name}`).join(", ")}. Total must be ${a.total}. ${a.deliver_to ? `Deliver to ${a.deliver_to}. ` : ""}${a.instructions}`.slice(0, 500);
      const { data: job, error } = await ctx.db.from("browser_jobs").insert({
        user_id: ctx.userId, mode: "auto", goal, start_url: a.start_url, allowed_secrets: secrets, max_steps: 35, status: "needs_approval", conversation_id: ctx.conversationId,
      }).select("id").single();
      if (error || !job) throw new Error("Couldn't prepare the order");
      const summary = `Buy from ${a.merchant} for ${a.total}`.slice(0, 300);
      const { data: ap, error: e2 } = await ctx.db.from("approval_requests").insert({
        user_id: ctx.userId, action_type: "purchase", summary, destination: a.merchant, status: "pending", conversation_id: ctx.conversationId,
        payload: { browser_job_id: job.id, items: a.items, total: a.total, payment: payLabel, deliver_to: a.deliver_to },
      }).select("id").single();
      if (e2 || !ap) throw new Error("Couldn't prepare the order card");
      return { __approval: { id: ap.id as string, summary } };
    },
  }),
  tool({
    name: "create_site", label: "Building the website",
    description: "Publish a full custom website (landing page, portfolio, invite with RSVP form, small game, menu) with your own HTML, CSS and JavaScript in ONE self-contained HTML document. Use only https images and CDNs. Returns a public link. Prefer create_page for plain text documents.",
    input: z.object({ title: z.string().min(1).max(120), html: z.string().min(20).max(300000) }),
    async execute(a, ctx) {
      const { count } = await ctx.db.from("pages").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId);
      if ((count ?? 0) >= 100) throw new Error("You already have 100 Pages. Delete one in Settings first.");
      const slug = slugFor(a.title);
      const { error } = await ctx.db.from("pages").insert({ user_id: ctx.userId, slug, title: a.title, format: "html", html: cleanSiteHtml(a.html), markdown: a.title });
      if (error) throw new Error("Couldn't publish the website");
      return { site_url: `${SITE}/site/${slug}`, note: "Anyone with the link can open it. The user can hide or delete it in Settings, Pages." };
    },
  }),
];
