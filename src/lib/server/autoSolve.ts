import type { Page } from "playwright-core";

/**
 * Automatic Cloudflare / Turnstile solving, tried before a job ever pauses for the user.
 *
 * Layers, cheapest first (each one only when it applies):
 *  1. click   Free. A real (CDP, isTrusted) mouse click on the Turnstile checkbox inside its iframe, then wait for the
 *             token. This is what open-source solvers do; it passes when Cloudflare scores the browser as human enough.
 *  2. service Free if self-hosted: an open-source solver server (sarperavci/CloudflareBypassForScraping, MIT) at
 *             CF_SOLVER_URL (+ CF_SOLVER_TOKEN sent as x-auth-token). GET /turnstile?url&sitekey returns a token that is
 *             injected into the form. Off unless CF_SOLVER_URL is set.
 *  3. paid    CapSolver AntiTurnstileTaskProxyLess when CAPSOLVER_API_KEY is set ($1.20 / 1000 on their pricing page,
 *             checked 2026-11-05). Off unless the owner sets the key.
 * The cloud browsers' own solvers (STEEL_SOLVE_CAPTCHA, HYPERBROWSER_SOLVE_CAPTCHAS, BROWSERLESS_SOLVE_CAPTCHAS,
 * ANCHOR_SOLVE_CAPTCHA) are switched on when the session starts (remoteBrowser.ts); this module just waits for them.
 *
 * Only tokens and clicks: no answers are invented, nothing is submitted here. The caller re-checks the page.
 */
type Env = Record<string, string | undefined>;

export type TurnstileInfo = { sitekey: string | null; action: string | null; cdata: string | null; callback: string | null; frame: { x: number; y: number; width: number; height: number } | null };
export type SolveAttempt = { method: "click" | "service" | "capsolver" | "provider"; ok: boolean; detail: string };

const SITEKEY = /^[0-9]x[0-9A-Za-z_-]{10,60}$/;

/** Sitekey and checkbox position of the Turnstile widget on the page (from the container, else the iframe URL). */
export async function turnstileInfo(page: Page): Promise<TurnstileInfo> {
  const frameEl = page.frames().find((f) => /challenges\.cloudflare\.com/i.test(f.url()));
  let fromFrame: string | null = null;
  if (frameEl) {
    // The iframe URL carries the sitekey as a path segment: .../turnstile/if/ov2/av0/rcv0/0/<id>/0x4AAA.../auto/...
    const m = frameEl.url().match(/\/(0x[0-9A-Za-z_-]{10,60})\//);
    if (m) fromFrame = m[1];
  }
  const d = await page.evaluate(() => {
    const box = document.querySelector<HTMLElement>(".cf-turnstile[data-sitekey], [data-sitekey][class*='turnstile'], div[data-sitekey]");
    const ifr = Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe")).find((f) => /challenges\.cloudflare\.com/.test(f.src))
      // Turnstile renders inside a closed shadow root on newer pages: fall back to the container's own box.
      ?? null;
    const el: HTMLElement | null = ifr ?? box;
    const r = el ? el.getBoundingClientRect() : null;
    return {
      sitekey: box?.getAttribute("data-sitekey") ?? null, action: box?.getAttribute("data-action") ?? null, cdata: box?.getAttribute("data-cdata") ?? null,
      callback: box?.getAttribute("data-callback") ?? null,
      frame: r && r.width > 20 && r.height > 20 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null,
    };
  }).catch(() => ({ sitekey: null, action: null, cdata: null, callback: null, frame: null }));
  const sitekey = d.sitekey && SITEKEY.test(d.sitekey) ? d.sitekey : fromFrame;
  let frame = d.frame;
  if (!frame && frameEl) {
    const b = await frameEl.frameElement().then((h) => h.boundingBox()).catch(() => null);
    if (b && b.width > 20) frame = b;
  }
  return { sitekey, action: d.action, cdata: d.cdata, callback: d.callback && /^[A-Za-z_$][\w$.]{0,80}$/.test(d.callback) ? d.callback : null, frame };
}

/** Has a Turnstile token been issued on the page? */
export async function tokenIssued(page: Page): Promise<boolean> {
  return page.evaluate(() => Array.from(document.querySelectorAll<HTMLInputElement>("input[name='cf-turnstile-response']")).some((i) => i.value.length > 20)).catch(() => false);
}

/** Put a token into the form the way the widget would: every response box, getResponse(), and the page's callback. */
export async function injectToken(page: Page, token: string, callback: string | null): Promise<void> {
  await page.evaluate(({ token, callback }) => {
    for (const i of Array.from(document.querySelectorAll<HTMLInputElement>("input[name='cf-turnstile-response'], textarea[name='cf-turnstile-response']"))) i.value = token;
    const forms = Array.from(document.querySelectorAll<HTMLElement>(".cf-turnstile, [data-sitekey]"));
    for (const f of forms) {
      if (!f.querySelector("input[name='cf-turnstile-response']")) {
        const inp = document.createElement("input");
        inp.type = "hidden"; inp.name = "cf-turnstile-response"; inp.value = token;
        f.appendChild(inp);
      }
    }
    const w = window as unknown as { turnstile?: { getResponse?: () => string; isExpired?: () => boolean } } & Record<string, unknown>;
    if (w.turnstile) { w.turnstile.getResponse = () => token; w.turnstile.isExpired = () => false; }
    const fns: unknown[] = [];
    if (callback) fns.push(callback.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), w));
    // Pages that render the widget from JS keep their callbacks in a window.turnstileCallbacks map (TimeBucks: its Log In
    // button stays disabled until the form's callback runs). Hooking turnstile.render instead breaks api.js ("already loaded").
    const map = w.turnstileCallbacks;
    if (map && typeof map === "object") fns.push(...Object.values(map as Record<string, unknown>));
    for (const fn of new Set(fns)) if (typeof fn === "function") { try { (fn as (t: string) => void)(token); } catch { /* the page's own callback */ } }
  }, { token, callback });
}

/** Wait until a token shows up or the check is gone. */
async function waitSolved(page: Page, ms: number, gone: () => Promise<boolean>): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await tokenIssued(page)) || (await gone().catch(() => false))) return true;
    await page.waitForTimeout(1000).catch(() => {});
  }
  return false;
}

/** Layer 1: a real mouse click on the checkbox (left part of the widget, vertically centred). */
export async function clickCheckbox(page: Page, info: TurnstileInfo): Promise<boolean> {
  if (!info.frame) return false;
  const x = info.frame.x + Math.min(30, info.frame.width / 6) + Math.random() * 4;
  const y = info.frame.y + info.frame.height / 2 + (Math.random() * 4 - 2);
  await page.mouse.move(x - 40 - Math.random() * 30, y - 20 - Math.random() * 10, { steps: 6 }).catch(() => {});
  await page.waitForTimeout(150 + Math.random() * 200).catch(() => {});
  await page.mouse.move(x, y, { steps: 8 }).catch(() => {});
  await page.mouse.down().catch(() => {});
  await page.waitForTimeout(60 + Math.random() * 60).catch(() => {});
  await page.mouse.up().catch(() => {});
  return true;
}

/** Layer 2: the self-hosted solver server. */
export async function serviceToken(env: Env, url: string, info: TurnstileInfo, f: typeof fetch = fetch): Promise<string | null> {
  const base = env.CF_SOLVER_URL?.replace(/\/+$/, "");
  if (!base || !info.sitekey || !/^https:\/\//.test(base)) return null;
  const q = new URLSearchParams({ url, sitekey: info.sitekey, ...(info.action ? { action: info.action } : {}), ...(info.cdata ? { cdata: info.cdata } : {}) });
  const r = await f(`${base}/turnstile?${q}`, { headers: env.CF_SOLVER_TOKEN ? { "x-auth-token": env.CF_SOLVER_TOKEN } : {}, signal: AbortSignal.timeout(60000) });
  if (!r.ok) return null;
  const j = (await r.json().catch(() => ({}))) as { token?: unknown; result?: { token?: unknown } };
  const t = typeof j.token === "string" ? j.token : typeof j.result?.token === "string" ? j.result.token : null;
  return t && t.length > 20 ? t : null;
}

/** Layer 3 (paid, off unless CAPSOLVER_API_KEY is set): CapSolver's Turnstile task. */
export async function capsolverToken(env: Env, url: string, info: TurnstileInfo, f: typeof fetch = fetch, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<string | null> {
  const key = env.CAPSOLVER_API_KEY;
  if (!key || !info.sitekey) return null;
  const post = async (path: string, body: unknown) => {
    const r = await f(`https://api.capsolver.com/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    return (await r.json().catch(() => ({}))) as Record<string, unknown>;
  };
  const created = await post("createTask", { clientKey: key, task: { type: "AntiTurnstileTaskProxyLess", websiteURL: url, websiteKey: info.sitekey, ...(info.action || info.cdata ? { metadata: { ...(info.action ? { action: info.action } : {}), ...(info.cdata ? { cdata: info.cdata } : {}) } } : {}) } });
  const taskId = typeof created.taskId === "string" ? created.taskId : null;
  if (!taskId) return null;
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    const r = await post("getTaskResult", { clientKey: key, taskId });
    if (r.status === "ready") { const t = (r.solution as { token?: unknown } | undefined)?.token; return typeof t === "string" ? t : null; }
    if (r.errorId && r.errorId !== 0) return null;
  }
  return null;
}

/**
 * Try every automatic layer once on the current page. `gone` re-checks the page (true = no blocking check left).
 * Returns what was tried; ok on the first layer that cleared the check.
 */
export async function autoSolve(page: Page, gone: () => Promise<boolean>, opts: { env?: Env; log?: (line: string) => Promise<unknown>; providerSolver?: boolean; fetch?: typeof fetch } = {}): Promise<{ ok: boolean; attempts: SolveAttempt[] }> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? (async () => {});
  const attempts: SolveAttempt[] = [];
  const done = (a: SolveAttempt) => { attempts.push(a); return a.ok; };
  // The cloud browser's own solver (switched on at session start) gets a short head start.
  if (opts.providerSolver) {
    await log("Waiting for the cloud browser's captcha solver");
    if (done({ method: "provider", ok: await waitSolved(page, 15000, gone), detail: "provider solver" })) return { ok: true, attempts };
  }
  let info = await turnstileInfo(page);
  for (let i = 0; i < 2 && info.frame; i++) {
    await log(`Clicking the Cloudflare check box (${i + 1}/2)`);
    await clickCheckbox(page, info);
    if (done({ method: "click", ok: await waitSolved(page, 10000, gone), detail: `click ${i + 1}` })) return { ok: true, attempts };
    info = await turnstileInfo(page);
  }
  const url = page.url();
  for (const [method, get] of [["service", serviceToken], ["capsolver", capsolverToken]] as const) {
    if (method === "service" && !env.CF_SOLVER_URL) continue;
    if (method === "capsolver" && !env.CAPSOLVER_API_KEY) continue;
    if (!info.sitekey) { attempts.push({ method, ok: false, detail: "no sitekey on the page" }); continue; }
    await log(method === "service" ? "Asking the Turnstile solver service for a token" : "Asking CapSolver for a Turnstile token");
    const token = await get(env, url, info, opts.fetch ?? fetch).catch(() => null);
    if (!token) { attempts.push({ method, ok: false, detail: "no token" }); continue; }
    await injectToken(page, token, info.callback);
    if (done({ method, ok: await waitSolved(page, 4000, gone), detail: "token injected" })) return { ok: true, attempts };
  }
  return { ok: false, attempts };
}

/** Is a cloud-browser captcha solver switched on for this provider? (Read by the worker to give it a head start.) */
export function providerSolverOn(provider: string, env: Env = process.env): boolean {
  const on = (v: string | undefined) => v === "1" || v === "true";
  return (provider === "steel" && on(env.STEEL_SOLVE_CAPTCHA)) || (provider === "hyperbrowser" && on(env.HYPERBROWSER_SOLVE_CAPTCHAS))
    || (provider === "browserless" && on(env.BROWSERLESS_SOLVE_CAPTCHAS)) || (provider === "anchor" && on(env.ANCHOR_SOLVE_CAPTCHA));
}
