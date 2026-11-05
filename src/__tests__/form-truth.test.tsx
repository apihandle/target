/**
 * Form-filling truth (survey e2e 2026-11-05): a form job is done only when the page confirms the submit, its report is
 * built from the values read back from the page (never the goal), Next / Submit waits until the fields the goal names
 * hold its values (a checkbox left unticked is fixed first), a form submit needs an approval card in normal mode, and
 * job_status waits for the job instead of answering "still running".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fakeSupabase").FakeDb, replies: [] as string[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));
vi.mock("@/lib/server/kickWorker", () => ({ kickCloudWorker: () => Promise.resolve() }));
vi.mock("@/lib/server/push", () => ({ sendPushToUser: () => Promise.resolve() }));
vi.mock("@/lib/llm", () => ({ llmText: async () => h.replies.shift() ?? "", visionModels: () => [] }));

import { advanceKind, formReport, goalPairs, isFormSubmitGoal, missingFields, submissionConfirmed } from "@/lib/formFill";
import { decideNext, pageBlock, type Snapshot } from "@/lib/server/autoBrowser";
import { POST } from "@/app/api/browser-jobs/worker/route";
import { getBuiltin } from "@/lib/builtins/tools";
import { failureHint } from "@/lib/jobFailure";
import BrowserLiveCard from "@/components/BrowserLiveCard";

const U = "11111111-1111-4111-8111-111111111111";
const JOB = "33333333-3333-4333-8333-333333333333";
const SECRET = "w".repeat(40);
const FORM = "https://docs.google.com/forms/d/e/1FAIpQLSdCZUQo0-8AjJNiNmlmgClxkyxCuvA-vBzzDJKZhQn5rp734Q/viewform";
const GOAL = `Fill the survey at ${FORM} with these exact answers: Your name = Target Normal Run; Favourite colour = Blue; Which fruits do you like = Apple and Mango (tick only these two); click Next; Which city do you live in = Bengaluru; How satisfied are you with online shopping = 4 (on the 1-5 scale); Any comments = normal mode test. Then click Submit and tell me if the confirmation page appeared.`;

const P1 = (fruits: string): Snapshot => ({
  url: FORM, title: "TARGET e2e survey test", text: "TARGET e2e survey test\nYour name *\nFavourite colour *\nWhich fruits do you like? *\nNext\nPage 1 of 2",
  elements: [
    { i: 0, tag: "input", type: "text", text: "Your name * = Target Normal Run" }, { i: 1, tag: "div", text: "Red [ ]" }, { i: 2, tag: "div", text: "Blue [x]" },
    { i: 3, tag: "div", text: `Apple ${fruits.includes("Apple") ? "[x]" : "[ ]"}` }, { i: 4, tag: "div", text: `Mango ${fruits.includes("Mango") ? "[x]" : "[ ]"}` }, { i: 5, tag: "div", text: "Banana [ ]" },
    { i: 6, tag: "div", text: "Next" },
  ],
  fields: [{ q: "Your name *", v: "Target Normal Run", kind: "text" }, { q: "Favourite colour *", v: "Blue", kind: "choice" }, { q: "Which fruits do you like? *", v: fruits, kind: "multi" }],
});
const P2: Snapshot = {
  url: FORM.replace("viewform", "formResponse"), title: "TARGET e2e survey test", text: "Which city do you live in? *\nHow satisfied are you with online shopping? *\nAny comments\nBack\nSubmit\nPage 2 of 2",
  elements: [{ i: 0, tag: "div", text: "Which city do you live in? * = Bengaluru" }, { i: 1, tag: "div", text: "4 [x]" }, { i: 2, tag: "textarea", text: "Any comments" }, { i: 3, tag: "div", text: "Back" }, { i: 4, tag: "div", text: "Submit" }],
  fields: [{ q: "Which city do you live in? *", v: "Bengaluru", kind: "select" }, { q: "How satisfied are you with online shopping? *", v: "4", kind: "choice" }, { q: "Any comments", v: "", kind: "text" }],
};
const DONE: Snapshot = {
  url: FORM.replace("viewform", "formResponse"), title: "TARGET e2e survey test", text: "TARGET e2e survey test\nYour response has been recorded.\nSubmit another response",
  elements: [{ i: 0, tag: "a", text: "Submit another response" }],
};

describe("formFill helpers", () => {
  it("knows a form-submit goal", () => {
    expect(isFormSubmitGoal(GOAL, FORM)).toBe(true);
    expect(isFormSubmitGoal("Fill and submit the contact form", "https://example.com/contact")).toBe(true);
    expect(isFormSubmitGoal("Find the price of the iPhone 16", "https://apple.com")).toBe(false);
    expect(isFormSubmitGoal("Sign in to timebucks.com", "https://timebucks.com/")).toBe(false);
  });
  it("a Google Forms page 2 (also served at /formResponse) is not a confirmation; the recorded page is", () => {
    expect(submissionConfirmed(P2)).toBeNull();
    expect(submissionConfirmed(DONE)).toBe("Your response has been recorded.");
    expect(submissionConfirmed({ text: "Thanks for submitting your form", elements: [{ tag: "div", text: "Submit" }] })).toBeNull();
  });
  it("reads the goal's label = value pairs and finds what the page is missing", () => {
    expect(goalPairs(GOAL).map((p) => p.label)).toEqual(["Your name", "Favourite colour", "Which fruits do you like", "Which city do you live in", "How satisfied are you with online shopping", "Any comments"]);
    expect(missingFields(GOAL, P1("Apple").fields)).toEqual(['"Which fruits do you like? *" should be Apple + Mango but the page shows Apple']);
    expect(missingFields(GOAL, P1("Apple, Mango").fields)).toEqual([]);
    expect(missingFields(GOAL, P1("Apple, Mango, Banana").fields)).toHaveLength(1); // "tick only these two"
    expect(missingFields(GOAL, P2.fields)).toEqual(['"Any comments" should be "normal mode test" but the page shows nothing']);
  });
  it("Next / Submit buttons", () => {
    expect(advanceKind("Next")).toBe("next");
    expect(advanceKind("Submit")).toBe("submit");
    expect(advanceKind("Submit another response")).toBeNull();
  });
  it("the report holds only what the page showed", () => {
    const r = formReport({ confirmed: "Your response has been recorded.", readback: [{ q: "Which fruits do you like? *", v: "Apple" }], log: ["click [3]", "click [6]: Next"], url: FORM });
    expect(r).toMatch(/^Submitted\. The page confirmed it/);
    expect(r).toContain("| Which fruits do you like? * | Apple |");
    expect(r).not.toContain("Mango");
  });
  it("the page block shows checkbox states and the read-back fields", () => {
    const b = pageBlock(P1("Apple"));
    expect(b).toContain("Mango [ ]");
    expect(b).toContain("FORM FIELDS NOW");
    expect(b).toContain("- Which fruits do you like? * = Apple");
  });
  it("NOT_SUBMITTED has an exact reason and a next step", () => {
    expect(failureHint("NOT_SUBMITTED: the page never confirmed the submit")).toMatchObject({ code: "NOT_SUBMITTED", reason: expect.stringContaining("NOT submitted") });
  });
});

describe("decideNext on a form", () => {
  beforeEach(() => { h.replies = []; });
  it("refuses Next while a named checkbox is unticked and returns the fix", async () => {
    h.replies = ['{"do":"click","i":6,"why":"Next page"}', '{"do":"click","i":4,"why":"Tick Mango"}'];
    const a = await decideNext(GOAL, P1("Apple"), [], ["fill [0]", "click [2]", "click [3]"], 20, undefined, { form: true });
    expect(a).toMatchObject({ do: "click", i: 4 });
    expect((a as { why: string }).why).toMatch(/^Fix before/);
  });
  it("lets Next through when every named field matches", async () => {
    h.replies = ['{"do":"click","i":6,"why":"Next page"}'];
    expect(await decideNext(GOAL, P1("Apple, Mango"), [], [], 20, undefined, { form: true })).toMatchObject({ do: "click", i: 6 });
  });
  it("refuses done on page 2, then fails NOT_SUBMITTED when the model insists", async () => {
    h.replies = ['{"do":"done","result":"Form submitted successfully"}', '{"do":"done","result":"Submitted"}'];
    const a = await decideNext(GOAL, P2, [], [], 20, undefined, { form: true });
    expect(a).toMatchObject({ do: "fail" });
    expect((a as { reason: string }).reason).toMatch(/^NOT_SUBMITTED/);
  });
  it("accepts done on the confirmation page", async () => {
    h.replies = ['{"do":"done","result":"ok"}'];
    expect(await decideNext(GOAL, DONE, [], [], 20, undefined, { form: true })).toMatchObject({ do: "done" });
  });
});

describe("worker route: form jobs", () => {
  const env = { secret: undefined as string | undefined };
  beforeEach(() => {
    env.secret = process.env.SESSION_WORKER_SECRET; process.env.SESSION_WORKER_SECRET = SECRET;
    h.replies = [];
    h.db = new FakeDb({ browser_jobs: [], messages: [], conversations: [{ id: "c1", user_id: U }], vault_secrets: [], approval_requests: [] });
    h.db.as(U);
    h.db.rows("browser_jobs").push({ id: JOB, user_id: U, goal: GOAL, start_url: FORM, steps: [], mode: "auto", max_steps: 30, status: "running", allowed_secrets: [], log: [], conversation_id: "c1", inputs: null, claimed_at: new Date().toISOString() });
  });
  afterEach(() => { if (env.secret === undefined) delete process.env.SESSION_WORKER_SECRET; else process.env.SESSION_WORKER_SECRET = env.secret; });
  const call = (body: Record<string, unknown>) => POST(new Request("https://t.test/api/browser-jobs/worker", { method: "POST", headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const job = () => h.db.rows("browser_jobs").find((r) => r.id === JOB)!;

  it("records the page's values at Next / Submit and reports only those after the confirmation", async () => {
    h.replies = ['{"do":"click","i":6,"why":"Next"}'];
    await call({ action: "next", job_id: JOB, snapshot: P1("Apple, Mango") });
    h.replies = ['{"do":"fill","i":2,"value":"normal mode test"}'];
    await call({ action: "next", job_id: JOB, snapshot: P2 });
    const p2 = { ...P2, fields: P2.fields!.map((f) => (f.q === "Any comments" ? { ...f, v: "normal mode test" } : f)) };
    h.replies = ['{"do":"click","i":4,"why":"Submit"}'];
    await call({ action: "next", job_id: JOB, snapshot: p2 });
    expect((job().inputs as { form: { submit_clicked: boolean } }).form.submit_clicked).toBe(true);
    h.replies = ['{"do":"done","result":"Submitted with Apple and Mango and Bananas"}'];
    const r = await (await call({ action: "next", job_id: JOB, snapshot: DONE })).json();
    expect(r.action.do).toBe("done");
    expect(r.action.result).toContain("| Which fruits do you like? * | Apple, Mango |");
    expect(r.action.result).not.toContain("Bananas");
    expect((job().log as string[]).some((l) => l.startsWith("done: submitted"))).toBe(true);
    await call({ action: "finish", job_id: JOB, status: "done", result: `${r.action.result}\n\nFinal page: x` });
    expect(job().status).toBe("done");
    const msg = h.db.rows("messages").at(-1)!.content as string;
    expect(msg).toMatch(/Browser task done/);
    expect(msg).toContain("Your response has been recorded");
  });

  it("a 'done' without the confirmation in the log is a failure, with what the page showed", async () => {
    await call({ action: "finish", job_id: JOB, status: "done", result: "Form submitted successfully. Name: Target Normal Run" });
    expect(job().status).toBe("failed");
    expect(job().error).toMatch(/^NOT_SUBMITTED/);
    const msg = h.db.rows("messages").at(-1)!.content as string;
    expect(msg).toMatch(/⚠️ \*\*Browser task failed/);
    expect(msg).toContain("NOT submitted");
    expect(msg).not.toContain("Form submitted successfully");
  });
});

describe("browser_task approval and job_status", () => {
  beforeEach(() => {
    h.db = new FakeDb({ browser_jobs: [], approval_requests: [], conversations: [{ id: "c1", user_id: U }], vault_secrets: [] });
    h.db.as(U);
  });
  const ctx = (extra: Record<string, unknown> = {}) => ({ db: h.db.admin() as never, userId: U, conversationId: "c1", ...extra });

  it("a form submit waits for an approval card in this chat (normal mode)", async () => {
    const out = await getBuiltin("browser_task")!.execute({ goal: GOAL.slice(0, 500), start_url: FORM, auto: true, secret_ids: [], steps: [] }, ctx()) as { __approval?: { id: string; summary: string } };
    expect(out.__approval?.summary).toMatch(/^Fill in and submit the form on docs\.google\.com/);
    expect(h.db.rows("browser_jobs")[0].status).toBe("needs_approval");
    expect(h.db.rows("approval_requests")[0]).toMatchObject({ action_type: "browser_task", status: "pending", conversation_id: "c1" });
  });
  it("job_status waits for the job to end", async () => {
    h.db.rows("browser_jobs").push({ id: JOB, user_id: U, goal: "g", status: "running", mode: "auto", result: null, error: null, files: [], created_at: new Date().toISOString() });
    setTimeout(() => { const j = h.db.rows("browser_jobs")[0]; j.status = "failed"; j.error = "NOT_SUBMITTED: x"; }, 100);
    const out = await getBuiltin("job_status")!.execute({ job_id: JOB }, ctx({ deadline: Date.now() + 40000 })) as { status: string; note: string };
    expect(out.status).toBe("failed");
    expect(out.note).toMatch(/FAILED/);
  }, 15000);
});

describe("live card: approval inline", () => {
  it("a job waiting for approval shows Approve in the chat card and approves its card", async () => {
    const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as Response;
    const f = vi.fn().mockResolvedValue(ok({ job: { id: JOB, goal: "Fill in the survey", start_url: FORM, status: "needs_approval", log: [], approval_id: "a1" } }));
    vi.stubGlobal("fetch", f);
    render(<BrowserLiveCard conversationId="c1" streaming firstDelayMs={0} pollMs={60000} />);
    expect(await screen.findByTestId("browser-live-title")).toHaveTextContent("Waiting for your approval");
    fireEvent.click(screen.getByTestId("browser-approve"));
    await waitFor(() => expect(f).toHaveBeenCalledWith("/api/approvals/a1", expect.objectContaining({ method: "POST", body: JSON.stringify({ decision: "approve" }) })));
    vi.unstubAllGlobals();
  });
});
