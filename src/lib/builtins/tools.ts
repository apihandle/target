import { jobWaitMs, waitForJob } from "@/lib/builtins/round2";
import { isFormSubmitGoal } from "@/lib/formFill";
import { kickCloudWorker } from "@/lib/server/kickWorker";
import { z } from "zod";
import type { Db } from "@/lib/server/auth";
import { ATTACHMENT_BUCKET } from "@/lib/attachments";
import { llmText } from "@/lib/llm";
import { searchBlock, tavilySearch } from "@/lib/search";
import { readUrl } from "@/lib/urlReader";
import { ROUND2_TOOLS } from "@/lib/builtins/round2";
import { siteLoginTool } from "@/lib/builtins/signin";
import { sitePasswordResetTool, siteRegisterTool } from "@/lib/builtins/siteAccount";
import {
  FILE_FORMATS, SITE, browserStep, captionsToText, chartInput, chartUrl, fileName, imageUrl, makePdf, slugFor, stepsNeedApproval, youtubeId, type FileFormat,
} from "@/lib/builtins/helpers";

export type BuiltinCtx = { db: Db; userId: string; conversationId: string | null; fetch?: typeof fetch; autoApproveBrowser?: boolean; userTexts?: string[]; /** Epoch ms by which a tool must answer (the chat's time budget). */ deadline?: number };
export type BuiltinTool<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string; label: string; description: string; input: S;
  execute: (args: z.infer<S>, ctx: BuiltinCtx) => Promise<unknown>;
};
const tool = <S extends z.ZodTypeAny>(t: BuiltinTool<S>): BuiltinTool => t as unknown as BuiltinTool;

export const BUILTIN_TOOLS: BuiltinTool[] = [
  tool({
    name: "generate_image", label: "Creating an image",
    description: "Create a new image from a text description (art, logo idea, poster, wallpaper, illustration). Returns an image URL; show it in your reply as markdown ![short caption](url). Write the prompt in English with style, subject, lighting and colours.",
    input: z.object({ prompt: z.string().min(3).max(900), size: z.enum(["square", "portrait", "landscape"]).default("square") }),
    async execute(a) { return { image_url: imageUrl(a.prompt, a.size), show_as: "markdown image" }; },
  }),
  tool({
    name: "create_chart", label: "Drawing a chart",
    description: "Draw a bar, line, pie, doughnut or radar chart from numbers. Returns an image URL to show as markdown ![title](url).",
    input: chartInput,
    async execute(a) { return { image_url: chartUrl(a) }; },
  }),
  tool({
    name: "image_search", label: "Finding photos",
    description: "Find real photos on the web (openly licensed) when the user wants to SEE something: a place, animal, object, style. Returns image URLs with their source pages; show 2-4 as markdown images and credit the source.",
    input: z.object({ query: z.string().min(2).max(200), count: z.number().int().min(1).max(6).default(3) }),
    async execute(a, ctx) {
      const f = ctx.fetch ?? fetch;
      const r = await f(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(a.query)}&page_size=${a.count}&mature=false`, { headers: { "User-Agent": "TARGET (+https://gettarget.vercel.app)" }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`Photo search failed (${r.status})`);
      const j = (await r.json()) as { results?: { title?: string; url?: string; thumbnail?: string; foreign_landing_url?: string; creator?: string; license?: string }[] };
      const images = (j.results ?? []).filter((x) => x.url?.startsWith("https://")).slice(0, a.count)
        .map((x) => ({ title: (x.title ?? "").slice(0, 100), image_url: x.url, source: x.foreign_landing_url, credit: [x.creator, x.license?.toUpperCase()].filter(Boolean).join(", ") }));
      return images.length ? { images } : { images: [], note: "No photos found. Say so briefly." };
    },
  }),
  tool({
    name: "youtube_transcript", label: "Reading the video",
    description: "Get the title and spoken transcript of a YouTube video so you can summarize it or answer questions about it.",
    input: z.object({ url: z.string().min(10).max(500) }),
    async execute(a, ctx) {
      const id = youtubeId(a.url);
      if (!id) throw new Error("That isn't a YouTube video link");
      const f = ctx.fetch ?? fetch;
      const page = await f(`https://www.youtube.com/watch?v=${id}&hl=en`, { headers: { "Accept-Language": "en", "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) });
      const html = page.ok ? await page.text() : "";
      const title = (html.match(/<meta name="title" content="([^"]*)"/)?.[1] ?? html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "").replace(/ - YouTube$/, "");
      const desc = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\n/g, "\n").replace(/\\"/g, '"').slice(0, 2000) ?? "";
      const tracksRaw = html.match(/"captionTracks":(\[.*?\])/)?.[1];
      let transcript = "";
      if (tracksRaw) {
        try {
          const tracks = JSON.parse(tracksRaw) as { baseUrl: string; languageCode?: string; kind?: string }[];
          const pick = tracks.find((t) => t.languageCode?.startsWith("en") && t.kind !== "asr") ?? tracks.find((t) => t.languageCode?.startsWith("hi")) ?? tracks.find((t) => t.languageCode?.startsWith("en")) ?? tracks[0];
          if (pick?.baseUrl?.startsWith("https://www.youtube.com/")) {
            const cap = await f(pick.baseUrl + "&fmt=json3", { signal: AbortSignal.timeout(12000) });
            if (cap.ok) transcript = captionsToText(await cap.text()).slice(0, 30000);
          }
        } catch { /* fall through */ }
      }
      if (!title && !transcript) throw new Error("YouTube didn't share this video's details right now");
      return { video_id: id, title, description: desc, transcript: transcript || null, note: transcript ? undefined : "No captions were available; work from the title and description and say so." };
    },
  }),
  tool({
    name: "read_webpage", label: "Reading the page",
    description: "Open a public web page and read its text (articles, docs, product pages).",
    input: z.object({ url: z.string().url().max(2000) }),
    async execute(a, ctx) { return await readUrl(a.url, ctx.fetch ?? fetch); },
  }),
  tool({
    name: "create_file", label: "Making the file",
    description: "Create a downloadable file for the user: pdf (report, resume, notes, letter; plain text with # headings), csv (opens in Excel/Sheets), txt, md, html or json. Returns a download link to share as a markdown link.",
    input: z.object({ filename: z.string().min(1).max(100), format: z.enum(["pdf", "csv", "txt", "md", "html", "json"]), title: z.string().max(120).optional(), content: z.string().min(1).max(200000) }),
    async execute(a, ctx) {
      const name = fileName(a.filename, a.format as FileFormat);
      const bytes = a.format === "pdf" ? await makePdf(a.title || a.filename, a.content) : new TextEncoder().encode(a.content);
      if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("The file would be larger than 10 MB");
      const id = crypto.randomUUID();
      const path = `${ctx.userId}/generated/${id}-${name}`;
      const mime = FILE_FORMATS[a.format as FileFormat];
      const up = await ctx.db.storage.from(ATTACHMENT_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
      if (up.error) throw new Error("Couldn't store the file");
      const { error } = await ctx.db.from("generated_files").insert({ id, user_id: ctx.userId, name, mime, size_bytes: bytes.byteLength, storage_path: path });
      if (error) { await ctx.db.storage.from(ATTACHMENT_BUCKET).remove([path]).catch(() => undefined); throw new Error("Couldn't save the file"); }
      return { file: name, download_url: `${SITE}/api/files/${id}`, size_kb: Math.ceil(bytes.byteLength / 1024), note: "Only the signed-in owner can download this link." };
    },
  }),
  tool({
    name: "create_page", label: "Building the page",
    description: "Publish a simple public Page (trip itinerary, invite, menu, resume, notes, guide) the user can share by link. Write it in Markdown (headings, lists, tables, links, images). No raw HTML.",
    input: z.object({ title: z.string().min(1).max(120), markdown: z.string().min(1).max(60000) }),
    async execute(a, ctx) {
      const { count } = await ctx.db.from("pages").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId);
      if ((count ?? 0) >= 100) throw new Error("You already have 100 Pages. Delete one in Settings first.");
      const slug = slugFor(a.title);
      const { error } = await ctx.db.from("pages").insert({ user_id: ctx.userId, slug, title: a.title, markdown: a.markdown.replace(/<\/?[a-z][^>]*>/gi, "") });
      if (error) throw new Error("Couldn't publish the Page");
      return { page_url: `${SITE}/p/${slug}`, note: "Anyone with the link can view it. The user can delete it in Settings, Pages." };
    },
  }),
  tool({
    name: "run_parallel", label: "Working on several things at once",
    description: "Research 2-4 independent sub-questions at the same time (for example compare three phones, or check flights, hotels and weather for a trip). Each runs on its own with a web search when useful; combine the answers in your reply.",
    input: z.object({ tasks: z.array(z.string().min(3).max(400)).min(2).max(4), web: z.boolean().default(true) }),
    async execute(a, ctx) {
      const key = process.env.TAVILY_API_KEY;
      const started = Date.now();
      const results = await Promise.all(a.tasks.map(async (t) => {
        let ctxBlock = "";
        if (a.web && key) { try { ctxBlock = searchBlock(t, await tavilySearch(t, key)); } catch { /* answer without */ } }
        const answer = await llmText({ usage: { userId: ctx.userId, feature: "research" }, messages: [{ role: "system", content: "Answer this one research question concisely with concrete facts, numbers and source URLs when given. No preamble." + ctxBlock }, { role: "user", content: t }], maxTokens: 900, timeoutMs: 25000 });
        return { task: t, answer: answer || "(no answer in time)" };
      }));
      return { results, seconds: Math.round((Date.now() - started) / 1000) };
    },
  }),
  tool({
    name: "list_vault", label: "Checking your vault",
    description: "List the names of logins, cards and keys the user saved in their TARGET vault (never the secret values). Use before planning a browser job that signs in or pays.",
    input: z.object({}),
    async execute(_a, ctx) {
      const { data } = await ctx.db.from("vault_secrets").select("id, kind, label, site, preview").eq("user_id", ctx.userId).order("created_at", { ascending: false }).limit(50);
      return { items: data ?? [], note: "Values are never shown. Refer to an item by its id in fill_secret steps." };
    },
  }),
  tool({
    name: "browser_task", label: "Planning a browser task",
    description: "Do something on a website in a real browser. Smart mode (auto: true, the usual choice): give only the goal and start URL; the browser looks at the screen itself and decides each click and keystroke, signing in with vault items you list in secret_ids. Fixed mode: give exact steps (goto, click, fill, fill_secret, press, wait, extract). Read-only fixed steps run at once; anything that can click or type waits for the user's approval. For buying use checkout, for reservations / appointments use book. Needs TARGET's browser worker to be running.",
    input: z.object({ goal: z.string().min(3).max(500), start_url: z.string().url().max(2000), auto: z.boolean().default(true), secret_ids: z.array(z.string().uuid()).max(4).default([]), steps: z.array(browserStep).max(30).default([]) }),
    async execute(a, ctx) {
      if (!/^https?:\/\//.test(a.start_url)) throw new Error("Only http(s) sites");
      const smart = a.auto && !a.steps.length;
      const ids = smart ? a.secret_ids : a.steps.flatMap((s) => (s.action === "fill_secret" ? [s.secret_id] : []));
      if (ids.length) {
        const { data } = await ctx.db.from("vault_secrets").select("id").eq("user_id", ctx.userId).in("id", ids);
        if ((data ?? []).length !== new Set(ids).size) throw new Error("A vault item in the steps doesn't exist");
      }
      // Smart tasks without a login just look things up, so they run at once. Sign-ins, typing steps and submitting
      // someone else's form wait for the user's Approve on a card in this chat (Task mode approves it in code).
      const formSubmit = smart && isFormSubmitGoal(a.goal, a.start_url);
      const needs = (smart ? a.secret_ids.length > 0 || formSubmit : stepsNeedApproval(a.steps)) && !ctx.autoApproveBrowser;
      const { data, error } = await ctx.db.from("browser_jobs").insert({
        user_id: ctx.userId, goal: a.goal, start_url: a.start_url, steps: smart ? [] : a.steps, mode: smart ? "auto" : "steps", allowed_secrets: smart ? a.secret_ids : [],
        status: needs ? "needs_approval" : "queued", conversation_id: ctx.conversationId,
      }).select("id").single();
      if (error || !data) throw new Error("Couldn't create the browser task");
      if (needs) {
        let host = "the site";
        try { host = new URL(a.start_url).hostname.replace(/^www\./, ""); } catch { /* keep */ }
        const summary = (formSubmit ? `Fill in and submit the form on ${host}: ${a.goal}` : `Let the browser act on ${host}${smart && a.secret_ids.length ? " with your saved login" : ""}: ${a.goal}`).slice(0, 300);
        const { data: ap, error: e2 } = await ctx.db.from("approval_requests").insert({
          user_id: ctx.userId, action_type: "browser_task", summary, destination: host, status: "pending", conversation_id: ctx.conversationId,
          payload: { browser_job_id: data.id },
        }).select("id").single();
        if (e2 || !ap) throw new Error("Couldn't prepare the approval card");
        return { __approval: { id: ap.id as string, summary } };
      }
      await kickCloudWorker();
      const done = await waitForJob(ctx, data.id, jobWaitMs(ctx), 3000);
      if (done && ["done", "failed", "cancelled"].includes(done.status))
        return { job_id: data.id, status: done.status, result: done.result, error: done.error, files: done.files, note: "The cloud browser finished. Answer the user from this result now: say exactly what the result says; a failed task failed." };
      return {
        job_id: data.id, status: "queued",
        note: "It runs now in a cloud browser (the live browser card in this chat shows it). The result is posted into this chat when it finishes; call job_status with job_id to wait for it.",
      };
    },
  }),
  siteLoginTool,
  sitePasswordResetTool,
  siteRegisterTool,
  ...ROUND2_TOOLS,
];

export const BUILTIN_ID = "target";
export const getBuiltin = (name: string) => BUILTIN_TOOLS.find((t) => t.name === name);
