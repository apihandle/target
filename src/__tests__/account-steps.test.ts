import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ replies: [] as string[], calls: [] as { only?: unknown; fast?: boolean; content: string }[] }));
vi.mock("@/lib/llm", () => ({
  llmText: async (o: { only?: unknown; fast?: boolean; messages: { content: unknown }[] }) => {
    h.calls.push({ only: o.only, fast: o.fast, content: String(o.messages[1].content) });
    return h.replies.shift() ?? "";
  },
  visionModels: () => [],
}));

import { accountAutofill, compactBlock, decideNext, NO_STEP, parseAction, type Snapshot } from "@/lib/server/autoBrowser";
import { accountGoal } from "@/lib/siteAccount";

const VID = "00000000-0000-4000-8000-00000000fa4e";
const goal = accountGoal({ flow: "register", site: "fake-site.example", email: "nobody@example.com", vault_id: VID, details: "username fakeuser01" });
const secrets = [{ id: VID, kind: "login", label: "fake-site.example (new account, in progress)", site: "fake-site.example" }];

function registerPage(error = ""): Snapshot {
  return {
    url: "https://fake-site.example/register", title: "Register", text: `${error}\nUsername\nPassword\nConfirm Password\nRegister`,
    elements: [
      { i: 0, tag: "a", text: "Home" },
      { i: 1, tag: "label", text: "Username" }, { i: 2, tag: "input", type: "text", text: "username", name: "username" },
      { i: 3, tag: "label", text: "Password" }, { i: 4, tag: "input", type: "password", text: "password", name: "password" },
      { i: 5, tag: "label", text: "Confirm Password" }, { i: 6, tag: "input", type: "password", text: "confirmPassword", name: "confirmPassword" },
      { i: 7, tag: "button", type: "submit", text: "Register" },
    ],
  };
}

beforeEach(() => { h.replies = []; h.calls = []; });

describe("parseAction", () => {
  it("takes the first step when the model answers with a whole plan", () => {
    const plan = `{"do":"fill_secret","i":4,"secret_id":"${VID}","field":"password"}{"do":"fill_secret","i":6,"secret_id":"${VID}","field":"password"}{"do":"click","i":7}`;
    expect(parseAction(plan)).toMatchObject({ do: "fill_secret", i: 4 });
    expect(parseAction(`[${plan.replace(/}{/g, "},\n{")}]`)).toMatchObject({ do: "fill_secret", i: 4 });
  });
  it("still takes the final answer after thinking out loud", () => {
    expect(parseAction('I could do {"do":"scroll"} but the form is visible, so: {"do":"click","i":7}')).toMatchObject({ do: "click", i: 7 });
  });
  it("ignores braces inside strings", () => {
    expect(parseAction('{"do":"fill","i":2,"value":"a}b"}')).toMatchObject({ do: "fill", value: "a}b" });
  });
});

describe("accountAutofill", () => {
  it("fills the new password and the confirm box from the vault, then leaves the form to the model", () => {
    const p = registerPage();
    expect(accountAutofill(goal, p, [])).toEqual({ do: "fill_secret", i: 4, secret_id: VID, field: "password", why: "New password from the vault" });
    expect(accountAutofill(goal, p, ["fill_secret [4] password"])).toMatchObject({ i: 6 });
    expect(accountAutofill(goal, p, ["fill_secret [4] password", "fill_secret [6] password"])).toBeNull();
  });
  it("fills both boxes again after a submit re-renders the form", () => {
    const hist = ["fill [2]", "fill_secret [4] password", "fill_secret [6] password", "click [7]"];
    expect(accountAutofill(goal, registerPage("Passwords do not match."), hist)).toMatchObject({ i: 4 });
  });
  it("stays out of sign-in jobs and plain login pages", () => {
    expect(accountAutofill("Sign in to fake-site.example", registerPage(), [])).toBeNull();
    const login: Snapshot = { url: "https://fake-site.example/login", title: "Login", text: "Successfully registered, you can log in now. Register here\nUsername\nPassword\nLogin", elements: [{ i: 0, tag: "input", type: "text", text: "username" }, { i: 1, tag: "input", type: "password", text: "password" }, { i: 2, tag: "button", text: "Login" }] };
    expect(accountAutofill(goal, login, [])).toBeNull();
  });
});

describe("decideNext on an account form", () => {
  it("fills both password boxes before asking the model", async () => {
    const a = await decideNext(goal, registerPage(), secrets, ["fill [2]"], 20);
    expect(a).toMatchObject({ do: "fill_secret", i: 4, field: "password" });
    expect(h.calls).toHaveLength(0);
  });
  it("retries with the fast models and a smaller page, then waits once more before failing with the reason", async () => {
    const hist = ["fill [2]", "fill_secret [4] password", "fill_secret [6] password"];
    h.replies = ["", "I am not sure", "{\"do\":\"click\",\"i\":99}"];
    expect(await decideNext(goal, registerPage(), secrets, hist, 20)).toMatchObject({ do: "wait" });
    expect(h.calls[0].fast).toBeUndefined();
    expect(h.calls[1].fast).toBe(true);
    expect(h.calls[2].fast).toBe(true);
    expect(h.calls[2].content).toBe(compactBlock(registerPage()));
    const later = [...hist, "wait: The AI gave no usable step; trying again", "wait: The AI gave no usable step; trying again"];
    h.replies = ["", "", ""];
    const f = await decideNext(goal, registerPage(), secrets, later, 20);
    expect(f.do).toBe("fail");
    expect(f.do === "fail" && f.reason).toContain(NO_STEP);
    expect(f.do === "fail" && f.reason).toContain("no reply");
  });
  it("uses the retry's answer when the first model gives nothing usable", async () => {
    h.replies = ["no idea", "{\"do\":\"click\",\"i\":7}"];
    const a = await decideNext(goal, registerPage(), secrets, ["fill [2]", "fill_secret [4] password", "fill_secret [6] password"], 20);
    expect(a).toMatchObject({ do: "click", i: 7 });
  });
});

describe("a username the user chose", () => {
  it("is read from their words and goes into the goal, never the email in its place", async () => {
    const { usernameIn, accountOf } = await import("@/lib/siteAccount");
    expect(usernameIn("create my account on fake-site.example with email nobody@example.com, username fakeuser01")).toBe("fakeuser01");
    expect(usernameIn("user id: fake-user.2")).toBe("fake-user.2");
    expect(usernameIn("create my account on fake-site.example")).toBeNull();
    const g = accountGoal({ flow: "register", site: "fake-site.example", email: "nobody@example.com", username: "fakeuser01", vault_id: VID });
    expect(g).toMatch(/username fakeuser01/);
    expect(g).toMatch(/never put the email in the username box/);
    expect(accountOf({ account: { flow: "register", site: "fake-site.example", email: "nobody@example.com", username: "fakeuser01" } })?.username).toBe("fakeuser01");
    expect(accountOf({ account: { flow: "register", site: "fake-site.example", email: "nobody@example.com", username: "bad name!" } })?.username).toBeUndefined();
  });
});

describe("sign-up fields from the account inputs", () => {
  const g = accountGoal({ flow: "register", site: "fake-site.example", email: "nobody@example.com", username: "fakeuser01", vault_id: VID });
  const pw = ["fill_secret [4] password", "fill_secret [6] password"];
  it("types the chosen username into the username box, then hands the form to the model", () => {
    const p = registerPage();
    expect(accountAutofill(g, p, pw)).toEqual({ do: "fill", i: 2, value: "fakeuser01", why: "Chosen username" });
    p.elements[2].text = "username = fakeuser01";
    expect(accountAutofill(g, p, [...pw, "fill [2]"])).toBeNull();
  });
  it("corrects the email typed into the username box, but stops after three tries", () => {
    const p = registerPage();
    p.elements[2].text = "username = nobody@example.com";
    expect(accountAutofill(g, p, pw)).toMatchObject({ do: "fill", i: 2, value: "fakeuser01" });
    expect(accountAutofill(g, p, [...pw, "fill [2]", "fill [2]", "fill [2]"])).toBeNull();
  });
  it("fills an email box with the account email", () => {
    const p = registerPage();
    p.elements.splice(1, 0, { i: 20, tag: "input", type: "email", text: "Email", name: "email" });
    p.elements[3].text = "username = fakeuser01";
    expect(accountAutofill(g, p, pw)).toMatchObject({ do: "fill", i: 20, value: "nobody@example.com" });
  });
});

describe("a submitted sign-up that shows success", () => {
  const login: Snapshot = { url: "https://fake-site.example/login", title: "Login", text: "Successfully registered, you can log in now.\nRegister here\nUsername\nPassword\nLogin", elements: [{ i: 0, tag: "a", text: "Register here" }, { i: 1, tag: "input", type: "text", text: "username" }, { i: 2, tag: "input", type: "password", text: "password" }, { i: 3, tag: "button", text: "Login" }] };
  it("is done, without asking the model (which once clicked Register here and signed up again)", async () => {
    const a = await decideNext(goal, login, secrets, ["fill_secret [4] password", "fill_secret [6] password", "fill [2]", "click [7]"], 20);
    expect(a).toMatchObject({ do: "done" });
    expect(a.do === "done" && a.result).toMatch(/Successfully registered/);
    expect(h.calls).toHaveLength(0);
  });
  it("not before the form was submitted, and not over a form error", async () => {
    const { signupSucceeded } = await import("@/lib/loginCheck");
    expect(signupSucceeded({ title: "", text: "Account created? No: Username is already taken." })).toBeNull();
    h.replies = ['{"do":"click","i":0}'];
    expect(await decideNext(goal, login, secrets, ["click [9]"], 20)).toMatchObject({ do: "click" });
  });
});
