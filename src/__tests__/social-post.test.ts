// @vitest-environment node
// Social posting (/admin/social): Meta config/readiness, Facebook + Instagram publish flows, the stored
// per-user Gemini key (custom-provider pattern), and Gemini drafting. All network is a fake fetch and all
// tokens/keys below are obvious test fixtures — no real Graph API or Gemini call is ever made.
import { describe, it, expect, beforeAll } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64"); // test fixture key, not a secret

import { metaConfig, targetReadiness, postInputProblem, publishSocialPost, publishToInstagram, bloggerPostContent, type BloggerPublishSetup } from "@/lib/server/socialPost";
import { saveGeminiKey, loadGeminiKey, deleteGeminiKey, geminiKeyStatus } from "@/lib/server/socialKeys";
import { generateSocialDraft, draftPrompt } from "@/lib/server/socialDraft";

const PAGE_TOKEN = "TEST_PAGE_TOKEN_fixture";
const GEMINI_KEY = "AIzaTESTKEY_fixture_1234567890";
const ENV = {
  META_FACEBOOK_PAGE_ID: "61596456491904",
  META_FACEBOOK_PAGE_ACCESS_TOKEN: PAGE_TOKEN,
  META_INSTAGRAM_USER_ID: "17841400000000000",
};

type Call = { url: string; method: string; body: string; headers: Record<string, string> };
function fakeFetch(handler: (c: Call) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  const f = (async (url: unknown, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
    const c: Call = { url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? ""), headers: init?.headers ?? {} };
    calls.push(c);
    const out = handler(c);
    return new Response(JSON.stringify(out.json), { status: out.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("meta config + readiness", () => {
  it("reports missing vars by name and per-target readiness, never values", () => {
    const empty = metaConfig({});
    expect(empty.missing).toContain("META_FACEBOOK_PAGE_ID");
    expect(empty.missing).toContain("META_FACEBOOK_PAGE_ACCESS_TOKEN");
    expect(JSON.stringify(empty)).not.toContain(PAGE_TOKEN);
    const ready = targetReadiness(metaConfig(ENV));
    expect(ready.facebook.ready).toBe(true);
    expect(ready.instagram.ready).toBe(true);
    const noIg = targetReadiness(metaConfig({ META_FACEBOOK_PAGE_ID: "1", META_FACEBOOK_PAGE_ACCESS_TOKEN: "x" }));
    expect(noIg.facebook.ready).toBe(true);
    expect(noIg.instagram).toEqual({ ready: false, reason: "META_INSTAGRAM_USER_ID is not set" });
  });

  it("input validation: targets, length, https, instagram needs an image", () => {
    expect(postInputProblem({ message: "hi" }, [])).toMatch(/at least one/);
    expect(postInputProblem({ message: " " }, ["facebook"])).toMatch(/text first/);
    expect(postInputProblem({ message: "hi" }, ["instagram"])).toMatch(/image URL/);
    expect(postInputProblem({ message: "hi", imageUrl: "http://x.test/a.jpg" }, ["instagram"])).toMatch(/https/);
    expect(postInputProblem({ message: "hi", imageUrl: "https://x.test/a.jpg" }, ["instagram"])).toBeNull();
    expect(postInputProblem({ message: "hi", link: "https://gettarget.vercel.app" }, ["facebook"])).toBeNull();
  });
});

describe("facebook publishing", () => {
  it("text + link goes to /feed with the token in the body only", async () => {
    const { f, calls } = fakeFetch(() => ({ json: { id: "61596456491904_123" } }));
    const [r] = await publishSocialPost(metaConfig(ENV), { message: "Hello", link: "https://gettarget.vercel.app" }, ["facebook"], f);
    expect(r).toMatchObject({ target: "facebook", ok: true, id: "61596456491904_123" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/v21.0/61596456491904/feed");
    expect(calls[0].url).not.toContain(PAGE_TOKEN);
    const body = new URLSearchParams(calls[0].body);
    expect(body.get("access_token")).toBe(PAGE_TOKEN);
    expect(body.get("message")).toBe("Hello");
  });

  it("an image URL goes to /photos with the message as caption", async () => {
    const { f, calls } = fakeFetch(() => ({ json: { id: "photo1", post_id: "61596456491904_9" } }));
    const [r] = await publishSocialPost(metaConfig(ENV), { message: "Pic", imageUrl: "https://cdn.test/a.jpg" }, ["facebook"], f);
    expect(r).toMatchObject({ ok: true, id: "61596456491904_9", url: "https://www.facebook.com/61596456491904_9" });
    expect(calls[0].url).toContain("/photos");
    expect(new URLSearchParams(calls[0].body).get("caption")).toBe("Pic");
  });

  it("a Graph auth error is mapped and never echoes the token", async () => {
    const { f } = fakeFetch(() => ({ status: 401, json: { error: { message: `Invalid OAuth access token ${PAGE_TOKEN}`, code: 190 } } }));
    const [r] = await publishSocialPost(metaConfig(ENV), { message: "Hello" }, ["facebook"], f);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/rejected the Page access token/);
      expect(r.error).not.toContain(PAGE_TOKEN);
    }
  });

  it("not-configured targets fail gracefully without any network call", async () => {
    const { f, calls } = fakeFetch(() => ({ json: { id: "x" } }));
    const [r] = await publishSocialPost(metaConfig({}), { message: "Hello" }, ["facebook"], f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Not set up yet/);
    expect(calls).toHaveLength(0);
  });
});

describe("instagram publishing", () => {
  it("container → FINISHED → media_publish, in order", async () => {
    const { f, calls } = fakeFetch((c) => {
      if (c.url.includes("/media_publish")) return { json: { id: "media-1" } };
      if (c.url.includes("fields=status_code")) return { json: { status_code: "FINISHED" } };
      if (c.url.endsWith("/media")) return { json: { id: "container-1" } };
      return { json: {} };
    });
    const r = await publishToInstagram(metaConfig(ENV), { message: "Cap", imageUrl: "https://cdn.test/a.jpg" }, f, { polls: 2, pollMs: 0 });
    expect(r).toMatchObject({ target: "instagram", ok: true, id: "media-1" });
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET", "POST"]);
    expect(new URLSearchParams(calls[0].body).get("image_url")).toBe("https://cdn.test/a.jpg");
    expect(new URLSearchParams(calls[2].body).get("creation_id")).toBe("container-1");
  });

  it("a container stuck IN_PROGRESS publishes nothing", async () => {
    const { f, calls } = fakeFetch((c) => (c.url.includes("fields=status_code") ? { json: { status_code: "IN_PROGRESS" } } : { json: { id: "container-1" } }));
    const r = await publishToInstagram(metaConfig(ENV), { message: "Cap", imageUrl: "https://cdn.test/a.jpg" }, f, { polls: 2, pollMs: 0 });
    expect(r.ok).toBe(false);
    expect(calls.some((c) => c.url.includes("media_publish"))).toBe(false);
  });
});

describe("blogger publishing", () => {
  const BLOGGER_TOKEN = "ya29.TEST_BLOGGER_TOKEN_fixture";
  const setup: BloggerPublishSetup = { ready: true, accessToken: BLOGGER_TOKEN, blogId: "987654321", blogName: "Test Blog" };

  it("posts.insert to the chosen blog with the token only in the Authorization header", async () => {
    const { f, calls } = fakeFetch(() => ({ json: { id: "post-77", url: "https://testblog.example.com/post-77" } }));
    const [r] = await publishSocialPost(metaConfig({}), { message: "Launch day\n\nTARGET now cross-posts to Blogger." }, ["blogger"], f, setup);
    expect(r).toMatchObject({ target: "blogger", ok: true, id: "post-77", url: "https://testblog.example.com/post-77" });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("https://www.googleapis.com/blogger/v3/blogs/987654321/posts");
    expect(calls[0].url).not.toContain(BLOGGER_TOKEN);
    expect(calls[0].headers.Authorization).toBe(`Bearer ${BLOGGER_TOKEN}`);
    const body = JSON.parse(calls[0].body) as { kind: string; blog: { id: string }; title: string; content: string };
    expect(body).toMatchObject({ kind: "blogger#post", blog: { id: "987654321" }, title: "Launch day" });
    expect(body.content).toBe("<p>Launch day</p>\n<p>TARGET now cross-posts to Blogger.</p>");
  });

  it("content mapping: explicit title wins, HTML is escaped, image first, link last", () => {
    const { title, content } = bloggerPostContent({
      message: "First line <script>alert(1)</script>\nsecond line\n\nNew para",
      title: "  My Title  ",
      imageUrl: "https://cdn.test/a.jpg",
      link: "https://gettarget.vercel.app",
    });
    expect(title).toBe("My Title");
    expect(content).toBe(
      '<p><img src="https://cdn.test/a.jpg" alt=""></p>\n' +
      "<p>First line &lt;script&gt;alert(1)&lt;/script&gt;<br>second line</p>\n<p>New para</p>\n" +
      '<p><a href="https://gettarget.vercel.app">https://gettarget.vercel.app</a></p>',
    );
    expect(content).not.toContain("<script>");
    // No explicit title → first non-empty line; blank message → Untitled.
    expect(bloggerPostContent({ message: "\n\n  Hello world  \nrest" }).title).toBe("Hello world");
    expect(bloggerPostContent({ message: "   " }).title).toBe("Untitled");
  });

  it("a title over the cap is a validation problem, like any other bad input", () => {
    expect(postInputProblem({ message: "hi", title: "x".repeat(201) }, ["blogger"])).toMatch(/title/);
    expect(postInputProblem({ message: "hi", title: "x".repeat(200) }, ["blogger"])).toBeNull();
  });

  it("401 and 404 are mapped to safe guidance and never echo the token or the raw provider body", async () => {
    const unauth = fakeFetch(() => ({ status: 401, json: { error: { status: "UNAUTHENTICATED", message: `bad token ${BLOGGER_TOKEN}` } } }));
    const [r1] = await publishSocialPost(metaConfig({}), { message: "Hi" }, ["blogger"], unauth.f, setup);
    expect(r1.ok).toBe(false);
    if (!r1.ok) { expect(r1.error).toMatch(/rejected the Blogger access token/); expect(r1.error).not.toContain(BLOGGER_TOKEN); }
    const missing = fakeFetch(() => ({ status: 404, json: { error: { status: "NOT_FOUND", message: "blog gone" } } }));
    const [r2] = await publishSocialPost(metaConfig({}), { message: "Hi" }, ["blogger"], missing.f, setup);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/could not find that blog/);
  });

  it("a not-ready setup (or none at all) fails gracefully with zero network calls", async () => {
    const { f, calls } = fakeFetch(() => ({ json: { id: "x" } }));
    const [r1] = await publishSocialPost(metaConfig({}), { message: "Hi" }, ["blogger"], f, { ready: false, reason: "Blogger is not connected. Connect it on the Social posts page, then try again." });
    expect(r1).toMatchObject({ target: "blogger", ok: false });
    if (!r1.ok) expect(r1.error).toMatch(/not connected/);
    const [r2] = await publishSocialPost(metaConfig({}), { message: "Hi" }, ["blogger"], f);
    expect(r2.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("combined facebook + blogger publish in one call, results in target order", async () => {
    const { f, calls } = fakeFetch((c) => (c.url.includes("googleapis.com") ? { json: { id: "post-1", url: "https://b.example/1" } } : { json: { id: "61596456491904_42" } }));
    const results = await publishSocialPost(metaConfig(ENV), { message: "Everywhere at once" }, ["facebook", "blogger"], f, setup);
    expect(results).toMatchObject([
      { target: "facebook", ok: true, id: "61596456491904_42" },
      { target: "blogger", ok: true, id: "post-1" },
    ]);
    expect(calls.some((c) => c.url.includes("/feed"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/blogger/v3/"))).toBe(true);
  });

  it("blogger alone needs no Meta config at all", async () => {
    const { f } = fakeFetch(() => ({ json: { id: "post-2" } }));
    const [r] = await publishSocialPost(metaConfig({}), { message: "Blog only" }, ["blogger"], f, setup);
    expect(r).toMatchObject({ target: "blogger", ok: true, id: "post-2" });
  });
});

describe("stored Gemini key (custom-provider pattern)", () => {
  const U = "11111111-1111-4111-8111-111111111111";
  const OTHER = "22222222-2222-4222-8222-222222222222";
  let db: FakeDb;
  beforeAll(() => { db = new FakeDb(); });

  it("save → status shows only a masked preview → load round-trips → delete", async () => {
    const admin = db.admin() as never;
    const { preview } = await saveGeminiKey(admin, U, GEMINI_KEY, "gemini-2.5-flash");
    expect(preview).toContain("••••");
    expect(preview).toContain(GEMINI_KEY.slice(-4));
    expect(preview).not.toContain(GEMINI_KEY.slice(0, -4));
    const st = await geminiKeyStatus(admin, U);
    expect(st).toEqual({ saved: true, preview, model: "gemini-2.5-flash" });
    expect(JSON.stringify(st)).not.toContain(GEMINI_KEY);
    const loaded = await loadGeminiKey(admin, U);
    expect(loaded?.apiKey).toBe(GEMINI_KEY);
    // The stored row holds ciphertext, never the plain key.
    const row = db.rows("social_ai_keys").find((r) => r.user_id === U);
    expect(String(row?.key_box)).not.toContain(GEMINI_KEY);
    await deleteGeminiKey(admin, U);
    expect((await geminiKeyStatus(admin, U)).saved).toBe(false);
    expect(await loadGeminiKey(admin, U)).toBeNull();
  });

  it("a key sealed for one user never opens for another", async () => {
    const admin = db.admin() as never;
    await saveGeminiKey(admin, U, GEMINI_KEY, null);
    expect(await loadGeminiKey(admin, OTHER)).toBeNull();
    await deleteGeminiKey(admin, U);
  });
});

describe("gemini drafting", () => {
  it("sends the key only in the header and returns cleaned text", async () => {
    const { f, calls } = fakeFetch(() => ({ json: { candidates: [{ content: { parts: [{ text: "\"TARGET now plans your week. Try it today.\"" }] } }] } }));
    const r = await generateSocialDraft({ apiKey: GEMINI_KEY, topic: "Weekly planning launch", tone: "announcement" }, f);
    expect(r).toEqual({ ok: true, text: "TARGET now plans your week. Try it today." });
    expect(calls[0].url).toContain("generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect(calls[0].url).not.toContain(GEMINI_KEY);
    expect(calls[0].headers["x-goog-api-key"]).toBe(GEMINI_KEY);
    expect(calls[0].body).not.toContain(GEMINI_KEY);
  });

  it("a rejected key is reported without leaking it", async () => {
    const { f } = fakeFetch(() => ({ status: 403, json: { error: { message: `API key not valid: ${GEMINI_KEY}` } } }));
    const r = await generateSocialDraft({ apiKey: GEMINI_KEY, topic: "x", tone: "tip" }, f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain(GEMINI_KEY);
  });

  it("the prompt carries the standing rules (plain text, no emojis)", () => {
    expect(draftPrompt("Hello", "question")).toMatch(/no emojis/);
  });
});
