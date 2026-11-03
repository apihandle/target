/**
 * Creating accounts and resetting passwords on websites: explicit ask only, approval card, password generated
 * into the vault on approval and never shown.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fakeSupabase").FakeDb }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));
vi.mock("@/lib/server/kickWorker", () => ({ kickCloudWorker: () => Promise.resolve() }));

import { accountGoal, accountOf, accountPost, generatePassword, resetIntent, signupIntent, userAsked } from "@/lib/siteAccount";
import { loginIntent } from "@/lib/signin";
import { sitePasswordResetTool, siteRegisterTool } from "@/lib/builtins/siteAccount";
import { getBuiltin } from "@/lib/builtins/tools";
import { openVault, sealVault } from "@/lib/builtins/vault";
import { runSiteAccount, settleSiteAccount } from "@/lib/server/siteAccountRun";
import { decideApproval } from "@/lib/server/approvals";
import { autoAction } from "@/lib/server/autoBrowser";
import { signinSite, waitForLink } from "@/lib/server/cloudWorker";
import { extractVerification } from "@/lib/connectors/google";
import { pickPlaybooks } from "@/lib/playbooks";
import type { Db } from "@/lib/server/auth";

const A = "11111111-1111-4111-8111-111111111111";
const KEY = Buffer.alloc(32, 7).toString("base64");
let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.CONNECTOR_ENCRYPTION_KEY;
  process.env.CONNECTOR_ENCRYPTION_KEY = KEY;
  h.db = new FakeDb({ browser_jobs: [], approval_requests: [], vault_secrets: [], connections: [], tasks: [], activity_events: [] });
  h.db.as(A);
});
afterEach(() => { if (savedKey === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY; else process.env.CONNECTOR_ENCRYPTION_KEY = savedKey; });

const ctx = (userTexts: string[]) => ({ db: h.db.admin() as unknown as Db, userId: A, conversationId: null, userTexts });

describe("explicit asks", () => {
  it.each([
    ["example.com pe mera password reset kar do", "example.com"],
    ["I forgot my password on shop.example.in, reset it", "shop.example.in"],
    ["timebucks.com ka password badal do", "timebucks.com"],
  ])("reset: %s", (t, site) => expect(resetIntent(t)).toEqual({ site }));
  it.each([
    ["example.com pe naya account bana do", "example.com"],
    ["Sign up on example.org for me", "example.org"],
    ["create an account on news.example.com", "news.example.com"],
  ])("signup: %s", (t, site) => expect(signupIntent(t)).toEqual({ site }));
  it("ignores asks without a site or without the words, and keeps plain logins as logins", () => {
    expect(resetIntent("password reset kaise karte hai?")).toBeNull();
    expect(signupIntent("example.com pe login karo")).toBeNull();
    expect(resetIntent("example.com pe login karo")).toBeNull();
    expect(loginIntent("example.com pe login karo")).toEqual({ site: "example.com", google: false });
  });
  it("accepts the ask from one of the last few user messages, for the same site only", () => {
    expect(userAsked("register", "example.com", ["example.com pe naya account bana do", "vikash@gmail.com use karo"])).toBe(true);
    expect(userAsked("register", "other.com", ["example.com pe naya account bana do"])).toBe(false);
    expect(userAsked("reset", "example.com", ["example.com pe naya account bana do"])).toBe(false);
    expect(userAsked("reset", "example.com", [])).toBe(false);
  });
});

describe("password and goal", () => {
  it("generates strong, different passwords", () => {
    const a = generatePassword(), b = generatePassword();
    expect(a).toHaveLength(20);
    expect(a).not.toBe(b);
    expect(a).toMatch(/[a-z]/); expect(a).toMatch(/[A-Z]/); expect(a).toMatch(/\d/); expect(a).toMatch(/[!@#$%^&*\-_+=?]/);
  });
  it("tells the browser to use the vault item and Gmail links, and never says 'sign in' (keeps login autofill out)", () => {
    const g = accountGoal({ flow: "register", site: "example.com", email: "a@x.com", vault_id: "v-1", lang: "hinglish" });
    expect(g).toMatch(/vault item v-1/);
    expect(g).toMatch(/need_link/);
    expect(g).not.toMatch(/\bsign in\b/i);
    expect(g).toMatch(/Hinglish/);
    expect(accountGoal({ flow: "reset", site: "example.com", email: "a@x.com", vault_id: "v-1" })).toMatch(/Forgot password/);
  });
  it("the browser agent can ask for an emailed link, and reset links on the site's domain are found", () => {
    expect(autoAction.safeParse({ do: "need_link" }).success).toBe(true);
    expect(extractVerification("Reset here: https://example.com/password/reset?t=abc", "example.com").link).toBe("https://example.com/password/reset?t=abc");
    expect(extractVerification("Reset here: https://evil.test/password/reset?t=abc", "example.com").link).toBeUndefined();
  });
  it("account jobs reuse the site session helpers", () => {
    expect(signinSite({ id: "j", mode: "auto", start_url: "https://example.com/", inputs: { account: { site: "example.com" } } })).toBe("example.com");
  });
  it("waits for the link and stops early when Gmail isn't connected", async () => {
    const api = vi.fn().mockResolvedValueOnce({ link: null }).mockResolvedValueOnce({ link: "https://example.com/verify?t=1" });
    expect(await waitForLink({ id: "j", mode: "auto", start_url: "https://example.com/" }, api, Date.now() + 60000, async () => undefined)).toBe("https://example.com/verify?t=1");
    const no = vi.fn().mockResolvedValue({ link: null, error: "Gmail isn't connected" });
    await expect(waitForLink({ id: "j", mode: "auto", start_url: "https://example.com/" }, no, Date.now() + 60000, async () => undefined)).rejects.toThrow(/Gmail/);
  });
});

describe("site_register / site_password_reset tools", () => {
  it("are registered as built-ins", () => {
    expect(getBuiltin("site_register")).toBeTruthy();
    expect(getBuiltin("site_password_reset")).toBeTruthy();
  });
  it("refuse when the user's own messages didn't ask (the model can't start them)", async () => {
    const out = await sitePasswordResetTool.execute({ site: "example.com" }, ctx(["example.com pe login karo"])) as Record<string, unknown>;
    expect(out.status).toBe("not_requested");
    const out2 = await siteRegisterTool.execute({ site: "example.com", email: "a@x.com" }, { ...ctx([]), userTexts: undefined }) as Record<string, unknown>;
    expect(out2.status).toBe("not_requested");
    expect(h.db.tables.browser_jobs).toHaveLength(0);
    expect(h.db.tables.approval_requests).toHaveLength(0);
  });
  it("asks which email when none is given and Google isn't connected", async () => {
    const out = await siteRegisterTool.execute({ site: "example.com" }, ctx(["example.com pe naya account bana do"])) as Record<string, unknown>;
    expect(out.status).toBe("needs_email");
  });
  it("prepares an approval card and a held job, without creating any password yet", async () => {
    h.db.tables.connections = [{ id: "g", user_id: A, connector_id: "google", status: "connected", account_label: "Me@Gmail.com" }];
    const out = await siteRegisterTool.execute({ site: "https://example.com/signup", details: "name Vikash", lang: "hinglish" }, ctx(["example.com pe naya account bana do"])) as { __approval: { id: string; summary: string } };
    expect(out.__approval.summary).toBe("Create a new account on example.com with me@gmail.com");
    const job = h.db.tables.browser_jobs[0];
    expect(job).toMatchObject({ status: "needs_approval", allowed_secrets: [], inputs: { account: { flow: "register", site: "example.com", email: "me@gmail.com", details: "name Vikash", lang: "hinglish" } } });
    expect(h.db.tables.approval_requests[0]).toMatchObject({ action_type: "site_account", status: "pending", payload: { browser_job_id: job.id, flow: "register", site: "example.com", email: "me@gmail.com" } });
    expect(h.db.tables.vault_secrets).toHaveLength(0);
  });
});

describe("approval runs it: password generated into the vault, never shown", () => {
  async function propose(flow: "reset" | "register") {
    const tool = flow === "reset" ? sitePasswordResetTool : siteRegisterTool;
    const text = flow === "reset" ? "example.com ka password reset kar do" : "example.com pe naya account bana do";
    const out = await tool.execute({ site: "example.com", email: "a@x.com" }, ctx([text])) as { __approval: { id: string } };
    return out.__approval.id;
  }

  it("generates and seals the password on approval, queues the job with only that vault item", async () => {
    const id = await propose("register");
    const r = await decideApproval(h.db as unknown as Db, A, id, "approve");
    expect(r.status).toBe(200);
    const [item] = h.db.tables.vault_secrets;
    expect(item).toMatchObject({ user_id: A, kind: "login", site: "example.com" });
    const fields = openVault(A, item.secret_box as string);
    expect(fields.username).toBe("a@x.com");
    expect(fields.password).toHaveLength(20);
    const job = h.db.tables.browser_jobs[0];
    expect(job.status).toBe("queued");
    expect(job.allowed_secrets).toEqual([item.id]);
    expect(accountOf(job.inputs)?.vault_id).toBe(item.id);
    expect(String(accountOf(job.inputs)?.goal)).toMatch(new RegExp(`vault item ${item.id}`));
    // The password appears nowhere but inside the sealed box.
    const visible = JSON.stringify({ job, approvals: h.db.tables.approval_requests, preview: item.preview, label: item.label });
    expect(visible).not.toContain(fields.password);
    // Approving again can't start it twice.
    expect((await decideApproval(h.db as unknown as Db, A, id, "approve")).status).toBe(409);
    expect(h.db.tables.vault_secrets).toHaveLength(1);
  });

  it("rejecting does nothing", async () => {
    const id = await propose("reset");
    expect((await decideApproval(h.db as unknown as Db, A, id, "reject")).status).toBe(200);
    expect(h.db.tables.vault_secrets).toHaveLength(0);
    expect(h.db.tables.browser_jobs[0].status).toBe("needs_approval");
  });

  it("refuses when the job was already started", async () => {
    h.db.tables.browser_jobs = [{ id: "33333333-3333-4333-8333-333333333333", user_id: A, status: "queued", inputs: { account: { flow: "reset", site: "example.com", email: "a@x.com" } } }];
    await expect(runSiteAccount(A, "33333333-3333-4333-8333-333333333333", h.db.admin() as unknown as Db)).rejects.toThrow(/already started/);
  });
});

describe("settling the vault when the job ends", () => {
  const seal = (label: string) => ({ user_id: A, kind: "login", label, ...sealVault(A, { kind: "login", label, site: "example.com", username: "a@x.com", password: "old-pass-123" }) });
  it("a successful reset makes the new login the site's login and removes the old one", async () => {
    h.db.tables.vault_secrets = [{ id: "old", ...seal("example.com") }, { id: "new", ...seal("example.com (new password, in progress)") }];
    await settleSiteAccount(h.db.admin() as unknown as Db, A, { flow: "reset", site: "example.com", email: "a@x.com", vault_id: "new", replaces: "old" }, true, []);
    expect(h.db.tables.vault_secrets.map((v) => [v.id, v.label])).toEqual([["new", "example.com"]]);
  });
  it("a failed job keeps a password the site may have accepted, and drops one that was never typed", async () => {
    h.db.tables.vault_secrets = [{ id: "new", ...seal("x") }];
    await settleSiteAccount(h.db.admin() as unknown as Db, A, { flow: "register", site: "example.com", email: "a@x.com", vault_id: "new" }, false, ["fill_secret [3] password"]);
    expect(h.db.tables.vault_secrets[0].label).toBe("example.com (unconfirmed password)");
    await settleSiteAccount(h.db.admin() as unknown as Db, A, { flow: "register", site: "example.com", email: "a@x.com", vault_id: "new" }, false, ["click [1]"]);
    expect(h.db.tables.vault_secrets).toHaveLength(0);
  });
  it("posts the result in the user's language and says the password is in the vault", () => {
    expect(accountPost({ flow: "reset", site: "example.com", lang: "hinglish" }, true)).toMatch(/password badal gaya.*vault/);
    expect(accountPost({ flow: "register", site: "example.com", lang: "english" }, true)).toMatch(/Account created on example.com/);
  });
});

describe("playbook", () => {
  it("routes account asks to the signin playbook", () => {
    expect(pickPlaybooks("example.com pe naya account bana do").map((p) => p.id)).toContain("signin");
    expect(pickPlaybooks("example.com ka password reset kar do").map((p) => p.id)).toContain("signin");
  });
});
