/**
 * Store checkout: the browser goes to the pay step and stops; the approval card shows what the page showed; the pay
 * job presses the final button once, only at the approved total.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fakeSupabase").FakeDb, replies: [] as string[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));
vi.mock("@/lib/server/kickWorker", () => ({ kickCloudWorker: () => Promise.resolve() }));
vi.mock("@/lib/server/push", () => ({ sendPushToUser: () => Promise.resolve() }));
vi.mock("@/lib/llm", () => ({ llmText: async () => h.replies.shift() ?? "", visionModels: () => [] }));

import { checkoutOf, guardCheckout, isPayElement, PAY_PRESSED, prepareGoal, totalMatches, totalsOnPage, userAskedToBuy, type CheckoutInputs } from "@/lib/checkout";
import { getBuiltin } from "@/lib/builtins/tools";
import { decideApproval } from "@/lib/server/approvals";
import { canReadWithoutBrowser } from "@/lib/server/cloudWorker";
import { POST } from "@/app/api/browser-jobs/worker/route";
import type { Snapshot } from "@/lib/server/autoBrowser";
import type { Db } from "@/lib/server/auth";

const U = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const LOGIN = "44444444-4444-4444-8444-444444444444";
const JOB = "33333333-3333-4333-8333-333333333333";
const SECRET = "w".repeat(40);
const KEY = Buffer.alloc(32, 9).toString("base64");
const env = { key: undefined as string | undefined, secret: undefined as string | undefined };

beforeEach(() => {
  env.key = process.env.CONNECTOR_ENCRYPTION_KEY; env.secret = process.env.SESSION_WORKER_SECRET;
  process.env.CONNECTOR_ENCRYPTION_KEY = KEY; process.env.SESSION_WORKER_SECRET = SECRET;
  h.replies = [];
  h.db = new FakeDb({
    browser_jobs: [], approval_requests: [], messages: [], conversations: [{ id: "c1", user_id: U }], tasks: [], activity_events: [], connections: [],
    vault_secrets: [{ id: CARD, user_id: U, kind: "card", label: "HDFC card", preview: "•••• 4242", secret_box: "x" }, { id: LOGIN, user_id: U, kind: "login", label: "shop", site: "shop.example", secret_box: "x" }],
  });
  h.db.as(U);
});
afterEach(() => {
  if (env.key === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY; else process.env.CONNECTOR_ENCRYPTION_KEY = env.key;
  if (env.secret === undefined) delete process.env.SESSION_WORKER_SECRET; else process.env.SESSION_WORKER_SECRET = env.secret;
});

// The real saucedemo.com checkout overview, as the worker's snapshot sees it.
const OVERVIEW: Snapshot = {
  url: "https://www.saucedemo.com/checkout-step-two.html", title: "Swag Labs",
  text: "Checkout: Overview\nQTY\nDescription\n1\nSauce Labs Backpack\ncarry.allTheThings() with the sleek, streamlined Sly Pack\n$29.99\nPayment Information:\nSauceCard #31337\nShipping Information:\nFree Pony Express Delivery!\nPrice Total\nItem total: $29.99\nTax: $2.40\nTotal: $32.39\nCancel\nFinish",
  elements: [{ i: 0, tag: "a", text: "Sauce Labs Backpack" }, { i: 1, tag: "button", text: "Cancel", name: "cancel" }, { i: 2, tag: "button", text: "Finish", name: "finish" }],
};
const prep: CheckoutInputs = { phase: "prepare", merchant: "Swag Labs", site: "saucedemo.com", items: [{ name: "Sauce Labs Backpack", qty: 1 }], payment_secret_id: CARD };
const pay: CheckoutInputs = { ...prep, phase: "pay", approved: { items: [{ name: "Sauce Labs Backpack", qty: 1, price: "$29.99" }], total: "$32.39", payment: "SauceCard #31337" } };

describe("reading the pay page", () => {
  it("finds the total to pay, not the subtotal or item total", () => {
    expect(totalsOnPage(OVERVIEW)).toEqual([32.39]);
    expect(totalMatches(OVERVIEW, "$32.39")).toBe("yes");
    expect(totalMatches(OVERVIEW, "$29.99")).toBe("no");
    expect(totalMatches({ text: "Subtotal ₹1,000\nDiscount -₹200\nGrand Total\n₹800.00", elements: [] }, "₹800")).toBe("yes");
    expect(totalMatches({ text: "Your cart", elements: [{ i: 0, tag: "button", text: "Pay ₹1,299" }] }, "Rs 1299")).toBe("yes");
    expect(totalMatches({ text: "Shipping address", elements: [] }, "$5")).toBe("unknown");
  });
  it("knows the final buttons from the ones that only move along", () => {
    for (const t of ["Finish", "Place Order", "Place your order", "Pay ₹1,299", "Pay now", "Confirm Order", "Buy Now", "Pay"]) expect(isPayElement({ tag: "button", text: t })).toBe(true);
    for (const t of ["Checkout", "Proceed to checkout", "Continue", "Add to cart", "Payment method", "Cancel"]) expect(isPayElement({ tag: "button", text: t })).toBe(false);
    expect(isPayElement({ tag: "label", text: "Pay on delivery" })).toBe(false);
    expect(isPayElement({ tag: "input", type: "radio", text: "Pay now with UPI" })).toBe(false);
  });
  it("starts only when the user asked to buy", () => {
    expect(userAskedToBuy(["saucedemo pe backpack kharid lo"])).toBe(true);
    expect(userAskedToBuy(["order a backpack on saucedemo.com"])).toBe(true);
    expect(userAskedToBuy(["backpack ka price kya hai?"])).toBe(false);
    expect(userAskedToBuy([])).toBe(false);
  });
  it("tells the agent to stop at the pay step and never type a card", () => {
    const g = prepareGoal(prep);
    expect(g).toMatch(/STOP there/);
    expect(g).toMatch(/ready_to_pay/);
    expect(g).toMatch(/Never type a card number/);
    expect(g).not.toContain(CARD); // the card isn't even offered to the prepare job
  });
});

describe("server guard", () => {
  it("prepare: the final button, card fields and Enter on the pay page are refused", () => {
    expect(guardCheckout(prep, { do: "click", i: 2, why: "" }, OVERVIEW, [])).toHaveProperty("retry");
    expect(guardCheckout(prep, { do: "fill_secret", i: 0, secret_id: CARD, field: "number", why: "" }, OVERVIEW, [])).toHaveProperty("retry");
    expect(guardCheckout(prep, { do: "press", key: "Enter", why: "" }, OVERVIEW, [])).toHaveProperty("retry");
    expect(guardCheckout(prep, { do: "done", result: "bought" }, OVERVIEW, [])).toHaveProperty("retry");
    expect(guardCheckout(prep, { do: "click", i: 1, why: "" }, OVERVIEW, [])).toEqual({ action: { do: "click", i: 1, why: "" } });
  });
  it("prepare: ready_to_pay must name the button and copy the page's total", () => {
    const r = (total: string, i = 2) => guardCheckout(prep, { do: "ready_to_pay", i, items: [{ name: "Sauce Labs Backpack", qty: 1, price: "$29.99" }], total, payment: "SauceCard #31337", why: "" }, OVERVIEW, []);
    expect(r("$29.99")).toHaveProperty("retry");
    expect(r("$32.39", 9)).toHaveProperty("retry");
    expect(r("$32.39")).toHaveProperty("action.do", "ready_to_pay");
  });
  it("pay: presses once, only at the approved total", () => {
    expect(guardCheckout(pay, { do: "click", i: 2, why: "" }, OVERVIEW, [])).toEqual({ action: { do: "click", i: 2, why: "" }, pays: true });
    const changed = { ...OVERVIEW, text: OVERVIEW.text.replace("Total: $32.39", "Total: $35.10") };
    expect(guardCheckout(pay, { do: "click", i: 2, why: "" }, changed, [])).toEqual({ action: { do: "fail", reason: "TOTAL_CHANGED 35.1" } });
    expect(guardCheckout(pay, { do: "click", i: 2, why: "" }, { ...OVERVIEW, text: "Checkout" }, [])).toEqual({ action: { do: "fail", reason: "TOTAL_UNSEEN" } });
    expect(guardCheckout(pay, { do: "click", i: 2, why: "" }, OVERVIEW, ["click [2]", PAY_PRESSED])).toHaveProperty("action.do", "done");
  });
});

const call = (body: Record<string, unknown>) => POST(new Request("https://t.test/api/browser-jobs/worker", { method: "POST", headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const job = (id: string) => h.db.rows("browser_jobs").find((r) => r.id === id)!;

describe("checkout tool", () => {
  const ctx = (userTexts: string[]) => ({ db: h.db.admin() as unknown as Db, userId: U, conversationId: "c1", userTexts });
  const args = { merchant: "Swag Labs", start_url: "https://www.saucedemo.com/", items: [{ name: "Sauce Labs Backpack", qty: 1 }], payment_secret_id: CARD, login_secret_id: LOGIN, deliver_to: "", details: "first name Test, last name User, zip 800001" };
  it("refuses unless the user asked to buy", async () => {
    expect(await getBuiltin("checkout")!.execute(args, ctx(["what does it cost?"]))).toMatchObject({ status: "not_requested" });
    expect(h.db.rows("browser_jobs")).toHaveLength(0);
  });
  it("queues a prepare job that can read the store login but not the card", async () => {
    const out = await getBuiltin("checkout")!.execute(args, ctx(["saucedemo.com pe backpack order karo"])) as { status: string };
    expect(out.status).toBe("started");
    const j = h.db.rows("browser_jobs")[0];
    expect(j).toMatchObject({ mode: "auto", status: "queued", allowed_secrets: [LOGIN] });
    expect(checkoutOf(j.inputs)).toMatchObject({ phase: "prepare", site: "saucedemo.com", payment_secret_id: CARD });
    expect(canReadWithoutBrowser(j as never)).toBe(false);
    expect(h.db.rows("approval_requests")).toHaveLength(0);
  });
});

describe("end to end through the worker API", () => {
  it("prepare -> approval card with the page's total -> approve -> pay stops when the total changed", async () => {
    h.db.rows("browser_jobs").push({ id: JOB, user_id: U, mode: "auto", goal: "Get Swag Labs checkout ready", status: "running", start_url: "https://www.saucedemo.com/", steps: [], allowed_secrets: [], max_steps: 40, log: [], conversation_id: "c1", claimed_at: new Date().toISOString(), inputs: { checkout: { ...prep, goal: prepareGoal(prep) } } });
    // The model tries the Finish button first: refused on the server, then it reports the pay page.
    h.replies = ['{"do":"click","i":2,"why":"finish order"}', '{"do":"ready_to_pay","i":2,"items":[{"name":"Sauce Labs Backpack","qty":1,"price":"$29.99"}],"total":"$32.39","payment":"SauceCard #31337"}'];
    const next = await (await call({ action: "next", job_id: JOB, snapshot: OVERVIEW })).json();
    expect(next.action).toMatchObject({ do: "ready_to_pay", total: "$32.39" });
    const state = { cookies: [{ name: "session-username", value: "standard_user", domain: "www.saucedemo.com", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" }], origins: [{ origin: "https://www.saucedemo.com", localStorage: [{ name: "cart-contents", value: "[4]" }] }] };
    expect((await call({ action: "checkout_ready", job_id: JOB, state, url: OVERVIEW.url })).status).toBe(200);
    expect(JSON.stringify(job(JOB).inputs)).not.toContain("standard_user"); // sealed
    expect((await call({ action: "finish", job_id: JOB, status: "done", result: "Stopped at the pay step" })).status).toBe(200);

    const payJob = h.db.rows("browser_jobs").find((r) => r.id !== JOB)!;
    expect(payJob).toMatchObject({ status: "needs_approval", start_url: OVERVIEW.url, allowed_secrets: [CARD] });
    const ap = h.db.rows("approval_requests")[0];
    expect(ap).toMatchObject({ action_type: "purchase", status: "pending", summary: "Pay $32.39 at Swag Labs" });
    expect(ap.payload).toMatchObject({ browser_job_id: payJob.id, total: "$32.39", payment: "SauceCard #31337", items: [{ name: "Sauce Labs Backpack", qty: 1, price: "$29.99" }] });
    const msg = h.db.rows("messages").at(-1)!;
    expect(String(msg.content)).toContain(`"type":"approval","id":"${ap.id}"`);
    expect(String(msg.content)).toMatch(/Place order/);

    // Nothing runs before the tap; the tap queues the pay job.
    expect(job(payJob.id as string).status).toBe("needs_approval");
    const r = await decideApproval(h.db as unknown as Db, U, ap.id as string, "approve");
    expect(r.status).toBe(200);
    expect(job(payJob.id as string).status).toBe("queued");

    // The worker claims it and gets the cart back.
    Object.assign(job(payJob.id as string), { status: "running", claimed_at: new Date().toISOString() });
    const st = await (await call({ action: "checkout_state", job_id: payJob.id })).json();
    expect(st.state.origins[0].localStorage[0]).toEqual({ name: "cart-contents", value: "[4]" });
    // The prepare job can't fetch it.
    expect((await call({ action: "checkout_state", job_id: JOB })).status).toBe(409);

    // The store raised the total: the server refuses to press Finish, whatever the model says.
    h.replies = ['{"do":"click","i":2,"why":"pay"}'];
    const changed = { ...OVERVIEW, text: OVERVIEW.text.replace("Total: $32.39", "Total: $35.10") };
    const n2 = await (await call({ action: "next", job_id: payJob.id, snapshot: changed })).json();
    expect(n2.action).toEqual({ do: "fail", reason: "TOTAL_CHANGED 35.1" });
    await call({ action: "finish", job_id: payJob.id, status: "failed", error: n2.action.reason });
    expect(job(payJob.id as string).status).toBe("failed");
    expect(String(h.db.rows("messages").at(-1)!.content)).toMatch(/total badal gaya.*35\.1/);
  });

  it("pay: at the approved total the press goes through once and is logged", async () => {
    h.db.rows("browser_jobs").push({ id: JOB, user_id: U, mode: "auto", goal: "Pay", status: "running", start_url: OVERVIEW.url, steps: [], allowed_secrets: [CARD], max_steps: 20, log: [], conversation_id: "c1", claimed_at: new Date().toISOString(), inputs: { checkout: { ...pay, prepare_job_id: "55555555-5555-4555-8555-555555555555" } } });
    h.replies = ['{"do":"click","i":2,"why":"pay"}'];
    const n = await (await call({ action: "next", job_id: JOB, snapshot: OVERVIEW })).json();
    expect(n.action).toMatchObject({ do: "click", i: 2 });
    expect(job(JOB).log).toContain(PAY_PRESSED);
    h.replies = ['{"do":"click","i":2,"why":"pay again"}'];
    const n2 = await (await call({ action: "next", job_id: JOB, snapshot: OVERVIEW })).json();
    expect(n2.action.do).toBe("done");
    await call({ action: "finish", job_id: JOB, status: "done", result: "Thank you for your order!\n\nFinal page: Swag Labs (https://www.saucedemo.com/checkout-complete.html)" });
    expect(String(h.db.rows("messages").at(-1)!.content)).toMatch(/order place ho gaya[\s\S]*Thank you for your order/);
    expect(job(JOB).inputs).toMatchObject({ checkout: { state_box: null } });
  });
});
