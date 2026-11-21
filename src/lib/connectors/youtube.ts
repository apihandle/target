import { z } from "zod";
import { defineConnector, tool, clip } from "@/lib/connectors/define";
import { apiFetch, ConnectorError } from "@/lib/connectors/http";
import type { ToolContext } from "@/lib/connectors/types";
import { downloadUrl } from "@/lib/connectors/google/mime";

/**
 * YouTube, via the YouTube Data API v3 (https://developers.google.com/youtube/v3) and Google OAuth 2.0.
 *
 * A separate OAuth client (YOUTUBE_OAUTH_CLIENT_ID / YOUTUBE_OAUTH_CLIENT_SECRET) from the main Google
 * connector's and from Blogger's, on purpose: the consent screen asks for the two YouTube scopes alone,
 * and the YouTube Data API v3 is enabled on that client's Google Cloud project. The redirect URI to
 * register for it is <site origin>/api/connectors/youtube/callback.
 *
 * Uploads use the resumable protocol (https://developers.google.com/youtube/v3/guides/uploading_a_video):
 * initiate a session with the video metadata, then PUT the bytes to the returned session URI. The bytes
 * come from a public https link the user supplies, downloaded through the same SSRF-guarded downloader
 * the Google connector uses for links. A file that can't be fetched in one go (too large, unreachable)
 * never corrupts state: the tool returns the fresh session URI so the upload can be finished by PUTting
 * the bytes to it, and nothing is published.
 */
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/youtube/v3";

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.upload",
] as const;

/** Largest video fetched and PUT in a single upload_video call; bigger files get a resumable session back. */
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

const authHeaders = (ctx: ToolContext): Record<string, string> => ({ Authorization: `Bearer ${ctx.token}` });
const call = <T = unknown>(ctx: ToolContext, path: string, init: Parameters<typeof apiFetch>[1] = {}) =>
  apiFetch<T>(`${API}${path}`, { ...init, f: ctx.fetch, headers: authHeaders(ctx) });

type Channel = {
  id?: string;
  snippet?: { title?: string; description?: string; customUrl?: string };
  statistics?: { subscriberCount?: string; videoCount?: string; viewCount?: string; hiddenSubscriberCount?: boolean };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
};
type ChannelList = { items?: Channel[] };
type PlaylistItem = {
  snippet?: { title?: string; description?: string };
  contentDetails?: { videoId?: string; videoPublishedAt?: string };
};
type PlaylistPage = { items?: PlaylistItem[]; nextPageToken?: string };
type Video = {
  id?: string;
  snippet?: { title?: string; description?: string; publishedAt?: string; channelTitle?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
};
type VideoList = { items?: Video[] };

const num = (s?: string) => (s !== undefined && s !== "" && Number.isFinite(Number(s)) ? Number(s) : undefined);

/** The signed-in user's own channel (first item of channels?mine=true), or a clear refusal. */
async function myChannel(ctx: ToolContext, part: string): Promise<Channel> {
  const j = await call<ChannelList>(ctx, `/channels?part=${encodeURIComponent(part)}&mine=true`);
  const ch = j.items?.[0];
  if (!ch) throw new ConnectorError("No YouTube channel was found for this Google account. Create a channel on youtube.com first, then reconnect.", 404, "not_found");
  return ch;
}

const bareId = z.string().regex(/^[A-Za-z0-9_-]{6,20}$/, "A YouTube video id");
const videoId = bareId.or(
  z.string().max(500).transform((s) => s.match(/(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/)?.[1] ?? "").pipe(bareId),
).describe("Video id, or a youtube.com / youtu.be URL");

/**
 * Initiate a resumable upload session and return its URI (the Location header). The content headers are
 * sent only when the bytes are already in hand; without them YouTube accepts chunked uploads instead.
 */
async function startUploadSession(ctx: ToolContext, metadata: unknown, file: { data: Buffer; mimeType: string } | null): Promise<string> {
  let r: Response;
  try {
    r = await ctx.fetch(`${UPLOAD_API}/videos?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.token}`, "Content-Type": "application/json",
        ...(file ? { "X-Upload-Content-Type": file.mimeType, "X-Upload-Content-Length": String(file.data.length) } : {}),
      },
      body: JSON.stringify(metadata),
    });
  } catch { throw new ConnectorError("youtube.googleapis.com didn't respond in time", 504); }
  const location = r.headers.get("location");
  if (!r.ok || !location) {
    let detail = "";
    try { detail = String(((await r.json()) as { error?: { message?: string } }).error?.message ?? "").slice(0, 200); } catch { /* no body */ }
    throw new ConnectorError(`YouTube couldn't start the upload (${r.status}${detail ? `: ${detail}` : ""})`, r.status === 401 || r.status === 403 ? 403 : 502, r.status === 401 || r.status === 403 ? "auth" : "provider");
  }
  return location;
}

export const youtube = defineConnector({
  id: "youtube",
  name: "YouTube",
  icon: "Y",
  description: "Your YouTube channel: see the channel and its videos, check a video's stats, and upload new videos from a public link.",
  auth: "oauth",
  scopes: [...YOUTUBE_SCOPES],
  capabilities: [
    "See your channel (name, subscribers, video and view counts) and your uploaded videos",
    "Read a video's title, description and view / like / comment counts",
    "Upload a video to your channel from a public link (asks you first)",
  ],
  permissions: [
    "youtube.readonly: see your channel and your videos' details and counts. TARGET never changes or deletes anything with it.",
    "youtube.upload: upload videos to your channel. Every upload waits for your approval, showing the title and privacy setting, before anything is sent.",
    "You can untick permissions on Google's consent screen; TARGET then asks you to reconnect when a task needs one. Revoke any time at myaccount.google.com/permissions.",
  ],
  requiredEnv: ["YOUTUBE_OAUTH_CLIENT_ID", "YOUTUBE_OAUTH_CLIENT_SECRET"],
  oauth: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientIdEnv: "YOUTUBE_OAUTH_CLIENT_ID",
    clientSecretEnv: "YOUTUBE_OAUTH_CLIENT_SECRET",
    tokenAuth: "body",
    pkce: true,
    refreshable: true,
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
    async accountLabel(token, _j, f) {
      const j = await apiFetch<ChannelList>(`${API}/channels?part=snippet&mine=true`, { f, headers: { Authorization: `Bearer ${token}` } });
      return j.items?.[0]?.snippet?.title ?? "";
    },
    async revoke(creds, _env, f) {
      const t = creds.refresh_token ?? creds.access_token;
      await f(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: "POST" }).catch(() => undefined);
    },
  },
  docs: [
    "https://developers.google.com/youtube/v3/docs",
    "https://developers.google.com/youtube/v3/guides/uploading_a_video",
    "https://developers.google.com/identity/protocols/oauth2/web-server",
  ],
  todo: [
    "Owner: in the Google Cloud project \"target\", enable the YouTube Data API v3 and create a Web application OAuth client with the redirect URI <site origin>/api/connectors/youtube/callback; set YOUTUBE_OAUTH_CLIENT_ID / YOUTUBE_OAUTH_CLIENT_SECRET.",
    "The youtube scopes are sensitive scopes; until Google verifies the app, the consent screen shows an \"unverified app\" warning and the client is capped at 100 users. Until the API project passes Google's audit, videos uploaded through it are locked to private by YouTube.",
  ],
  getTools: () => [
    tool({
      name: "my_channel",
      description: "Show the signed-in user's YouTube channel: title, id, subscriber, video and view counts, and its uploads playlist id.",
      input: z.object({}),
      async execute(_a, ctx) {
        const ch = await myChannel(ctx, "snippet,statistics,contentDetails");
        return {
          id: ch.id, title: ch.snippet?.title, custom_url: ch.snippet?.customUrl,
          description: ch.snippet?.description ? clip(ch.snippet.description, 500) : undefined,
          subscribers: ch.statistics?.hiddenSubscriberCount ? undefined : num(ch.statistics?.subscriberCount),
          videos: num(ch.statistics?.videoCount), views: num(ch.statistics?.viewCount),
          uploads_playlist: ch.contentDetails?.relatedPlaylists?.uploads,
        };
      },
    }),
    tool({
      name: "list_my_videos",
      description: "List the user's own uploaded videos (newest first) from their channel's uploads playlist: video id, title, publish date.",
      input: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
      async execute(a, ctx) {
        const ch = await myChannel(ctx, "snippet,contentDetails");
        const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
        if (!uploads) throw new ConnectorError("This channel has no uploads playlist.", 404, "not_found");
        const j = await call<PlaylistPage>(ctx, `/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(uploads)}&maxResults=${a.limit}`);
        return {
          channel: ch.snippet?.title,
          videos: (j.items ?? []).map((it) => ({
            video_id: it.contentDetails?.videoId, title: it.snippet?.title,
            published_at: it.contentDetails?.videoPublishedAt, url: it.contentDetails?.videoId ? `https://www.youtube.com/watch?v=${it.contentDetails.videoId}` : undefined,
          })),
          ...(j.nextPageToken ? { next_page_token: j.nextPageToken } : {}),
        };
      },
    }),
    tool({
      name: "video_details",
      description: "Read one video's title, description, publish date, duration and view / like / comment counts. Takes a video id or a YouTube URL.",
      input: z.object({ video_id: videoId }),
      async execute(a, ctx) {
        const j = await call<VideoList>(ctx, `/videos?part=snippet,statistics,contentDetails&id=${encodeURIComponent(a.video_id)}`);
        const v = j.items?.[0];
        if (!v) throw new ConnectorError("That video wasn't found (it may be private to another account or deleted).", 404, "not_found");
        return {
          id: v.id ?? a.video_id, title: v.snippet?.title, url: `https://www.youtube.com/watch?v=${v.id ?? a.video_id}`,
          description: v.snippet?.description ? clip(v.snippet.description, 1000) : undefined,
          published_at: v.snippet?.publishedAt, channel_title: v.snippet?.channelTitle, duration: v.contentDetails?.duration,
          views: num(v.statistics?.viewCount), likes: num(v.statistics?.likeCount), comments: num(v.statistics?.commentCount),
        };
      },
    }),
    tool({
      name: "upload_video",
      description: "Upload a video to the user's YouTube channel from a public https link, with a title, description and privacy setting. Always requires the user's approval. Files up to 64 MB are uploaded in one go; a larger or unreachable file returns a resumable upload session URI to finish instead.",
      input: z.object({
        video_url: z.string().url().max(2048).refine((u) => /^https:\/\//i.test(u), "Use an https:// URL").describe("Public https link to the video file"),
        title: z.string().min(1).max(100),
        description: z.string().max(5000).default(""),
        privacy: z.enum(["public", "unlisted", "private"]).default("private"),
        tags: z.array(z.string().min(1).max(100)).max(30).optional(),
      }),
      requiresApproval: true,
      summarize: (a) => `Upload a video to YouTube: "${a.title}" (${a.privacy})`,
      async prepare(a, ctx) {
        const ch = await myChannel(ctx, "snippet");
        let host = a.video_url;
        try { host = new URL(a.video_url).host; } catch { /* zod already validated the URL */ }
        return {
          summary: `Upload "${a.title}" to the YouTube channel "${ch.snippet?.title ?? ch.id ?? ""}"`,
          details: {
            Channel: String(ch.snippet?.title ?? ch.id ?? ""), Title: a.title, Privacy: a.privacy,
            Source: host, ...(a.description ? { Description: a.description.slice(0, 500) } : {}),
          },
          warning: a.privacy === "public" ? "The video goes public on your channel as soon as YouTube finishes processing it." : `The video is uploaded as ${a.privacy}; only the people allowed for that setting can watch it.`,
        };
      },
      async execute(a, ctx) {
        const metadata = {
          snippet: { title: a.title, description: a.description, ...(a.tags?.length ? { tags: a.tags } : {}) },
          status: { privacyStatus: a.privacy },
        };
        // Fetch the bytes through the SSRF-guarded downloader. A file that can't come down in one go is
        // not an error: fall through and hand back a bare resumable session for it instead.
        let file: { data: Buffer; mimeType: string } | null = null;
        let problem = "";
        try { file = await downloadUrl(a.video_url, MAX_UPLOAD_BYTES); }
        catch (e) { problem = e instanceof ConnectorError ? e.message : "Couldn't download that link."; }
        const session = await startUploadSession(ctx, metadata, file);
        if (!file) {
          return {
            status: "session_created", uploaded: false, upload_url: session,
            note: `${problem} Nothing was uploaded. A resumable upload session was created instead: PUT the video file's bytes to upload_url to finish the upload (the session stays valid for about a week).`,
          };
        }
        const r = await ctx.fetch(session, {
          method: "PUT",
          headers: { "Content-Type": file.mimeType, "Content-Length": String(file.data.length), "Content-Range": `bytes 0-${file.data.length - 1}/${file.data.length}` },
          body: new Uint8Array(file.data),
        });
        if (r.status === 200 || r.status === 201) {
          const v = (await r.json().catch(() => ({}))) as Video;
          return { status: "uploaded", uploaded: true, id: v.id, url: v.id ? `https://www.youtube.com/watch?v=${v.id}` : undefined, title: v.snippet?.title ?? a.title, privacy: a.privacy };
        }
        if (r.status === 308) {
          return {
            status: "in_progress", uploaded: false, upload_url: session,
            note: "YouTube is still waiting for the rest of this upload. PUT the remaining bytes to upload_url to finish it.",
          };
        }
        throw new ConnectorError(`YouTube upload failed (${r.status})`, 502);
      },
    }),
  ],
});
