// @vitest-environment node
// YouTube connector: def shape, Google OAuth (authorize URL, code exchange, refresh), and the four
// tools against a mocked YouTube Data API v3. The upload's source download runs through the real
// SSRF-guarded downloadUrl with safeFetch mocked, like the Google connector tests do.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ safeFetch: null as unknown as (url: string) => Promise<Response> }));
vi.mock("@/lib/server/safeFetch", () => ({ safeFetch: (url: string) => h.safeFetch(url) }));

import { getConnector } from "@/lib/connectors/registry";
import { SHOWN_CONNECTORS } from "@/lib/connectors/shown";
import { authorizeUrl, exchangeCode, refreshCreds } from "@/lib/connectors/oauth";
import { YOUTUBE_SCOPES } from "@/lib/connectors/youtube";
import type { ToolContext } from "@/lib/connectors/types";

const ENV = { YOUTUBE_OAUTH_CLIENT_ID: "yt-client", YOUTUBE_OAUTH_CLIENT_SECRET: "yt-secret-value" };
const TOK = "ya29.TEST_YOUTUBE_TOKEN_fixture";
const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const def = () => getConnector("youtube")!;
const tool = (name: string) => def().getTools({ connector_id: "youtube", status: "connected", scopes: def().scopes, account_label: "" }).find((t) => t.name === name)!;
const ctx = (f: typeof fetch): ToolContext => ({ token: TOK, fetch: f, meta: {} });

const CHANNEL = {
  id: "UC1234567890",
  snippet: { title: "SHADOWXPOV", description: "Free API videos", customUrl: "@shadowxpov" },
  statistics: { subscriberCount: "2727", videoCount: "9", viewCount: "54321" },
  contentDetails: { relatedPlaylists: { uploads: "UU1234567890" } },
};

beforeEach(() => { h.safeFetch = async () => { throw new Error("safeFetch not stubbed"); }; });

describe("youtube connector def", () => {
  it("is OAuth-only with the two YouTube scopes on a dedicated Google client", () => {
    const d = def();
    expect(d.name).toBe("YouTube");
    expect(d.auth).toBe("oauth");
    expect(d.apiKey).toBeUndefined();
    expect(d.scopes).toEqual(["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/youtube.upload"]);
    expect(d.requiredEnv).toEqual(["YOUTUBE_OAUTH_CLIENT_ID", "YOUTUBE_OAUTH_CLIENT_SECRET"]);
    expect(d.oauth).toMatchObject({
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      clientIdEnv: "YOUTUBE_OAUTH_CLIENT_ID", clientSecretEnv: "YOUTUBE_OAUTH_CLIENT_SECRET",
      tokenAuth: "body", pkce: true, refreshable: true,
    });
    expect(d.oauth!.extraAuthorizeParams).toMatchObject({ access_type: "offline", prompt: "consent" });
    expect(d.getTools({ connector_id: "youtube", status: "connected", scopes: d.scopes, account_label: "" }).map((t) => t.name))
      .toEqual(["my_channel", "list_my_videos", "video_details", "upload_video"]);
  });

  it("is shown on the Connectors page right after Instagram (social group)", () => {
    const ids = [...SHOWN_CONNECTORS];
    expect(ids.indexOf("youtube")).toBe(ids.indexOf("instagram") + 1);
  });
});

describe("youtube OAuth flow", () => {
  it("authorize URL carries both scopes, offline access and consent on Google's endpoint", () => {
    const u = new URL(authorizeUrl(def(), ENV, { redirectUri: "https://gettarget.vercel.app/api/connectors/youtube/callback", state: "st", codeChallenge: "cc" }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("client_id")).toBe("yt-client");
    expect(u.searchParams.get("redirect_uri")).toBe("https://gettarget.vercel.app/api/connectors/youtube/callback");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe(YOUTUBE_SCOPES.join(" "));
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("code_challenge")).toBe("cc");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("code exchange posts client credentials in the body, parses tokens, and labels by channel title", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
        return jsonRes({ access_token: "ya29.new-access", refresh_token: "yt-refresh", expires_in: 3600, scope: YOUTUBE_SCOPES.join(" ") });
      }
      return jsonRes({ items: [{ snippet: { title: "SHADOWXPOV" } }] });
    }) as unknown as typeof fetch;
    const t = await exchangeCode(def(), ENV, { code: "abc", redirectUri: "https://gettarget.vercel.app/api/connectors/youtube/callback", codeVerifier: "verifier-123" }, f);
    expect(t.accountLabel).toBe("SHADOWXPOV");
    expect(t.creds).toMatchObject({ type: "oauth", access_token: "ya29.new-access", refresh_token: "yt-refresh" });
    expect(t.scopes).toEqual([...YOUTUBE_SCOPES]);
    const body = new URLSearchParams(String(calls[0].init.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_id")).toBe("yt-client");
    expect(body.get("client_secret")).toBe("yt-secret-value");
    expect(body.get("code_verifier")).toBe("verifier-123");
    expect(calls[1].url).toBe("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true");
    expect(new Headers(calls[1].init.headers).get("authorization")).toBe("Bearer ya29.new-access");
  });

  it("refresh uses the refresh_token grant with body credentials", async () => {
    const bodies: string[] = [];
    const f = vi.fn(async (_url: string, init: RequestInit = {}) => {
      bodies.push(String(init.body));
      return jsonRes({ access_token: "ya29.refreshed", expires_in: 3600 });
    }) as unknown as typeof fetch;
    const c = await refreshCreds(def(), ENV, { type: "oauth", access_token: "old", refresh_token: "yt-refresh", expires_at: 1 }, f);
    expect(c).toMatchObject({ access_token: "ya29.refreshed", refresh_token: "yt-refresh" });
    const body = new URLSearchParams(bodies[0]);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("client_secret")).toBe("yt-secret-value");
  });
});

describe("youtube read tools", () => {
  it("my_channel maps the channel and sends the token only as a Bearer header", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      return jsonRes({ items: [CHANNEL] });
    }) as unknown as typeof fetch;
    const out = await tool("my_channel").execute({}, ctx(f)) as Record<string, unknown>;
    expect(out).toMatchObject({ id: "UC1234567890", title: "SHADOWXPOV", custom_url: "@shadowxpov", subscribers: 2727, videos: 9, views: 54321, uploads_playlist: "UU1234567890" });
    expect(seen[0].url).toBe("https://www.googleapis.com/youtube/v3/channels?part=snippet%2Cstatistics%2CcontentDetails&mine=true");
    expect(seen[0].auth).toBe(`Bearer ${TOK}`);
    expect(seen[0].url).not.toContain("ya29");
  });

  it("my_channel refuses clearly when the account has no channel", async () => {
    const f = vi.fn(async () => jsonRes({ items: [] })) as unknown as typeof fetch;
    await expect(tool("my_channel").execute({}, ctx(f))).rejects.toThrow(/No YouTube channel was found/);
  });

  it("list_my_videos goes through the uploads playlist, never search", async () => {
    const urls: string[] = [];
    const f = vi.fn(async (url: string) => {
      urls.push(String(url));
      if (String(url).includes("/channels?")) return jsonRes({ items: [CHANNEL] });
      return jsonRes({
        nextPageToken: "page2",
        items: [
          { snippet: { title: "First" }, contentDetails: { videoId: "dQw4w9WgXcQ", videoPublishedAt: "2026-11-01T00:00:00Z" } },
          { snippet: { title: "Second" }, contentDetails: { videoId: "abc123XYZ_-", videoPublishedAt: "2026-11-02T00:00:00Z" } },
        ],
      });
    }) as unknown as typeof fetch;
    const out = await tool("list_my_videos").execute(tool("list_my_videos").input.parse({ limit: 5 }), ctx(f)) as { channel: string; videos: { video_id: string; url: string }[]; next_page_token?: string };
    expect(out.channel).toBe("SHADOWXPOV");
    expect(out.videos).toMatchObject([
      { video_id: "dQw4w9WgXcQ", title: "First", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
      { video_id: "abc123XYZ_-", title: "Second" },
    ]);
    expect(out.next_page_token).toBe("page2");
    expect(urls[1]).toContain("/playlistItems?part=snippet,contentDetails&playlistId=UU1234567890&maxResults=5");
    expect(urls.join(" ")).not.toContain("/search");
  });

  it("video_details accepts a watch URL or a bare id and maps the statistics", async () => {
    const urls: string[] = [];
    const f = vi.fn(async (url: string) => {
      urls.push(String(url));
      return jsonRes({ items: [{ id: "dQw4w9WgXcQ", snippet: { title: "Launch", publishedAt: "2026-11-01T00:00:00Z", channelTitle: "SHADOWXPOV" }, statistics: { viewCount: "1000", likeCount: "42", commentCount: "7" }, contentDetails: { duration: "PT3M30S" } }] });
    }) as unknown as typeof fetch;
    const t = tool("video_details");
    const fromUrl = await t.execute(t.input.parse({ video_id: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }), ctx(f)) as Record<string, unknown>;
    expect(fromUrl).toMatchObject({ id: "dQw4w9WgXcQ", title: "Launch", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", duration: "PT3M30S", views: 1000, likes: 42, comments: 7 });
    expect(urls[0]).toBe("https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=dQw4w9WgXcQ");
    const fromId = await t.execute(t.input.parse({ video_id: "dQw4w9WgXcQ" }), ctx(f)) as Record<string, unknown>;
    expect(fromId.id).toBe("dQw4w9WgXcQ");
    const empty = vi.fn(async () => jsonRes({ items: [] })) as unknown as typeof fetch;
    await expect(t.execute(t.input.parse({ video_id: "dQw4w9WgXcQ" }), ctx(empty))).rejects.toThrow(/wasn't found/);
  });
});

describe("youtube upload_video", () => {
  const SESSION = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=xyz";
  const args = { video_url: "https://cdn.example.com/clip.mp4", title: "Hello YouTube", description: "First upload", privacy: "unlisted" as const };

  it("requires approval and its card names the channel, title and privacy", async () => {
    const t = tool("upload_video");
    expect(t.requiresApproval).toBe(true);
    const f = vi.fn(async () => jsonRes({ items: [CHANNEL] })) as unknown as typeof fetch;
    const preview = await t.prepare!(t.input.parse(args), ctx(f));
    expect(preview.summary).toContain("SHADOWXPOV");
    expect(preview.details).toMatchObject({ Channel: "SHADOWXPOV", Title: "Hello YouTube", Privacy: "unlisted", Source: "cdn.example.com" });
  });

  it("initiates a resumable session with the metadata, then PUTs the downloaded bytes to it", async () => {
    const bytes = Buffer.from("fake-video-bytes");
    h.safeFetch = async () => new Response(bytes, { status: 200, headers: { "Content-Type": "video/mp4" } });
    const calls: { url: string; init: RequestInit }[] = [];
    const f = vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      if (init.method === "PUT") return jsonRes({ id: "vid123", snippet: { title: "Hello YouTube" } }, 201);
      return new Response(null, { status: 200, headers: { Location: SESSION } });
    }) as unknown as typeof fetch;
    const t = tool("upload_video");
    const out = await t.execute(t.input.parse(args), ctx(f)) as Record<string, unknown>;
    expect(out).toMatchObject({ status: "uploaded", uploaded: true, id: "vid123", url: "https://www.youtube.com/watch?v=vid123", privacy: "unlisted" });
    const start = calls.find((c) => c.init.method === "POST")!;
    expect(start.url).toBe("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status");
    const sh = new Headers(start.init.headers);
    expect(sh.get("authorization")).toBe(`Bearer ${TOK}`);
    expect(sh.get("x-upload-content-length")).toBe(String(bytes.length));
    expect(sh.get("x-upload-content-type")).toBe("video/mp4");
    expect(JSON.parse(String(start.init.body))).toEqual({ snippet: { title: "Hello YouTube", description: "First upload" }, status: { privacyStatus: "unlisted" } });
    const put = calls.find((c) => c.init.method === "PUT")!;
    expect(put.url).toBe(SESSION);
    expect(Buffer.from(put.init.body as Uint8Array).toString()).toBe("fake-video-bytes");
    expect(new Headers(put.init.headers).get("content-range")).toBe(`bytes 0-${bytes.length - 1}/${bytes.length}`);
  });

  it("a file that can't be fetched in one go returns the session URI instead of failing", async () => {
    h.safeFetch = async () => { throw new Error("Response too large"); };
    const calls: { url: string; init: RequestInit }[] = [];
    const f = vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return new Response(null, { status: 200, headers: { Location: SESSION } });
    }) as unknown as typeof fetch;
    const t = tool("upload_video");
    const out = await t.execute(t.input.parse(args), ctx(f)) as Record<string, unknown>;
    expect(out.status).toBe("session_created");
    expect(out.uploaded).toBe(false);
    expect(out.upload_url).toBe(SESSION);
    expect(String(out.note)).toMatch(/Couldn't download that link/);
    expect(calls.some((c) => c.init.method === "PUT")).toBe(false);
    expect(new Headers(calls[0].init.headers).get("x-upload-content-length")).toBeNull();
  });

  it("a 308 from the PUT reports the upload as still in progress with its session URI", async () => {
    h.safeFetch = async () => new Response(Buffer.from("bytes"), { status: 200, headers: { "Content-Type": "video/mp4" } });
    const f = vi.fn(async (_url: string, init: RequestInit = {}) => {
      if (init.method === "PUT") return new Response(null, { status: 308 });
      return new Response(null, { status: 200, headers: { Location: SESSION } });
    }) as unknown as typeof fetch;
    const t = tool("upload_video");
    const out = await t.execute(t.input.parse(args), ctx(f)) as Record<string, unknown>;
    expect(out).toMatchObject({ status: "in_progress", uploaded: false, upload_url: SESSION });
  });
});
