"use client";
import { useState } from "react";
import { SOCIAL_TOPIC_MAX } from "@/lib/socialConfig";

const box = "w-full rounded-xl border border-line-strong bg-bg/80 px-3 py-2 text-sm text-ink placeholder:text-muted-soft outline-none focus:border-accent";
const card = "rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur-xl";
const btn = "inline-flex h-9 items-center rounded-full px-4 text-sm font-medium transition disabled:opacity-50";
const btnPrimary = `${btn} bg-accent text-accent-ink hover:brightness-110`;

export type AutopilotSettingsView = { enabled: boolean; topic: string };

export type BloggerAutopilotCardProps = {
  initial: AutopilotSettingsView;
  /** From the same status the composer already loads — this card adds no status logic of its own. */
  bloggerConnected: boolean;
  blogName: string | null;
  aiKeySaved: boolean;
  apiBase?: string;
};

/**
 * Blogger autopilot (/app/social): the user flips one switch and names the topic; TARGET then writes
 * and posts to their connected blog on its own every 4 hours (the social cron generates one post per
 * opted-in user with their own AI key — NVIDIA when saved, else Gemini — queues it, and the same run
 * publishes it). This card only saves the switch + topic via /api/social/autopilot — the
 * prerequisites it reports (Blogger connected, a blog chosen, an AI key saved) come from the page's
 * existing status, and each one is set up in the composer's own cards above.
 */
export default function BloggerAutopilotCard({
  initial,
  bloggerConnected,
  blogName,
  aiKeySaved,
  apiBase = "/api/social",
}: BloggerAutopilotCardProps) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [topic, setTopic] = useState(initial.topic);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const missing: string[] = [];
  if (!bloggerConnected) missing.push("connect Blogger above");
  else if (!blogName) missing.push("choose a blog above");
  if (!aiKeySaved) missing.push("save your AI key (NVIDIA or Gemini)");

  const statusLine = enabled
    ? missing.length
      ? `Autopilot is on, but it can't post yet — still needed: ${missing.join(", ")}.`
      : `Autopilot is on: TARGET writes a new post about your topic and publishes it to ${blogName} every 4 hours. Nothing for you to do.`
    : missing.length
      ? `Before autopilot can run: ${missing.join(", ")} — then turn it on here.`
      : `Everything autopilot needs is set up. Turn it on and TARGET will post to ${blogName} every 4 hours.`;

  const save = async () => {
    setBusy(true); setNote(null);
    try {
      const res = await fetch(`${apiBase}/autopilot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, topic }),
      });
      const j = (await res.json().catch(() => ({}))) as { autopilot?: AutopilotSettingsView; error?: string };
      if (!res.ok) setNote({ ok: false, text: typeof j.error === "string" ? j.error : `Failed (HTTP ${res.status})` });
      else {
        if (j.autopilot) { setEnabled(j.autopilot.enabled); setTopic(j.autopilot.topic); }
        setNote({ ok: true, text: enabled ? "Saved. Autopilot is on — the next post goes out on the next 4-hour run." : "Saved. Autopilot is off." });
      }
    } catch { setNote({ ok: false, text: "Network error. The settings were not saved." }); }
    finally { setBusy(false); }
  };

  return (
    <section className={card} aria-labelledby="sc-autopilot" data-testid="social-autopilot">
      <div className="flex items-center justify-between gap-2">
        <h3 id="sc-autopilot" className="text-sm font-semibold text-ink">Blogger autopilot</h3>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${enabled && !missing.length ? "border-ok/30 bg-ok-subtle text-ok" : "border-line-strong bg-surface-2 text-muted"}`}>
          {enabled ? (missing.length ? "On · waiting on setup" : "On · every 4 hours") : "Off"}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">
        Turn it on and TARGET does the blogging for you: every 4 hours it writes one post about your
        topic with your AI key (NVIDIA when saved, else Gemini) and publishes it to your chosen
        Blogger blog — no drafts to approve, nothing to press. Turn it off any time and it stops.
      </p>
      <p role="status" className="mt-2 text-xs text-muted" data-testid="autopilot-status">{statusLine}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${enabled ? "border-accent/40 bg-accent/10 text-ink" : "border-line-strong bg-surface-2 text-muted"}`}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} data-testid="autopilot-toggle" />
          <span>Post to my blog automatically</span>
        </label>
      </div>
      <label className="sr-only" htmlFor="sc-autopilot-topic">What should the posts be about?</label>
      <textarea id="sc-autopilot-topic" rows={2} maxLength={SOCIAL_TOPIC_MAX} value={topic} onChange={(e) => setTopic(e.target.value)}
        className={`${box} mt-3`} placeholder="What should the posts be about? e.g. Free AI tools and how to use them" data-testid="autopilot-topic" />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()} data-testid="autopilot-save">
          {busy ? "Saving…" : "Save autopilot"}
        </button>
        {note && <span role="status" className={`text-xs ${note.ok ? "text-ok" : "text-danger"}`}>{note.text}</span>}
      </div>
    </section>
  );
}
