import { z } from "zod";

/** Pure helpers for TARGET's built-in tools (images, charts, files, pages, video, browser steps). */

export const SITE = "https://gettarget.vercel.app";

const SIZES = { square: [1024, 1024], portrait: [832, 1216], landscape: [1216, 832] } as const;
export type ImageSize = keyof typeof SIZES;

/** Free image generation (Pollinations, no key). The URL itself renders the image. */
export function imageUrl(prompt: string, size: ImageSize = "square", seed = Math.floor(Math.random() * 1e9)): string {
  const [w, h] = SIZES[size] ?? SIZES.square;
  const p = prompt.replace(/\s+/g, " ").trim().slice(0, 900);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(p)}?width=${w}&height=${h}&seed=${seed}&nologo=true&model=flux`;
}

export const chartInput = z.object({
  type: z.enum(["bar", "line", "pie", "doughnut", "radar"]).default("bar"),
  title: z.string().max(120).optional(),
  labels: z.array(z.string().max(60)).min(1).max(40),
  datasets: z.array(z.object({ label: z.string().max(60).default(""), data: z.array(z.number().finite()).min(1).max(40) })).min(1).max(6),
});

/** Chart as an image URL (QuickChart, free). Gold-on-dark to match TARGET. */
export function chartUrl(spec: z.infer<typeof chartInput>): string {
  const palette = ["#e6c487", "#7fb3b5", "#c98f6b", "#9aa7d6", "#b5c97f", "#d68fb0"];
  const round = spec.type === "pie" || spec.type === "doughnut";
  const cfg = {
    type: spec.type,
    data: {
      labels: spec.labels,
      datasets: spec.datasets.map((d, i) => ({
        label: d.label, data: d.data,
        backgroundColor: round ? palette : palette[i % palette.length],
        borderColor: palette[i % palette.length], fill: false,
      })),
    },
    options: { plugins: { title: { display: !!spec.title, text: spec.title ?? "", color: "#eeede4" }, legend: { labels: { color: "#eeede4" } } } },
  };
  return `https://quickchart.io/chart?bkg=%2305090c&w=800&h=480&c=${encodeURIComponent(JSON.stringify(cfg))}`;
}

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const h = u.hostname.replace(/^www\.|^m\./, "");
    if (h === "youtu.be") { const id = u.pathname.slice(1, 12); return /^[\w-]{11}$/.test(id) ? id : null; }
    if (h === "youtube.com" || h === "music.youtube.com") {
      const v = u.searchParams.get("v") ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1] ?? null;
      return v && /^[\w-]{11}$/.test(v) ? v : null;
    }
  } catch { /* not a URL */ }
  return null;
}

/** Caption XML/JSON3 → plain text. */
export function captionsToText(body: string): string {
  if (body.trim().startsWith("{")) {
    try {
      const j = JSON.parse(body) as { events?: { segs?: { utf8?: string }[] }[] };
      return (j.events ?? []).map((e) => (e.segs ?? []).map((s) => s.utf8 ?? "").join("")).join(" ").replace(/\s+/g, " ").trim();
    } catch { return ""; }
  }
  return body.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

export function slugFor(title: string, rand = Math.random().toString(36).slice(2, 8)): string {
  const base = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page";
  return `${base}-${rand}`;
}

export const FILE_FORMATS = { pdf: "application/pdf", csv: "text/csv", txt: "text/plain", md: "text/markdown", html: "text/html", json: "application/json" } as const;
export type FileFormat = keyof typeof FILE_FORMATS;

export function fileName(name: string, format: FileFormat): string {
  const base = name.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "target-file";
  return `${base}.${format}`;
}

/** PDF standard fonts only cover Latin-1; swap common typography and drop the rest so generation never throws. */
export function pdfSafe(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/•/g, "-").replace(/₹/g, "Rs ")
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, "?");
}

export function wrapLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) return [line];
  const out: string[] = [];
  let cur = "";
  for (const w of line.split(" ")) {
    if ((cur + " " + w).trim().length > maxChars) { if (cur) out.push(cur); cur = w.length > maxChars ? w.slice(0, maxChars) : w; }
    else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}

export async function makePdf(title: string, content: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(pdfSafe(title)); doc.setProducer("TARGET"); doc.setCreator("TARGET");
  const W = 595, H = 842, M = 50;
  let page = doc.addPage([W, H]);
  let y = H - M;
  page.drawText(pdfSafe(title).slice(0, 90), { x: M, y: y - 6, size: 18, font: bold, color: rgb(0.1, 0.1, 0.1) });
  y -= 36;
  for (const raw of pdfSafe(content).replace(/\t/g, "    ").replace(/\r/g, "").split("\n")) {
    const heading = /^#{1,3}\s/.test(raw);
    const text = raw.replace(/^#{1,3}\s/, "").replace(/\*\*(.+?)\*\*/g, "$1");
    const size = heading ? 13 : 11;
    for (const l of wrapLine(text, heading ? 75 : 92)) {
      if (y < M + 20) { page = doc.addPage([W, H]); y = H - M; }
      page.drawText(l, { x: M, y, size, font: heading ? bold : font, color: rgb(0.15, 0.15, 0.15) });
      y -= size + 5;
    }
    if (!text.trim()) y -= 4;
  }
  return await doc.save();
}

/** Browser steps the AI may plan. Anything that clicks, types or submits needs the user's approval. */
export const browserStep = z.discriminatedUnion("action", [
  z.object({ action: z.literal("goto"), url: z.string().url().max(2000) }),
  z.object({ action: z.literal("click"), selector: z.string().min(1).max(300) }),
  z.object({ action: z.literal("fill"), selector: z.string().min(1).max(300), value: z.string().max(2000) }),
  z.object({ action: z.literal("fill_secret"), selector: z.string().min(1).max(300), secret_id: z.string().uuid(), field: z.enum(["username", "password", "number", "expiry", "cvc", "name", "value"]) }),
  z.object({ action: z.literal("press"), key: z.string().min(1).max(30) }),
  z.object({ action: z.literal("wait"), ms: z.number().int().min(100).max(10000) }),
  z.object({ action: z.literal("extract"), selector: z.string().max(300).optional() }),
]);
export type BrowserStep = z.infer<typeof browserStep>;
export const READ_ONLY_STEPS = new Set(["goto", "wait", "extract"]);
export const stepsNeedApproval = (steps: BrowserStep[]) => steps.some((s) => !READ_ONLY_STEPS.has(s.action));

/** Non-secret preview shown in the vault list (never the secret itself). */
export function vaultPreview(kind: string, fields: Record<string, string>): string {
  if (kind === "login") { const u = fields.username ?? ""; return u.includes("@") ? u.replace(/^(.).*(@.*)$/, "$1•••$2") : u ? `${u.slice(0, 2)}•••` : ""; }
  if (kind === "card") { const n = (fields.number ?? "").replace(/\D/g, ""); return n.length >= 4 ? `•••• ${n.slice(-4)}` : ""; }
  if (kind === "api_key") { const v = fields.value ?? ""; return v.length > 8 ? `${v.slice(0, 3)}•••${v.slice(-2)}` : "•••"; }
  return "";
}

export function luhn(num: string): boolean {
  const d = num.replace(/\D/g, "");
  if (d.length < 12 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) { let n = +d[d.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; }
  return sum % 10 === 0;
}
