"use client";
import { useCallback, useEffect, useState } from "react";
import {
  DRAFT_TONES, SOCIAL_MESSAGE_MAX, SOCIAL_TARGETS, SOCIAL_TITLE_MAX, SOCIAL_TOPIC_MAX,
  type DraftTone, type ScheduledPostStatus, type SocialTarget,
} from "@/lib/socialConfig";

const box = "w-full rounded-xl border border-line-strong bg-bg/80 px-3 py-2 text-sm text-ink placeholder:text-muted-soft outline-none focus:border-accent";
const card = "rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur-xl";
const btn = "inline-flex h-9 items-center rounded-full px-4 text-sm font-medium transition disabled:opacity-50";
const btnPrimary = `${btn} bg-accent text-accent-ink hover:brightness-110`;
const btnGhost = `${btn} border border-line-strong bg-surface-2 text-ink hover:bg-surface-3`;

export type BloggerStatusView = {
  vars: { name: string; set: boolean }[];
  oauthConfigured: boolean;
  connected: boolean;
  accountLabel: string;
  blog: { blogId: string; blogName: string; blogUrl: string | null } | null;
};

export type SocialStatus = {
  meta: { vars: { name: string; set: boolean }[]; pageId: string | null; igUserId: string | null; graphVersion: string };
  targets: Record<SocialTarget, { ready: boolean; reason?: string }>;
  gemini: { saved: boolean; preview: string; model: string | null };
  blogger: BloggerStatusView;
};

type BloggerBlogOption = { id: string; name: string; url: string | null };

type TargetResult = { target: SocialTarget; ok: boolean; id?: string; url?: string; error?: string };

/** One row of the scheduled-post queue, as returned by GET /api/admin/social/schedule. */
type ScheduledPost = {
  id: string;
  message: string;
  link: string | null;
  imageUrl: string | null;
  title: string | null;
  targets: SocialTarget[];
  autoGenerate: boolean;
  topic: string | null;
  tone: DraftTone;
  scheduledAt: string;
  status: ScheduledPostStatus;
  results: TargetResult[] | null;
  error: string | null;
  attempts: number;
  publishedAt: string | null;
  createdAt: string;
};

const STATUS_STYLE: Record<ScheduledPostStatus, string> = {
  pending: "border-line-strong bg-surface-2 text-muted",
  publishing: "border-line-strong bg-surface-2 text-muted",
  published: "border-ok/30 bg-ok-subtle text-ok",
  failed: "border-danger/30 bg-danger/10 text-danger",
  cancelled: "border-line-strong bg-surface-2 text-muted-soft",
};
const whenText = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

async function postJson(url: string, method: string, body: Record<string, unknown>): Promise<{ res: Response; j: Record<string, unknown> }> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { res, j };
}
const errText = (j: Record<string, unknown>, status: number) => (typeof j.error === "string" ? j.error : `Failed (HTTP ${status})`);

/**
 * The social composer, shared by /admin/social and /app/social: save your own Gemini key (stored sealed,
 * like any provider key), draft a post with it, edit, then publish the confirmed text to the selected
 * Facebook Page / Instagram / Blogger destinations — now, or at a scheduled time (the social cron
 * publishes the queue on its own; a scheduled post can also ask Gemini to write the text at post time).
 * Publishing/scheduling is a two-step confirm here. `apiBase` picks the API family: the admin routes
 * (which additionally require confirm: true + write an audit entry first) or the user twins under
 * /api/social, where every destination resolves to the signed-in user's own connected accounts.
 */
export type SocialComposerProps = {
  initial: SocialStatus;
  apiBase?: string;
  /** Sentence shown at the publish/schedule confirm step. Admin default mentions the audit log. */
  confirmNote?: string;
  /** Per-target hint overrides for the destination chips (e.g. the user's own Page name / @username). */
  targetHints?: Partial<Record<SocialTarget, string>>;
  defaultTargets?: SocialTarget[];
};

export default function SocialComposer({
  initial,
  apiBase = "/api/admin/social",
  confirmNote = "This is recorded in the admin audit log.",
  targetHints,
  defaultTargets,
}: SocialComposerProps) {
  const [gemini, setGemini] = useState(initial.gemini);
  const [keyInput, setKeyInput] = useState("");
  const [modelInput, setModelInput] = useState(initial.gemini.model ?? "");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyNote, setKeyNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const [blogger, setBlogger] = useState(initial.blogger);
  const [blogs, setBlogs] = useState<BloggerBlogOption[] | null>(null);
  const [blogPick, setBlogPick] = useState(initial.blogger.blog?.blogId ?? "");
  const [bloggerBusy, setBloggerBusy] = useState(false);
  const [bloggerNote, setBloggerNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState<DraftTone>("announcement");
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftNote, setDraftNote] = useState<{ ok: boolean; text: string } | null>(null);

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [targets, setTargets] = useState<SocialTarget[]>(defaultTargets ?? ["facebook"]);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [pubBusy, setPubBusy] = useState(false);
  const [results, setResults] = useState<TargetResult[] | null>(null);
  const [pubError, setPubError] = useState<string | null>(null);

  const [schedAt, setSchedAt] = useState("");
  const [schedAuto, setSchedAuto] = useState(false);
  const [schedTopic, setSchedTopic] = useState("");
  const [schedTone, setSchedTone] = useState<DraftTone>("announcement");
  const [confirmSchedule, setConfirmSchedule] = useState(false);
  const [schedBusy, setSchedBusy] = useState(false);
  const [schedNote, setSchedNote] = useState<{ ok: boolean; text: string } | null>(null);

  const [queue, setQueue] = useState<ScheduledPost[] | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  const toggleTarget = (t: SocialTarget) =>
    setTargets((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const saveKey = async () => {
    setKeyBusy(true); setKeyNote(null);
    try {
      const { res, j } = await postJson(`${apiBase}/key`, "POST", { apiKey: keyInput, model: modelInput.trim() || undefined, confirm: true });
      if (!res.ok) setKeyNote({ ok: false, text: errText(j, res.status) });
      else {
        const g = j.gemini as SocialStatus["gemini"];
        setGemini(g); setKeyInput("");
        setKeyNote({ ok: true, text: `Key saved. Only the preview ${g.preview} is ever shown.` });
      }
    } catch { setKeyNote({ ok: false, text: "Network error. The key was not saved." }); }
    finally { setKeyBusy(false); }
  };

  const removeKey = async () => {
    setKeyBusy(true); setKeyNote(null);
    try {
      const { res, j } = await postJson(`${apiBase}/key`, "DELETE", { confirm: true });
      if (!res.ok) setKeyNote({ ok: false, text: errText(j, res.status) });
      else { setGemini({ saved: false, preview: "", model: null }); setModelInput(""); setKeyNote({ ok: true, text: "Key removed." }); }
    } catch { setKeyNote({ ok: false, text: "Network error. The key was not removed." }); }
    finally { setKeyBusy(false); setConfirmRemove(false); }
  };

  const loadBlogs = async () => {
    setBloggerBusy(true); setBloggerNote(null);
    try {
      const res = await fetch(`${apiBase}/blogger`, { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) setBloggerNote({ ok: false, text: errText(j, res.status) });
      else {
        if (j.status) setBlogger(j.status as BloggerStatusView);
        const list = Array.isArray(j.blogs) ? (j.blogs as BloggerBlogOption[]) : [];
        setBlogs(list);
        if (typeof j.error === "string") setBloggerNote({ ok: false, text: j.error });
        else if (!list.length) setBloggerNote({ ok: false, text: "No blogs were found on that Google account." });
        else setBlogPick((cur) => cur || list[0].id);
      }
    } catch { setBloggerNote({ ok: false, text: "Network error. The blogs were not loaded." }); }
    finally { setBloggerBusy(false); }
  };

  const saveBlog = async () => {
    setBloggerBusy(true); setBloggerNote(null);
    try {
      const { res, j } = await postJson(`${apiBase}/blogger`, "POST", { blogId: blogPick, confirm: true });
      if (!res.ok) setBloggerNote({ ok: false, text: errText(j, res.status) });
      else {
        if (j.status) setBlogger(j.status as BloggerStatusView);
        setBloggerNote({ ok: true, text: "Blog saved. Blogger posts from here and the schedule go to it." });
      }
    } catch { setBloggerNote({ ok: false, text: "Network error. The blog was not saved." }); }
    finally { setBloggerBusy(false); }
  };

  const disconnectBlogger = async () => {
    setBloggerBusy(true); setBloggerNote(null);
    try {
      await postJson(`${apiBase}/blogger`, "DELETE", { confirm: true });
      const { res, j } = await postJson("/api/connectors/blogger/disconnect", "POST", {});
      if (!res.ok) setBloggerNote({ ok: false, text: errText(j, res.status) });
      else window.location.reload();
    } catch { setBloggerNote({ ok: false, text: "Network error. Blogger was not disconnected." }); }
    finally { setBloggerBusy(false); setConfirmDisconnect(false); }
  };

  const generate = async () => {
    setDraftBusy(true); setDraftNote(null);
    try {
      const { res, j } = await postJson(`${apiBase}/generate`, "POST", { topic, tone });
      if (!res.ok) setDraftNote({ ok: false, text: errText(j, res.status) });
      else if (typeof j.text === "string") {
        setMessage(j.text);
        setDraftNote({ ok: true, text: "Draft added below. Edit it freely — nothing is posted until you publish." });
      }
    } catch { setDraftNote({ ok: false, text: "Network error. No draft was created." }); }
    finally { setDraftBusy(false); }
  };

  const publish = async () => {
    setPubBusy(true); setPubError(null); setResults(null);
    try {
      const { res, j } = await postJson(`${apiBase}/publish`, "POST", {
        message, link: link.trim() || undefined, imageUrl: imageUrl.trim() || undefined,
        title: title.trim() || undefined, targets, confirm: true,
      });
      const list = Array.isArray(j.results) ? (j.results as TargetResult[]) : null;
      if (list) setResults(list);
      if (!res.ok && !list) setPubError(errText(j, res.status));
    } catch { setPubError("Network error. Nothing was confirmed as posted; check the accounts before retrying."); }
    finally { setPubBusy(false); setConfirmPublish(false); }
  };

  const fetchQueue = useCallback(async (): Promise<ScheduledPost[] | null> => {
    try {
      const res = await fetch(`${apiBase}/schedule`, { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return res.ok && Array.isArray(j.posts) ? (j.posts as ScheduledPost[]) : null;
    } catch { return null; }
  }, [apiBase]);

  const loadQueue = useCallback(async () => {
    setQueueBusy(true);
    const posts = await fetchQueue();
    if (posts) setQueue(posts);
    setQueueBusy(false);
  }, [fetchQueue]);

  useEffect(() => {
    let live = true;
    void fetchQueue().then((posts) => { if (live && posts) setQueue(posts); });
    return () => { live = false; };
  }, [fetchQueue]);

  const schedule = async () => {
    setSchedBusy(true); setSchedNote(null);
    try {
      const { res, j } = await postJson(`${apiBase}/schedule`, "POST", {
        confirm: true,
        scheduledAt: schedAt ? new Date(schedAt).toISOString() : "",
        targets,
        message: schedAuto ? "" : message,
        link: link.trim() || undefined,
        imageUrl: imageUrl.trim() || undefined,
        title: title.trim() || undefined,
        autoGenerate: schedAuto,
        topic: schedAuto ? schedTopic : undefined,
        tone: schedTone,
      });
      if (!res.ok) setSchedNote({ ok: false, text: errText(j, res.status) });
      else {
        setSchedNote({ ok: true, text: `Scheduled for ${whenText(new Date(schedAt).toISOString())}. It publishes on its own when the time comes.` });
        setSchedAt(""); setSchedTopic("");
        void loadQueue();
      }
    } catch { setSchedNote({ ok: false, text: "Network error. The post was not scheduled." }); }
    finally { setSchedBusy(false); setConfirmSchedule(false); }
  };

  const cancelPost = async (id: string) => {
    setCancelBusy(true);
    try {
      const { res, j } = await postJson(`${apiBase}/schedule`, "DELETE", { id, confirm: true });
      if (!res.ok) setSchedNote({ ok: false, text: errText(j, res.status) });
      else if (Array.isArray(j.posts)) setQueue(j.posts as ScheduledPost[]);
    } catch { setSchedNote({ ok: false, text: "Network error. The post was not cancelled." }); }
    finally { setCancelBusy(false); setCancelId(null); }
  };

  return (
    <div className="space-y-4">
      <section className={card} aria-labelledby="sc-key" data-testid="social-key">
        <div className="flex items-center justify-between gap-2">
          <h3 id="sc-key" className="text-sm font-semibold text-ink">Your Gemini API key</h3>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${gemini.saved ? "border-ok/30 bg-ok-subtle text-ok" : "border-line-strong bg-surface-2 text-muted"}`}>
            {gemini.saved ? `Saved · ${gemini.preview}` : "Not saved"}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">
          Paste your own Gemini key from Google AI Studio. It is stored encrypted, tied to your account —
          the same way TARGET stores every provider key — and only this masked preview is ever shown again.
          It is used only to draft posts when you ask.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_220px]">
          <label className="sr-only" htmlFor="sc-key-input">Gemini API key</label>
          <input id="sc-key-input" type="password" autoComplete="off" value={keyInput} onChange={(e) => setKeyInput(e.target.value)}
            className={box} placeholder={gemini.saved ? "Paste a new key to replace the saved one" : "Paste your Gemini API key"} data-testid="social-key-input" />
          <label className="sr-only" htmlFor="sc-model-input">Gemini model (optional)</label>
          <input id="sc-model-input" value={modelInput} onChange={(e) => setModelInput(e.target.value)}
            className={box} placeholder="Model (optional, e.g. gemini-2.5-flash)" data-testid="social-key-model" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={btnPrimary} disabled={keyBusy || !keyInput.trim()} onClick={saveKey} data-testid="social-key-save">
            {keyBusy ? "Working…" : gemini.saved ? "Replace key" : "Save key"}
          </button>
          {gemini.saved && !confirmRemove && (
            <button type="button" className={btnGhost} disabled={keyBusy} onClick={() => setConfirmRemove(true)} data-testid="social-key-remove">Remove key</button>
          )}
          {gemini.saved && confirmRemove && (
            <>
              <span className="text-xs text-muted">Remove the saved key?</span>
              <button type="button" className={btnPrimary} disabled={keyBusy} onClick={removeKey} data-testid="social-key-remove-confirm">Yes, remove</button>
              <button type="button" className={btnGhost} disabled={keyBusy} onClick={() => setConfirmRemove(false)}>Keep it</button>
            </>
          )}
          {keyNote && <span role="status" className={`text-xs ${keyNote.ok ? "text-ok" : "text-danger"}`}>{keyNote.text}</span>}
        </div>
      </section>

      <section className={card} aria-labelledby="sc-blogger" data-testid="social-blogger">
        <div className="flex items-center justify-between gap-2">
          <h3 id="sc-blogger" className="text-sm font-semibold text-ink">Blogger</h3>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${blogger.connected && blogger.blog ? "border-ok/30 bg-ok-subtle text-ok" : "border-line-strong bg-surface-2 text-muted"}`}>
            {blogger.connected && blogger.blog ? `Posts to ${blogger.blog.blogName || "your blog"}` : blogger.connected ? "Connected · no blog chosen" : "Not connected"}
          </span>
        </div>
        {!blogger.oauthConfigured ? (
          <p className="mt-1 text-xs text-muted">
            Not set up on the server yet: {blogger.vars.filter((v) => !v.set).map((v) => v.name).join(", ") || "the Blogger OAuth client"} must be
            added as server env vars (a Google Cloud OAuth client with the Blogger API enabled) before Blogger can be connected.
          </p>
        ) : !blogger.connected ? (
          <>
            <p className="mt-1 text-xs text-muted">
              Connect your Google account once and TARGET can publish to your Blogger blog — the same way
              other providers are connected. Google asks only for the Blogger permission.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a href="/api/connectors/blogger/connect" className={btnPrimary} data-testid="blogger-connect">Connect Blogger</a>
              <span className="text-xs text-muted">After Google sends you back you will land on the Connectors page — come back here to pick the blog.</span>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted">
              Connected{blogger.accountLabel ? <> as <span className="font-medium text-ink">{blogger.accountLabel}</span></> : null}.
              {blogger.blog
                ? <> Posts from the composer and the schedule go to <span className="font-medium text-ink">{blogger.blog.blogName || "your blog"}</span>.</>
                : " No blog is chosen yet — pick the one posts should go to."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" className={btnGhost} disabled={bloggerBusy} onClick={() => void loadBlogs()} data-testid="blogger-load-blogs">
                {bloggerBusy ? "Working…" : blogs ? "Reload my blogs" : "Choose a blog"}
              </button>
              {blogs && blogs.length > 0 && (
                <>
                  <label className="sr-only" htmlFor="sc-blogger-pick">Blog</label>
                  <select id="sc-blogger-pick" value={blogPick} onChange={(e) => setBlogPick(e.target.value)} className="h-9 min-w-0 flex-1 rounded-full border border-line-strong bg-surface-2 px-3 text-sm text-ink" data-testid="blogger-blog-select">
                    {blogs.map((b) => <option key={b.id} value={b.id}>{b.name || b.id}</option>)}
                  </select>
                  <button type="button" className={btnPrimary} disabled={bloggerBusy || !blogPick} onClick={() => void saveBlog()} data-testid="blogger-save-blog">Save blog</button>
                </>
              )}
              {confirmDisconnect ? (
                <>
                  <span className="text-xs text-muted">Disconnect Blogger? Posts to it will fail until it is reconnected.</span>
                  <button type="button" className={btnPrimary} disabled={bloggerBusy} onClick={() => void disconnectBlogger()} data-testid="blogger-disconnect-confirm">Yes, disconnect</button>
                  <button type="button" className={btnGhost} disabled={bloggerBusy} onClick={() => setConfirmDisconnect(false)}>Keep it</button>
                </>
              ) : (
                <button type="button" className={btnGhost} disabled={bloggerBusy} onClick={() => setConfirmDisconnect(true)} data-testid="blogger-disconnect">Disconnect</button>
              )}
              {bloggerNote && <span role="status" className={`text-xs ${bloggerNote.ok ? "text-ok" : "text-danger"}`}>{bloggerNote.text}</span>}
            </div>
          </>
        )}
        {blogger.oauthConfigured && !blogger.connected && bloggerNote && (
          <p role="status" className={`mt-2 text-xs ${bloggerNote.ok ? "text-ok" : "text-danger"}`}>{bloggerNote.text}</p>
        )}
      </section>

      <section className={card} aria-labelledby="sc-draft" data-testid="social-draft">
        <h3 id="sc-draft" className="text-sm font-semibold text-ink">Draft with AI</h3>
        <p className="mt-1 text-xs text-muted">Give a topic or brief; Gemini writes a ready post with your saved key. You review and edit it below before anything is published.</p>
        <label className="sr-only" htmlFor="sc-topic">Topic or brief</label>
        <textarea id="sc-topic" rows={2} maxLength={SOCIAL_TOPIC_MAX} value={topic} onChange={(e) => setTopic(e.target.value)}
          className={`${box} mt-3`} placeholder="e.g. Announce that TARGET can now plan a whole week of meals" data-testid="social-topic" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="sc-tone">Style</label>
          <select id="sc-tone" value={tone} onChange={(e) => setTone(e.target.value as DraftTone)} className="h-9 rounded-full border border-line-strong bg-surface-2 px-3 text-sm text-ink" data-testid="social-tone">
            {DRAFT_TONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <button type="button" className={btnPrimary} disabled={draftBusy || !gemini.saved || !topic.trim()} onClick={generate} data-testid="social-generate">
            {draftBusy ? "Writing…" : "Write draft"}
          </button>
          {!gemini.saved && <span className="text-xs text-muted">Save your Gemini key above first.</span>}
          {draftNote && <span role="status" className={`text-xs ${draftNote.ok ? "text-ok" : "text-danger"}`}>{draftNote.text}</span>}
        </div>
      </section>

      <section className={card} aria-labelledby="sc-compose" data-testid="social-compose">
        <h3 id="sc-compose" className="text-sm font-semibold text-ink">Post</h3>
        <label className="sr-only" htmlFor="sc-message">Post text</label>
        <textarea id="sc-message" rows={5} maxLength={SOCIAL_MESSAGE_MAX} value={message} onChange={(e) => setMessage(e.target.value)}
          className={`${box} mt-3`} placeholder="Write the post once — it goes to every selected account." data-testid="social-message" />
        <p className="mt-1 text-right text-[11px] tabular-nums text-muted-soft">{message.length}/{SOCIAL_MESSAGE_MAX}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className="sr-only" htmlFor="sc-image">Public image URL (optional)</label>
            <input id="sc-image" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} className={box}
              placeholder="Image URL (https, public) — required for Instagram" data-testid="social-image" />
          </div>
          <div>
            <label className="sr-only" htmlFor="sc-link">Link (optional)</label>
            <input id="sc-link" value={link} onChange={(e) => setLink(e.target.value)} className={box}
              placeholder="Link (optional, Facebook only)" data-testid="social-link" />
          </div>
        </div>
        <div className="mt-2">
          <label className="sr-only" htmlFor="sc-title">Blog title (optional, Blogger only)</label>
          <input id="sc-title" value={title} maxLength={SOCIAL_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} className={box}
            placeholder="Blog title (optional — Blogger only; the first line of the post is used when empty)" data-testid="social-title" />
        </div>
        <fieldset className="mt-3">
          <legend className="text-xs font-medium text-muted">Post to</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {SOCIAL_TARGETS.map((t) => {
              // Blogger readiness is per-user and can change in this card (connect / pick a blog), so it
              // follows the live blogger state; the Meta targets keep the server-rendered status.
              const st = t.id === "blogger"
                ? blogger.connected && blogger.blog
                  ? { ready: true as const }
                  : initial.targets.blogger
                : initial.targets[t.id];
              const hint = t.id === "blogger" && blogger.blog ? `A post on ${blogger.blog.blogName || "your blog"}` : (targetHints?.[t.id] ?? t.hint);
              const on = targets.includes(t.id);
              return (
                <label key={t.id} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${on ? "border-accent/40 bg-accent/10 text-ink" : "border-line-strong bg-surface-2 text-muted"}`}>
                  <input type="checkbox" checked={on} onChange={() => toggleTarget(t.id)} data-testid={`social-target-${t.id}`} />
                  <span>{t.label}</span>
                  <span className="text-[11px] text-muted-soft">{st.ready ? hint : `Not set up: ${st.reason}`}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!confirmPublish ? (
            <button type="button" className={btnPrimary} disabled={!message.trim() || !targets.length} onClick={() => { setResults(null); setPubError(null); setConfirmPublish(true); }} data-testid="social-publish">
              Publish now
            </button>
          ) : (
            <>
              <span className="text-xs text-muted">Post this to {targets.map((t) => SOCIAL_TARGETS.find((x) => x.id === t)?.label).join(" and ")}? {confirmNote}</span>
              <button type="button" className={btnPrimary} disabled={pubBusy} onClick={publish} data-testid="social-publish-confirm">{pubBusy ? "Posting…" : "Yes, publish"}</button>
              <button type="button" className={btnGhost} disabled={pubBusy} onClick={() => setConfirmPublish(false)}>Cancel</button>
            </>
          )}
          {pubError && <span role="alert" className="text-xs text-danger">{pubError}</span>}
        </div>
        {results && (
          <ul className="mt-3 space-y-1.5" data-testid="social-results">
            {results.map((r) => (
              <li key={r.target} className={`rounded-xl border px-3 py-2 text-sm ${r.ok ? "border-ok/30 bg-ok-subtle text-ink" : "border-danger/30 bg-danger/10 text-ink"}`}>
                <span className="font-medium">{SOCIAL_TARGETS.find((x) => x.id === r.target)?.label}:</span>{" "}
                {r.ok
                  ? <>Published{r.url ? <> · <a className="text-accent underline" href={r.url} target="_blank" rel="noreferrer">view post</a></> : r.id ? ` · id ${r.id}` : ""}</>
                  : <span className="text-danger">{r.error}</span>}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 border-t border-line pt-4" data-testid="social-schedule-box">
          <h4 className="text-xs font-semibold text-ink">Or schedule it for later</h4>
          <p className="mt-1 text-xs text-muted">
            Pick a time and the post goes out on its own — TARGET publishes it to the accounts selected above,
            even if nobody is signed in. Or let Gemini write the text at post time from a topic.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="sc-sched-at">Date and time to post</label>
            <input id="sc-sched-at" type="datetime-local" value={schedAt} onChange={(e) => setSchedAt(e.target.value)}
              className="h-9 rounded-full border border-line-strong bg-surface-2 px-3 text-sm text-ink" data-testid="social-schedule-at" />
            <label className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${schedAuto ? "border-accent/40 bg-accent/10 text-ink" : "border-line-strong bg-surface-2 text-muted"}`}>
              <input type="checkbox" checked={schedAuto} onChange={() => setSchedAuto((v) => !v)} data-testid="social-schedule-auto" />
              <span>Write it with Gemini at post time</span>
            </label>
          </div>
          {schedAuto && (
            <div className="mt-2">
              <label className="sr-only" htmlFor="sc-sched-topic">Topic for the AI post</label>
              <textarea id="sc-sched-topic" rows={2} maxLength={SOCIAL_TOPIC_MAX} value={schedTopic} onChange={(e) => setSchedTopic(e.target.value)}
                className={box} placeholder="Topic/brief Gemini writes from when the time comes" data-testid="social-schedule-topic" />
              <div className="mt-2">
                <label className="sr-only" htmlFor="sc-sched-tone">Style for the AI post</label>
                <select id="sc-sched-tone" value={schedTone} onChange={(e) => setSchedTone(e.target.value as DraftTone)} className="h-9 rounded-full border border-line-strong bg-surface-2 px-3 text-sm text-ink" data-testid="social-schedule-tone">
                  {DRAFT_TONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                {!gemini.saved && <span className="ml-2 text-xs text-danger">No Gemini key saved — the post will fail at post time until the key above is added.</span>}
              </div>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!confirmSchedule ? (
              <button type="button" className={btnGhost} disabled={!schedAt || !targets.length || (schedAuto ? !schedTopic.trim() : !message.trim())}
                onClick={() => setConfirmSchedule(true)} data-testid="social-schedule">
                Schedule post
              </button>
            ) : (
              <>
                <span className="text-xs text-muted">
                  Schedule {schedAuto ? "an AI-written post" : "this post"} for {schedAt ? whenText(new Date(schedAt).toISOString()) : ""} to {targets.map((t) => SOCIAL_TARGETS.find((x) => x.id === t)?.label).join(" and ")}? {confirmNote}
                </span>
                <button type="button" className={btnPrimary} disabled={schedBusy} onClick={schedule} data-testid="social-schedule-confirm">{schedBusy ? "Scheduling…" : "Yes, schedule"}</button>
                <button type="button" className={btnGhost} disabled={schedBusy} onClick={() => setConfirmSchedule(false)}>Cancel</button>
              </>
            )}
            {schedNote && <span role="status" className={`text-xs ${schedNote.ok ? "text-ok" : "text-danger"}`}>{schedNote.text}</span>}
          </div>
        </div>
      </section>

      <section className={card} aria-labelledby="sc-queue" data-testid="social-scheduled">
        <div className="flex items-center justify-between gap-2">
          <h3 id="sc-queue" className="text-sm font-semibold text-ink">Scheduled posts</h3>
          <button type="button" className={btnGhost} disabled={queueBusy} onClick={() => void loadQueue()} data-testid="social-scheduled-refresh">
            {queueBusy ? "Loading…" : "Refresh"}
          </button>
        </div>
        {queue === null ? (
          <p className="mt-2 text-xs text-muted">{queueBusy ? "Loading the queue…" : "The queue could not be loaded. Use Refresh to try again."}</p>
        ) : queue.length === 0 ? (
          <p className="mt-2 text-xs text-muted">Nothing scheduled yet. Write a post above, pick a time, and it will appear here.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {queue.map((p) => (
              <li key={p.id} className="rounded-xl border border-line bg-bg/60 px-3 py-2" data-testid="social-scheduled-item">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">{whenText(p.scheduledAt)}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[p.status]}`}>{p.status}</span>
                  <span className="text-[11px] text-muted-soft">{p.targets.map((t) => SOCIAL_TARGETS.find((x) => x.id === t)?.label).join(" · ")}</span>
                  {p.status === "pending" && cancelId !== p.id && (
                    <button type="button" className="ml-auto text-xs font-medium text-danger underline" disabled={cancelBusy} onClick={() => setCancelId(p.id)} data-testid={`social-scheduled-cancel-${p.id}`}>Cancel</button>
                  )}
                  {p.status === "pending" && cancelId === p.id && (
                    <span className="ml-auto flex items-center gap-2">
                      <span className="text-xs text-muted">Cancel this post?</span>
                      <button type="button" className="text-xs font-medium text-danger underline" disabled={cancelBusy} onClick={() => void cancelPost(p.id)} data-testid={`social-scheduled-cancel-confirm-${p.id}`}>{cancelBusy ? "Working…" : "Yes, cancel"}</button>
                      <button type="button" className="text-xs text-muted underline" disabled={cancelBusy} onClick={() => setCancelId(null)}>Keep it</button>
                    </span>
                  )}
                </div>
                {p.title && <p className="mt-1 truncate text-sm font-medium text-ink-soft">Blog title: {p.title}</p>}
                <p className="mt-1 line-clamp-2 text-sm text-ink-soft">
                  {p.autoGenerate ? <><span className="text-muted">AI post · </span>{p.topic}</> : p.message}
                </p>
                {p.imageUrl && <p className="mt-0.5 truncate text-[11px] text-muted-soft">{p.imageUrl}</p>}
                {p.error && <p role="alert" className="mt-1 text-xs text-danger">{p.error}</p>}
                {p.results && (
                  <ul className="mt-1 space-y-0.5">
                    {p.results.map((r) => (
                      <li key={r.target} className="text-xs text-muted">
                        <span className="font-medium text-ink-soft">{SOCIAL_TARGETS.find((x) => x.id === r.target)?.label}:</span>{" "}
                        {r.ok
                          ? <>published{r.url ? <> · <a className="text-accent underline" href={r.url} target="_blank" rel="noreferrer">view post</a></> : ""}</>
                          : <span className="text-danger">{r.error}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
