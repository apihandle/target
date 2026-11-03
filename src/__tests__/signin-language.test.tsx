import { describe, expect, it, vi } from "vitest";
import { detectLang, userLang, langRule, reportLangHint } from "@/lib/lang";
import { signinFailure, signinGoal, signinPostHead, signinStatusLine } from "@/lib/signin";
import { siteLoginTool } from "@/lib/builtins/signin";

vi.mock("@/lib/server/kickWorker", () => ({ kickCloudWorker: () => Promise.resolve() }));

describe("detectLang", () => {
  it.each([
    ["timebucks.com pe login karo", "hinglish"],
    ["timebucks.com pe google se login karke balance batao", "hinglish"],
    ["mera github account kholo", "hinglish"],
    ["timebucks.com पर लॉगिन करो", "hindi"],
    ["Sign in to github.com and tell me my repos", "english"],
    ["Please log in to timebucks.com", "english"],
  ])("%s -> %s", (text, want) => expect(detectLang(text)).toBe(want));

  it("returns null for too-short messages and falls back to earlier user messages", () => {
    expect(detectLang("timebucks.com login")).toBeNull();
    expect(userLang("timebucks.com login", ["kya haal hai", "mera balance kitna hai"])).toBe("hinglish");
    expect(userLang("timebucks.com login", ["What is the weather today?"])).toBe("english");
    expect(userLang("timebucks.com login", [])).toBeNull();
  });
});

describe("sign-in replies follow the user's language", () => {
  it("pins the reply language after the English page text", () => {
    expect(langRule("hinglish")).toMatch(/Hinglish/);
    expect(langRule("hinglish")).toMatch(/even though the page text above is in English/);
    expect(langRule("hindi")).toMatch(/Devanagari/);
    expect(langRule(null)).toMatch(/same language/);
  });

  it("asks the browser agent to write its page report in Hinglish, and keeps the hint on long goals", () => {
    const g = signinGoal("timebucks.com", { siteLogin: "abc", googleLogin: "g1", check: "x".repeat(200), lang: "hinglish" });
    expect(g.endsWith(reportLangHint("hinglish"))).toBe(true);
    expect(signinGoal("timebucks.com", { siteLogin: "abc", lang: "english" })).not.toMatch(/Hinglish/);
  });

  it("fixed status and failure lines are Hinglish by default and English for English writers", () => {
    expect(signinStatusLine({ status: "needs_login" }, "x.com", "hinglish")).toMatch(/vault mein nahi hai/);
    expect(signinStatusLine({ status: "needs_login" }, "x.com", null)).toMatch(/vault mein nahi hai/);
    expect(signinStatusLine({ status: "needs_login" }, "x.com", "english")).toMatch(/no saved login/);
    expect(signinStatusLine({ status: "signed_in", result: "Dashboard" }, "x.com", "hinglish")).toMatch(/sign in ho gaya/);
    expect(signinStatusLine({ status: "queued" }, "x.com", "english")).toMatch(/posted in this chat/);
    expect(signinFailure("WRONG_LOGIN", "x.com", "english").line).toMatch(/wrong/);
    expect(signinFailure("WRONG_LOGIN", "x.com", "hinglish").line).toMatch(/galat/);
    expect(signinFailure("GOOGLE_BLOCKED", "x.com").line).toMatch(/block kar diya/);
    expect(signinPostHead("x.com", true, "hinglish")).toMatch(/sign in ho gaya/);
    expect(signinPostHead("x.com", false, "english")).toMatch(/Couldn't sign in/);
  });

  it("site_login stores the language on the job so a late result is posted in it", async () => {
    const inserted: Record<string, unknown>[] = [];
    const db = {
      from(table: string) {
        const q: Record<string, unknown> = {};
        const chain = () => q;
        Object.assign(q, { select: chain, eq: chain, limit: () => Promise.resolve({ data: table === "vault_secrets" ? [{ id: "11111111-1111-4111-8111-111111111111", kind: "login", label: "tb", site: "timebucks.com" }] : [] }) });
        q.insert = (row: Record<string, unknown>) => { inserted.push(row); return { select: () => ({ single: () => Promise.resolve({ data: { id: "00000000-0000-4000-8000-000000000001" } }) }) }; };
        q.maybeSingle = () => Promise.resolve({ data: { id: "j", status: "failed", result: null, error: "WRONG_LOGIN", log: [] } });
        return q;
      },
    };
    const out = await siteLoginTool.execute({ site: "timebucks.com", method: "password", lang: "hinglish" }, { db: db as never, userId: "u", conversationId: null }) as Record<string, unknown>;
    expect(inserted[0]).toMatchObject({ inputs: { signin: { site: "timebucks.com", lang: "hinglish" } } });
    expect(String((inserted[0].inputs as { signin: { goal: string } }).signin.goal)).toMatch(/Hinglish/);
    expect(out.reason).toMatch(/galat/);
  });
});
