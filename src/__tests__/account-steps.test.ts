import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ replies: [] as string[], calls: [] as { only?: unknown; content: string }[] }));
vi.mock("@/lib/llm", () => ({
  llmText: async (o: { only?: unknown; messages: { content: unknown }[] }) => {
    h.calls.push({ only: o.only, content: String(o.messages[1].content) });
    return h.replies.shift() ?? "";
  },
  visionModels: () => [],
  providers: () => [{ name: "fake", models: ["first-model", "second-model"] }],
  orderCandidates: () => [{ p: { name: "fake" }, model: "first-model" }, { p: { name: "fake" }, model: "second-model" }],
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
  it("retries with the fallback model and a smaller page, then waits once more before failing with the reason", async () => {
    const hist = ["fill [2]", "fill_secret [4] password", "fill_secret [6] password"];
    h.replies = ["", "I am not sure", "{\"do\":\"click\",\"i\":99}"];
    expect(await decideNext(goal, registerPage(), secrets, hist, 20)).toMatchObject({ do: "wait" });
    expect(h.calls[0].only).toBeUndefined();
    expect(h.calls[1].only).toEqual([{ provider: "fake", model: "second-model" }]);
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
