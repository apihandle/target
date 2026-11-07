"use client";
import Link from "next/link";
import VoiceButton from "@/components/VoiceButton";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { useAssistantState } from "@/components/home/AssistantState";

const STATUS_LABEL = { ready: "Ready", listening: "Listening", thinking: "Thinking", speaking: "Speaking" } as const;

function MicIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
  );
}

/**
 * The assistant status card at the top of Home: live state (Ready / Listening / Thinking /
 * Speaking / Offline), a mic, the last thing heard and TARGET's last reply, and the status
 * pills (connection, wake word, mode, app lock). Phone-only pills appear only in the app.
 */
export default function AssistantCard({ lastReply }: { lastReply?: string | null }) {
  const s = useAssistantState();
  const status = !s.online ? "Offline" : STATUS_LABEL[s.voice];
  const active = s.online && s.voice !== "ready";

  const nativeMic = s.inApp ? (
    <button type="button" data-testid="voice-btn-native" onClick={s.startListening} aria-pressed={s.voice === "listening"}
      aria-label={s.voice === "listening" ? "Listening — tap to stop" : "Speak to TARGET"}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition ${s.voice === "listening" ? "animate-pulse bg-danger-subtle text-danger" : "text-muted hover:bg-surface-3 hover:text-ink"}`}>
      <MicIcon />
    </button>
  ) : null;

  return (
    <section aria-labelledby="assistant-title" data-testid="assistant-card" className="mt-5">
      <h2 id="assistant-title" className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-soft">Assistant</h2>
      <Card>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p role="status" data-testid="assistant-status" className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${s.online ? "bg-accent" : "bg-muted-soft"} ${active ? "motion-safe:animate-pulse" : ""}`} />
              {status}
            </p>
            {s.lastHeard ? (
              <p data-testid="assistant-heard" className="mt-1.5 truncate text-sm text-ink-soft" title={s.lastHeard}>
                You said: <span className="text-ink">“{s.lastHeard}”</span>{" "}
                <Link href={`/app?q=${encodeURIComponent(s.lastHeard)}&send=1`} className="whitespace-nowrap font-medium text-accent hover:text-accent-strong">Send →</Link>
              </p>
            ) : lastReply ? (
              <p data-testid="assistant-reply" className="mt-1.5 line-clamp-2 text-sm text-muted" title={lastReply}>TARGET: {lastReply}</p>
            ) : (
              <p className="mt-1.5 text-sm text-muted">Ask by voice, or use the box below.</p>
            )}
            {s.lastHeard && lastReply && (
              <p data-testid="assistant-reply" className="mt-1 line-clamp-2 text-sm text-muted" title={lastReply}>TARGET: {lastReply}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {s.inApp && lastReply && (
              <button type="button" onClick={() => s.speak(lastReply)} aria-label="Hear the last reply"
                className="grid h-11 w-11 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-ink">
                <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 010 7M18.5 5.5a9.4 9.4 0 010 13" /></svg>
              </button>
            )}
            <VoiceButton onText={s.hear} fallback={nativeMic} />
          </div>
        </div>

        <ul data-testid="assistant-pills" aria-label="Assistant status" className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <li><Badge tone={s.online ? "ok" : "warn"}>{s.online ? "Online" : "Offline"}</Badge></li>
          {s.inApp && s.wakeWord !== null && (
            <li>
              {s.canToggleWakeWord ? (
                <button type="button" onClick={s.toggleWakeWord} aria-pressed={s.wakeWord} aria-label="Toggle wake word"
                  className="inline-flex min-h-11 items-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                  <Badge tone={s.wakeWord ? "ok" : "neutral"}>Wake word {s.wakeWord ? "on" : "off"}</Badge>
                </button>
              ) : (
                <Badge tone={s.wakeWord ? "ok" : "neutral"}>Wake word {s.wakeWord ? "on" : "off"}</Badge>
              )}
            </li>
          )}
          <li>
            <button type="button" onClick={s.toggleMode} aria-pressed={s.mode === "agent"} aria-label="Toggle assistant mode"
              className="inline-flex min-h-11 items-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
              <Badge tone={s.mode === "agent" ? "accent" : "neutral"}>Mode: {s.mode === "agent" ? "Agent" : "Normal"}</Badge>
            </button>
          </li>
          {s.inApp && s.appLock !== null && (
            <li><Badge tone={s.appLock ? "ok" : "warn"}>App lock {s.appLock ? "on" : "off"}</Badge></li>
          )}
        </ul>
      </Card>
    </section>
  );
}
