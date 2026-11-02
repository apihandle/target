import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { loginIntent, matchLogin, googleLogin, signinGoal, signinFailure, cleanCode, SIGNIN_PROMPT } from "@/lib/signin";
import { cardFromToolOutput, siteLoginTool } from "@/lib/builtins/signin";
import { pickPlaybooks, coreSystemPrompt } from "@/lib/playbooks";
import { sanitizeAction, splitActions } from "@/lib/actions";
import { parseAction, autoPrompt } from "@/lib/server/autoBrowser";
import { signinSite, waitForCode } from "@/lib/server/cloudWorker";
import { BUILTIN_TOOLS } from "@/lib/builtins/tools";
import { SYSTEM_PROMPT } from "@/lib/ai";
import LoginCard from "@/components/LoginCard";
import OtpCard from "@/components/OtpCard";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("loginIntent", () => {
  it.each([
    ["timebucks.com pe login karo", "timebucks.com", false],
    ["timebucks.com pe google se login karo", "timebucks.com", true],
    ["Sign in to https://github.com/login for me", "github.com", false],
    ["mera amazon.in account login kar do", "amazon.in", false],
    ["log in to the-internet.herokuapp.com and tell me the page text", "the-internet.herokuapp.com", false],
  ])("%s", (msg, site, google) => {
    expect(loginIntent(msg)).toEqual({ site, google });
  });
  it("ignores messages without a site or without a sign-in ask", () => {
    expect(loginIntent("login kaise karte hain?")).toBeNull();
    expect(loginIntent("timebucks.com kya hai?")).toBeNull();
    expect(loginIntent("gettarget.vercel.app pe login nahi ho raha")).toBeNull();
  });
});

describe("vault matching", () => {
  const items = [
    { id: "1", kind: "login", label: "GitHub", site: "github.com" },
    { id: "2", kind: "login", label: "Google account", site: "accounts.google.com" },
    { id: "3", kind: "card", label: "HDFC", site: null },
    { id: "4", kind: "login", label: "timebucks", site: null },
  ];
  it("finds a login by site, sub domain or label", () => {
    expect(matchLogin(items, "github.com")?.id).toBe("1");
    expect(matchLogin(items, "www.github.com")?.id).toBe("1");
    expect(matchLogin(items, "timebucks.com")?.id).toBe("4");
    expect(matchLogin(items, "amazon.in")).toBeNull();
    expect(googleLogin(items)?.id).toBe("2");
  });
});

describe("sign-in goal and failures", () => {
  it("tells the browser to use fill_secret and need_code, never a typed password", () => {
    const g = signinGoal("example.com", { siteLogin: "abc", googleLogin: null });
    expect(g).toMatch(/fill_secret field "password"/);
    expect(g).toMatch(/need_code/);
    expect(g).toMatch(/GOOGLE_BLOCKED/);
    expect(signinGoal("x.com", { googleLogin: "g1" })).toMatch(/Continue with Google/);
  });
  it("maps failures to one short line and offers email + password when Google blocks", () => {
    expect(signinFailure("GOOGLE_BLOCKED: browser not secure", "timebucks.com")).toEqual({ line: expect.stringMatching(/Google/), offerPassword: true });
    expect(signinFailure("WRONG_LOGIN", "x.com").offerPassword).toBe(true);
    expect(signinFailure("timeout", "x.com").line).toMatch(/x\.com/);
  });
  it("cleans codes", () => {
    expect(cleanCode(" 482-913 ")).toBe("482913");
    expect(cleanCode("ab")).toBeNull();
    expect(cleanCode(12)).toBeNull();
  });
});

describe("prompts no longer refuse sign-ins", () => {
  it("system prompt treats signing in as a TARGET job and drops the old Google-password line", () => {
    expect(SYSTEM_PROMPT).toMatch(/site_login/);
    expect(SYSTEM_PROMPT).toMatch(/Never refuse it/);
    expect(SYSTEM_PROMPT).not.toMatch(/never ask the user for their Google password/i);
    expect(SIGNIN_PROMPT).toMatch(/never lecture/i);
  });
  it("picks the signin playbook first for login asks", () => {
    expect(pickPlaybooks("timebucks.com pe login karo")[0].id).toBe("signin");
    expect(pickPlaybooks("mera github account kholo")[0].id).toBe("signin");
    expect(coreSystemPrompt("timebucks.com pe login karo")).toMatch(/SIGNING IN TO A WEBSITE/);
  });
  it("registers the site_login tool", () => {
    expect(BUILTIN_TOOLS.some((t) => t.name === "site_login")).toBe(true);
  });
});

describe("cards", () => {
  it("sanitizes vault_login and otp cards", () => {
    expect(sanitizeAction({ type: "vault_login", site: "timebucks.com" })).toEqual({ type: "vault_login", site: "timebucks.com" });
    expect(sanitizeAction({ type: "vault_login", site: "google.com", for: "timebucks.com" })).toEqual({ type: "vault_login", site: "google.com", for: "timebucks.com" });
    expect(sanitizeAction({ type: "vault_login", site: "javascript:alert(1)" })).toBeNull();
    expect(sanitizeAction({ type: "otp", job: "00000000-0000-4000-8000-000000000000", site: "x.com" })).toMatchObject({ type: "otp" });
    expect(sanitizeAction({ type: "otp", job: "nope", site: "x.com" })).toBeNull();
    const { actions } = splitActions('Hi\n\n```actions\n[{"type":"vault_login","site":"x.com"}]\n```');
    expect(actions).toHaveLength(1);
  });
  it("reads the card out of a tool result", () => {
    const content = '<untrusted_data source="target" tool="site_login">\n{"status":"needs_login","site":"x.com","__card":{"type":"vault_login","site":"x.com","for":"x.com"}}\n</untrusted_data>';
    expect(cardFromToolOutput(content)).toEqual({ type: "vault_login", site: "x.com", for: "x.com" });
    expect(cardFromToolOutput("{}")).toBeNull();
  });
});

describe("site_login tool", () => {
  function fakeDb(logins: { id: string; kind: string; label: string; site: string | null }[]) {
    const inserted: Record<string, unknown>[] = [];
    const db = {
      from(table: string) {
        const q: Record<string, unknown> = {};
        const chain = () => q;
        Object.assign(q, { select: chain, eq: chain, limit: () => Promise.resolve({ data: table === "vault_secrets" ? logins : [] }) });
        q.insert = (row: Record<string, unknown>) => { inserted.push(row); return { select: () => ({ single: () => Promise.resolve({ data: { id: "00000000-0000-4000-8000-000000000001" } }) }) }; };
        q.maybeSingle = () => Promise.resolve({ data: { id: "j", status: "done", result: "Welcome tomsmith! You logged into a secure area!", error: null, log: ["fill_secret [1]", "fill_secret [2]"] } });
        return q;
      },
    };
    return { db, inserted };
  }
  it("asks for the login with a secure form when the vault has none", async () => {
    const { db, inserted } = fakeDb([]);
    const out = await siteLoginTool.execute({ site: "timebucks.com", method: "password" }, { db: db as never, userId: "u", conversationId: null }) as Record<string, unknown>;
    expect(out.status).toBe("needs_login");
    expect(out.__card).toEqual({ type: "vault_login", site: "timebucks.com", for: "timebucks.com" });
    expect(inserted).toHaveLength(0);
  });
  it("starts a sign-in job with only the vault id (no password) and returns the page", async () => {
    const { db, inserted } = fakeDb([{ id: "11111111-1111-4111-8111-111111111111", kind: "login", label: "herokuapp", site: "the-internet.herokuapp.com" }]);
    const out = await siteLoginTool.execute({ site: "https://the-internet.herokuapp.com/login", method: "password" }, { db: db as never, userId: "u", conversationId: null }) as Record<string, unknown>;
    expect(out.status).toBe("signed_in");
    expect(String(out.result)).toMatch(/secure area/);
    expect(inserted[0]).toMatchObject({ mode: "auto", allowed_secrets: ["11111111-1111-4111-8111-111111111111"], status: "queued", inputs: { signin: { site: "the-internet.herokuapp.com", via: "password" } } });
    expect(JSON.stringify(inserted[0])).not.toMatch(/password":"/);
  });
});

describe("browser worker sign-in helpers", () => {
  it("knows sign-in jobs and parses need_code", () => {
    expect(signinSite({ id: "1", mode: "auto", start_url: "https://x.com", inputs: { signin: { site: "x.com" } } })).toBe("x.com");
    expect(signinSite({ id: "1", mode: "code", start_url: "https://x.com", inputs: [] })).toBeNull();
    expect(parseAction('{"do":"need_code","i":3}')).toMatchObject({ do: "need_code", i: 3 });
    expect(autoPrompt("g", [], [], 5)).toMatch(/need_code/);
  });
  it("waits for a code until one arrives", async () => {
    let n = 0;
    const api = vi.fn(async () => (++n >= 3 ? { code: "123456" } : { code: null }));
    expect(await waitForCode({ id: "1", mode: "auto", start_url: "https://x.com" }, api, Date.now() + 60000, async () => undefined)).toBe("123456");
    expect(api).toHaveBeenCalledTimes(3);
  });
});

describe("LoginCard", () => {
  it("saves to the vault and continues the chat without the password", async () => {
    const calls: { url: string; body?: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      if (!init) return new Response(JSON.stringify({ items: [] }));
      return new Response(JSON.stringify({ item: { id: "v" } }), { status: 201 });
    }));
    const sent: string[] = [];
    const on = (e: Event) => sent.push((e as CustomEvent<{ text: string }>).detail.text);
    window.addEventListener("target:send", on);
    render(<LoginCard site="timebucks.com" />);
    fireEvent.change(screen.getByTestId("login-user"), { target: { value: "me@x.com" } });
    fireEvent.change(screen.getByTestId("login-pass"), { target: { value: "s3cret-pw" } });
    fireEvent.click(screen.getByTestId("login-save"));
    await waitFor(() => expect(sent).toHaveLength(1));
    window.removeEventListener("target:send", on);
    const post = calls.find((c) => c.body)!;
    expect(JSON.parse(post.body!)).toMatchObject({ kind: "login", site: "timebucks.com", username: "me@x.com", password: "s3cret-pw" });
    expect(sent[0]).toMatch(/timebucks\.com pe sign in/);
    expect(sent[0]).not.toMatch(/s3cret/);
    expect(screen.getByText(/is saved in your vault/)).toBeTruthy();
  });
});

describe("OtpCard", () => {
  it("sends the code to the job and shows the result", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ ok: true }));
      return new Response(JSON.stringify({ job: { status: "running", result: null, error: null } }));
    }));
    render(<OtpCard job="00000000-0000-4000-8000-000000000000" site="x.com" />);
    fireEvent.change(screen.getByTestId("otp-input"), { target: { value: "482913" } });
    fireEvent.click(screen.getByTestId("otp-send"));
    await waitFor(() => expect(screen.getByTestId("otp-card").getAttribute("data-state")).toBe("waiting"));
    const post = (fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls.find((c) => c[1]?.method === "POST")!;
    expect(post[0]).toBe("/api/browser-jobs/00000000-0000-4000-8000-000000000000/code");
  });
});
