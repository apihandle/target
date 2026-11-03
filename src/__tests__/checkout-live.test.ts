// @vitest-environment node
/**
 * LIVE checkout test on the public demo store saucedemo.com, run with a local Chromium:
 *   LIVE_CHECKOUT=1 CHROMIUM_PATH=/path/to/chrome npx vitest run src/__tests__/checkout-live.test.ts
 * The real worker loop (runAuto) and the real worker API route (server guard, sealed cart, approval card) run;
 * only the AI is replaced by a scripted chooser. It goes to the pay page, gets refused on Finish, reports the page,
 * then a fresh browser restores the cart from the sealed state and reaches the same pay page. It NEVER presses Finish.
 * A second test books an appointment on the CURA demo (katalon-demo-cura.herokuapp.com, demo login shown on its page)
 * up to the final "Book Appointment" button, which it never presses.
 * Skipped in normal test runs.
 */
import { describe, it, expect, vi } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

const LIVE = process.env.LIVE_CHECKOUT === "1";
const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fakeSupabase").FakeDb, choose: (() => "") as (s: string, u: string) => string }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));
vi.mock("@/lib/server/kickWorker", () => ({ kickCloudWorker: () => Promise.resolve() }));
vi.mock("@/lib/server/push", () => ({ sendPushToUser: () => Promise.resolve() }));
vi.mock("@/lib/llm", () => ({
  visionModels: () => [],
  llmText: async (o: { messages: { role: string; content: unknown }[] }) => h.choose(String(o.messages[0].content), String(o.messages[1].content)),
}));

import { POST } from "@/app/api/browser-jobs/worker/route";
import { runAuto, restoreState } from "@/lib/server/cloudWorker";
import { checkoutOf, guardCheckout, prepareGoal, type CheckoutInputs } from "@/lib/checkout";
import { decideApproval } from "@/lib/server/approvals";
import type { Snapshot } from "@/lib/server/autoBrowser";
import type { Db } from "@/lib/server/auth";

const U = "11111111-1111-4111-8111-111111111111";
const JOB = "33333333-3333-4333-8333-333333333333";
const SECRET = "l".repeat(40);

const api = (last: { snap?: Snapshot }) => async (body: Record<string, unknown>) => {
  if (body.action === "next") last.snap = body.snapshot as Snapshot;
  const r = await POST(new Request("https://t.test/api/browser-jobs/worker", { method: "POST", headers: { Authorization: `Bearer ${SECRET}` }, body: JSON.stringify(body) }));
  const j = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(j.error));
  return j;
};

/** Stand-in for the model: picks elements by their text on each saucedemo page. */
function scripted(sys: string, page: string): string {
  const url = page.match(/url="([^"]+)"/)?.[1] ?? "";
  const find = (re: RegExp) => { for (const l of page.split("\n")) { const m = l.match(/^\[(\d+)\] (.*)$/); if (m && re.test(m[2])) return Number(m[1]); } return -1; };
  const done = (sys.match(/Done so far: (.*)/)?.[1] ?? "");
  if (/\/checkout-step-two/.test(url)) {
    if (/Pay \$32\.39|approved paying/.test(sys)) return '{"do":"fail","reason":"LIVE TEST STOP before Finish"}';
    if (/SERVER: your last choice was refused/.test(sys)) {
      const total = page.match(/\nTotal: (\$[\d.]+)/)?.[1] ?? "?";
      return JSON.stringify({ do: "ready_to_pay", i: find(/Finish/), items: [{ name: "Sauce Labs Backpack", qty: 1, price: "$29.99" }], total, payment: page.match(/Payment Information:\n(.*)/)?.[1] ?? "" });
    }
    return JSON.stringify({ do: "click", i: find(/Finish/), why: "finish the order" });
  }
  if (/\/checkout-step-one/.test(url)) {
    if (!/fill \[\d+\]: first/.test(done)) return JSON.stringify({ do: "fill", i: find(/First Name/), value: "Test", why: "first" });
    if (!/fill \[\d+\]: last/.test(done)) return JSON.stringify({ do: "fill", i: find(/Last Name/), value: "User", why: "last" });
    if (!/fill \[\d+\]: zip/.test(done)) return JSON.stringify({ do: "fill", i: find(/Zip/), value: "800001", why: "zip" });
    return JSON.stringify({ do: "click", i: find(/Continue/), why: "continue" });
  }
  if (/\/cart\.html/.test(url)) return JSON.stringify({ do: "click", i: find(/^button.*Checkout/), why: "checkout" });
  if (/\/inventory\.html/.test(url)) {
    if (!/add/.test(done)) return JSON.stringify({ do: "click", i: find(/Add to cart/), why: "add backpack" });
    return '{"do":"goto","url":"https://www.saucedemo.com/cart.html","why":"open cart"}';
  }
  if (!/fill \[\d+\]: user/.test(done)) return JSON.stringify({ do: "fill", i: find(/Username/), value: "standard_user", why: "user" });
  if (!/fill \[\d+\]: pass/.test(done)) return JSON.stringify({ do: "fill", i: find(/Password/), value: "secret_sauce", why: "pass (public demo password)" });
  return JSON.stringify({ do: "click", i: find(/Login/), why: "login" });
}

describe.skipIf(!LIVE)("live checkout + booking on demo sites (stop before the final button)", () => {
  it("reaches the pay page, shows the card, and a fresh browser gets the same cart back", async () => {
    process.env.SESSION_WORKER_SECRET = SECRET;
    process.env.CONNECTOR_ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString("base64");
    h.choose = scripted;
    h.db = new FakeDb({ browser_jobs: [], approval_requests: [], messages: [], conversations: [], vault_secrets: [], tasks: [], activity_events: [], connections: [] });
    h.db.as(U);
    const c: CheckoutInputs = { phase: "prepare", merchant: "Swag Labs", site: "saucedemo.com", items: [{ name: "Sauce Labs Backpack", qty: 1 }] };
    h.db.rows("browser_jobs").push({ id: JOB, user_id: U, mode: "auto", goal: "Get Swag Labs checkout ready", status: "running", start_url: "https://www.saucedemo.com/", steps: [], allowed_secrets: [], max_steps: 40, log: [], conversation_id: "c1", claimed_at: new Date().toISOString(), inputs: { checkout: { ...c, goal: prepareGoal(c) } } });

    const { chromium } = await import("playwright-core");
    const px = process.env.HTTPS_PROXY || process.env.https_proxy;
    const proxy = px ? (() => { const u = new URL(px); return { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) }; })() : undefined;
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, proxy });
    try {
      const last: { snap?: Snapshot } = {};
      const ctx1 = await browser.newContext({ ignoreHTTPSErrors: true });
      const page1 = await ctx1.newPage();
      page1.setDefaultTimeout(15000);
      const out = await runAuto({ id: JOB, mode: "auto", start_url: "https://www.saucedemo.com/", max_steps: 40 }, page1, api(last), Date.now() + 120000);
      await api(last)({ action: "finish", job_id: JOB, status: "done", result: out });
      const log = h.db.rows("browser_jobs").find((r) => r.id === JOB)!.log as string[];
      console.log("prepare log:", log.join(" | "));
      expect(out).toMatch(/Stopped at the pay step. Total on the page: \$32\.39/);
      expect(page1.url()).toContain("checkout-step-two"); // Finish was never pressed
      const ap = h.db.rows("approval_requests")[0];
      expect(ap.payload).toMatchObject({ total: "$32.39", payment: "SauceCard #31337" });
      console.log("approval card:", ap.summary, JSON.stringify(ap.payload));
      await ctx1.close();

      // Approve -> the pay job; a NEW browser gets the cart back and opens the pay page.
      expect((await decideApproval(h.db as unknown as Db, U, ap.id as string, "approve")).status).toBe(200);
      const payJob = h.db.rows("browser_jobs").find((r) => r.id !== JOB)!;
      Object.assign(payJob, { status: "running", claimed_at: new Date().toISOString() });
      const { state } = await api(last)({ action: "checkout_state", job_id: payJob.id }) as { state: Parameters<typeof restoreState>[1] };
      const ctx2 = await browser.newContext({ ignoreHTTPSErrors: true });
      await restoreState(ctx2, state);
      const page2 = await ctx2.newPage();
      page2.setDefaultTimeout(15000);
      await expect(runAuto({ id: payJob.id as string, mode: "auto", start_url: payJob.start_url as string, max_steps: 20 }, page2, api(last), Date.now() + 60000)).rejects.toThrow(/LIVE TEST STOP/);
      expect(page2.url()).toContain("checkout-step-two");
      expect(last.snap?.text).toMatch(/Sauce Labs Backpack[\s\S]*Total: \$32\.39/);
      // The server WOULD allow the Finish press here (approved total on the page) — not pressed in this test.
      const cur = checkoutOf(payJob.inputs)!;
      const fin = last.snap!.elements.find((e) => e.text === "Finish")!;
      expect(guardCheckout(cur, { do: "click", i: fin.i, why: "" }, last.snap!, [])).toMatchObject({ pays: true });
      await ctx2.close();
    } finally { await browser.close(); }
  }, 240000);

  it("booking: fills the appointment, is refused on Book Appointment, shows the card, and the confirm job gets the session back", async () => {
    process.env.SESSION_WORKER_SECRET = SECRET;
    process.env.CONNECTOR_ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString("base64");
    h.choose = curaScripted;
    h.db = new FakeDb({ browser_jobs: [], approval_requests: [], messages: [], conversations: [], vault_secrets: [], tasks: [], activity_events: [], connections: [] });
    h.db.as(U);
    const c: CheckoutInputs = { phase: "prepare", kind: "booking", merchant: "CURA Healthcare", site: "katalon-demo-cura.herokuapp.com", items: [], what: "appointment at Hongkong CURA Healthcare Center", when: "10/12/2026", details: "comment: Test booking" };
    const start = "https://katalon-demo-cura.herokuapp.com/";
    h.db.rows("browser_jobs").push({ id: JOB, user_id: U, mode: "auto", goal: "Get the booking ready", status: "running", start_url: start, steps: [], allowed_secrets: [], max_steps: 40, log: [], conversation_id: "c1", claimed_at: new Date().toISOString(), inputs: { checkout: { ...c, goal: prepareGoal(c) } } });
    const { chromium } = await import("playwright-core");
    const px = process.env.HTTPS_PROXY || process.env.https_proxy;
    const proxy = px ? (() => { const u = new URL(px); return { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) }; })() : undefined;
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, proxy });
    try {
      const last: { snap?: Snapshot } = {};
      const ctx1 = await browser.newContext({ ignoreHTTPSErrors: true });
      const page1 = await ctx1.newPage();
      page1.setDefaultTimeout(15000);
      const out = await runAuto({ id: JOB, mode: "auto", start_url: start, max_steps: 40 }, page1, api(last), Date.now() + 120000)
        .catch((e) => { console.log("log:", (h.db.rows("browser_jobs").find((r) => r.id === JOB)!.log as string[]).slice(0, 12).join(" | "), "\nlast page:", JSON.stringify(last.snap?.elements.slice(0, 25))); throw e; });
      await api(last)({ action: "finish", job_id: JOB, status: "done", result: out });
      console.log("booking prepare log:", (h.db.rows("browser_jobs").find((r) => r.id === JOB)!.log as string[]).join(" | "));
      expect(out).toMatch(/Stopped before the final confirm/);
      expect(page1.url()).toContain("#appointment"); // Book Appointment was never pressed
      const ap = h.db.rows("approval_requests")[0];
      expect(ap).toMatchObject({ action_type: "reservation" });
      expect(ap.payload).toMatchObject({ when: "10/12/2026" });
      console.log("booking card:", ap.summary, JSON.stringify(ap.payload));
      await ctx1.close();

      expect((await decideApproval(h.db as unknown as Db, U, ap.id as string, "approve")).status).toBe(200);
      const confirmJob = h.db.rows("browser_jobs").find((r) => r.id !== JOB)!;
      Object.assign(confirmJob, { status: "running", claimed_at: new Date().toISOString() });
      const { state } = await api(last)({ action: "checkout_state", job_id: confirmJob.id }) as { state: Parameters<typeof restoreState>[1] };
      const ctx2 = await browser.newContext({ ignoreHTTPSErrors: true });
      await restoreState(ctx2, state);
      const page2 = await ctx2.newPage();
      page2.setDefaultTimeout(15000);
      await expect(runAuto({ id: confirmJob.id as string, mode: "auto", start_url: confirmJob.start_url as string, max_steps: 20 }, page2, api(last), Date.now() + 60000)).rejects.toThrow(/LIVE TEST STOP/);
      expect(page2.url()).toContain("#appointment"); // still signed in (session restored), on the form
      const cur = checkoutOf(confirmJob.inputs)!;
      const btn = last.snap!.elements.find((e) => /Book Appointment/.test(e.text))!;
      expect(guardCheckout(cur, { do: "click", i: btn.i, why: "" }, last.snap!, [])).toMatchObject({ pays: true });
      await ctx2.close();
    } finally { await browser.close(); }
  }, 240000);
});

/** Stand-in for the model on the CURA demo. */
function curaScripted(sys: string, page: string): string {
  const url = page.match(/url="([^"]+)"/)?.[1] ?? "";
  const find = (re: RegExp) => { for (const l of page.split("\n")) { const m = l.match(/^\[(\d+)\] (.*)$/); if (m && re.test(m[2])) return Number(m[1]); } return -1; };
  const confirm = /approved booking/.test(sys);
  if (/#appointment/.test(url)) {
    if (find(/facility = Hongkong/) < 0) return JSON.stringify({ do: "select", i: find(/^select/), value: "Hongkong CURA Healthcare Center", why: "facility" });
    if (find(/= 10\/12\/2026/) < 0) return JSON.stringify({ do: "fill", i: find(/dd\/mm\/yyyy/), value: "10/12/2026", why: "date" });
    if (!confirm && find(/Comment = Test booking/) < 0) return JSON.stringify({ do: "fill", i: find(/^textarea/), value: "Test booking", why: "comment" });
    if (confirm) return '{"do":"fail","reason":"LIVE TEST STOP before Book Appointment"}';
    if (/SERVER: your last choice was refused/.test(sys)) return JSON.stringify({ do: "ready_to_confirm", i: find(/Book Appointment/), what: "Hongkong CURA Healthcare Center appointment", when: "10/12/2026", details: "Comment: Test booking", price: "" });
    return JSON.stringify({ do: "click", i: find(/Book Appointment/), why: "book" });
  }
  if (/profile\.php/.test(url)) {
    const done = sys.match(/Done so far: (.*)/)?.[1] ?? "";
    if (!/fill \[\d+\]: user/.test(done)) return JSON.stringify({ do: "fill", i: find(/name=username/), value: "John Doe", why: "user (demo login shown on the page)" });
    if (!/fill \[\d+\]: pass/.test(done)) return JSON.stringify({ do: "fill", i: find(/name=password/), value: "ThisIsNotAPassword", why: "pass (demo login shown on the page)" });
    return JSON.stringify({ do: "click", i: find(/^button.*Login/), why: "login" });
  }
  return JSON.stringify({ do: "click", i: find(/Make Appointment/), why: "open the form" });
}
