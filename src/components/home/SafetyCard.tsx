"use client";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { useAssistantState } from "@/components/home/AssistantState";

/**
 * Compact safety card on Home: app lock status and an SOS action. SOS only fires through
 * the confirm step, and only in app builds that expose it on the bridge — everywhere else
 * it stays disabled with "Coming soon".
 */
export default function SafetyCard() {
  const s = useAssistantState();
  const lockLine = !s.inApp
    ? "App lock is managed in the TARGET app."
    : s.appLock === null
      ? "App lock status isn't available in this app build."
      : s.appLock
        ? "App lock is on."
        : "App lock is off.";

  return (
    <section aria-labelledby="safety-title" data-testid="home-safety" className="mt-8">
      <h2 id="safety-title" className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-soft">Safety</h2>
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/80 px-4 py-3">
        <p className="min-w-0 flex-1 text-sm text-ink-soft">{lockLine}</p>
        {s.sosAvailable ? (
          <ConfirmButton label="SOS" confirmLabel="Send SOS" question="Send an SOS alert now?" testId="sos-btn" onConfirm={s.triggerSos} />
        ) : (
          <span className="inline-flex items-center gap-2">
            <Button variant="danger" size="sm" disabled data-testid="sos-btn">SOS</Button>
            <span className="text-xs text-muted">Coming soon</span>
          </span>
        )}
      </div>
    </section>
  );
}
