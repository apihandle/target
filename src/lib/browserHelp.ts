import { z } from "zod";

/**
 * Captcha hand-off. The worker never breaks a captcha: it shows the page to the owner, who taps or types
 * on the screenshot from their phone, and the worker repeats those taps on the real page.
 */
export const HELP_KEYS = ["Enter", "Tab", "Backspace", "Escape"] as const;
export const MAX_HELP_INPUTS = 60;
export const HELP_TIMEOUT_MS = 5 * 60 * 1000;

/** What the owner can send: a tap at a spot on the screenshot (0..1 of its width and height), text, a key, or "done". */
export const helpInput = z.discriminatedUnion("t", [
  z.object({ t: z.literal("tap"), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  z.object({ t: z.literal("type"), text: z.string().min(1).max(200) }),
  z.object({ t: z.literal("key"), key: z.enum(HELP_KEYS) }),
  z.object({ t: z.literal("done") }),
]);
export type HelpInput = z.infer<typeof helpInput>;
export type QueuedInput = HelpInput & { seq: number };

/** Add one input with the next sequence number; keeps only the newest MAX_HELP_INPUTS. */
export function appendInput(list: unknown, input: HelpInput): QueuedInput[] {
  const old = (Array.isArray(list) ? list : []).filter((i): i is QueuedInput => !!i && typeof (i as QueuedInput).seq === "number");
  const seq = old.reduce((m, i) => Math.max(m, i.seq), 0) + 1;
  return [...old, { ...input, seq }].slice(-MAX_HELP_INPUTS);
}

/** Inputs the worker hasn't applied yet, in order. */
export function inputsAfter(list: unknown, after: number): QueuedInput[] {
  return (Array.isArray(list) ? list : []).filter((i): i is QueuedInput => !!i && typeof (i as QueuedInput).seq === "number" && (i as QueuedInput).seq > after)
    .sort((a, b) => a.seq - b.seq);
}

/**
 * The same check the worker runs: a VISIBLE captcha frame (the caller passes only frames at least 100x60 px,
 * so invisible reCAPTCHA badges don't count), or a "verify you're human" page.
 */
const CAPTCHA_FRAME = /recaptcha|hcaptcha|challenges\.cloudflare\.com|turnstile|arkoselabs|funcaptcha|geo\.captcha-delivery/i;
const CAPTCHA_TEXT = /(verify (that )?you('| a)re (a )?human|i'?m not a robot|are you a robot|complete the security check|press (&|and) hold|unusual traffic from your computer|type the (characters|text) (you see|in the image))/i;
export function looksLikeCaptcha(frameUrls: string[], pageText: string): boolean {
  return frameUrls.some((u) => CAPTCHA_FRAME.test(u)) || CAPTCHA_TEXT.test(pageText.slice(0, 4000));
}

/** Map a tap on the shown screenshot to the page's own pixels. */
export function tapToPixels(x: number, y: number, w: number, h: number): { px: number; py: number } {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { px: Math.round(clamp(x) * w), py: Math.round(clamp(y) * h) };
}
