"use client";
import { useState } from "react";
import ConfirmAction from "@/components/admin/ConfirmAction";
import { ANNOUNCEMENT_MAX, FEATURES, FEATURE_LABELS, MAINTENANCE_MAX, type Announcement, type FeatureFlags, type Maintenance } from "@/lib/adminConfig";

const box = "w-full rounded-xl border border-line-strong bg-bg/80 px-3 py-2 text-sm text-ink placeholder:text-muted-soft outline-none focus:border-accent";
const card = "rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur-xl";

function State({ on, onText = "On", offText = "Off" }: { on: boolean; onText?: string; offText?: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${on ? "border-ok/30 bg-ok-subtle text-ok" : "border-line-strong bg-surface-2 text-muted"}`}>{on ? onText : offText}</span>;
}

/** Announcement, maintenance, kill-switches and "Run cron now". Each change opens a confirm dialog and is audited. */
export default function ControlsPanel({ announcement, maintenance, features, cronReady }: { announcement: Announcement; maintenance: Maintenance; features: FeatureFlags; cronReady: boolean }) {
  const [text, setText] = useState(announcement.text);
  const [message, setMessage] = useState(maintenance.message);
  return (
    <div className="space-y-4">
      <section className={card} aria-labelledby="c-ann" data-testid="controls-announcement">
        <div className="flex items-center justify-between gap-2"><h3 id="c-ann" className="text-sm font-semibold text-ink">Announcement banner</h3><State on={announcement.enabled} onText="Showing" offText="Hidden" /></div>
        <p className="mt-1 text-xs text-muted">Shown at the top of every /app page for everyone. Plain text, up to {ANNOUNCEMENT_MAX} characters.</p>
        <label htmlFor="ann-text" className="sr-only">Announcement text</label>
        <textarea id="ann-text" rows={3} maxLength={ANNOUNCEMENT_MAX} value={text} onChange={(e) => setText(e.target.value)} className={`${box} mt-3`} placeholder="e.g. Browser tasks are slow today; we're on it." data-testid="ann-text" />
        <p className="mt-1 text-right text-[11px] tabular-nums text-muted-soft">{text.trim().length}/{ANNOUNCEMENT_MAX}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <ConfirmAction label={announcement.enabled ? "Update banner" : "Show banner"} title={announcement.enabled ? "Update the banner?" : "Show this banner to everyone?"}
            message={<span className="break-words">“{text.trim()}”</span>} confirmLabel="Show banner" url="/api/admin/settings" variant="primary" testId="ann-show"
            validate={() => (!text.trim() ? "Write the announcement text first." : null)} getBody={() => ({ key: "announcement", value: { enabled: true, text } })} successText={() => "Banner is live (other servers pick it up within 15 s)."} />
          {announcement.enabled && (
            <ConfirmAction label="Hide banner" title="Hide the banner?" confirmLabel="Hide banner" url="/api/admin/settings" testId="ann-hide"
              getBody={() => ({ key: "announcement", value: { enabled: false, text } })} successText={() => "Banner hidden."} />
          )}
        </div>
      </section>

      <section className={card} aria-labelledby="c-mnt" data-testid="controls-maintenance">
        <div className="flex items-center justify-between gap-2"><h3 id="c-mnt" className="text-sm font-semibold text-ink">Maintenance mode</h3><State on={maintenance.enabled} onText="On: /app closed" offText="Off" /></div>
        <p className="mt-1 text-xs text-muted">Closes /app and its APIs for everyone except admins (you can keep using it). The landing page stays up.</p>
        <label htmlFor="mnt-msg" className="sr-only">Maintenance message</label>
        <textarea id="mnt-msg" rows={2} maxLength={MAINTENANCE_MAX} value={message} onChange={(e) => setMessage(e.target.value)} className={`${box} mt-3`} placeholder="Optional message, e.g. Back in 30 minutes." data-testid="mnt-msg" />
        <div className="mt-2">
          {maintenance.enabled ? (
            <ConfirmAction label="Turn maintenance off" title="Open /app again for everyone?" confirmLabel="Turn off" url="/api/admin/settings" variant="primary" testId="mnt-off"
              getBody={() => ({ key: "maintenance", value: { enabled: false, message } })} successText={() => "Maintenance is off."} />
          ) : (
            <ConfirmAction label="Turn maintenance on" title="Close /app for everyone except admins?" message="Signed-in users see the maintenance page and their requests are refused until you turn it off." confirmLabel="Turn on" url="/api/admin/settings" danger variant="danger" testId="mnt-on"
              getBody={() => ({ key: "maintenance", value: { enabled: true, message } })} successText={() => "Maintenance is on."} />
          )}
        </div>
      </section>

      <section className={card} aria-labelledby="c-ks" data-testid="controls-features">
        <h3 id="c-ks" className="text-sm font-semibold text-ink">Feature switches</h3>
        <p className="mt-1 text-xs text-muted">Turning one off stops it on the server for everyone, including approval cards tapped later.</p>
        <ul className="mt-3 divide-y divide-line">
          {FEATURES.map((f) => (
            <li key={f} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`feature-${f}`}>
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-ink">{FEATURE_LABELS[f].title} <State on={features[f]} /></p>
                <p className="text-xs text-muted">{FEATURE_LABELS[f].description}</p>
              </div>
              <ConfirmAction label={features[f] ? "Turn off" : "Turn on"} title={`${features[f] ? "Turn off" : "Turn on"} ${FEATURE_LABELS[f].title.toLowerCase()}?`}
                message={features[f] ? "Users get a short “turned off right now” reply instead." : undefined}
                confirmLabel={features[f] ? "Turn off" : "Turn on"} url="/api/admin/settings" danger={features[f]} variant={features[f] ? "danger" : "primary"} testId={`feature-${f}-toggle`}
                body={{ key: "features", value: { [f]: !features[f] } }} successText={() => "Saved."} />
            </li>
          ))}
        </ul>
      </section>

      <section className={card} aria-labelledby="c-cron" data-testid="controls-cron">
        <h3 id="c-cron" className="text-sm font-semibold text-ink">Run cron now</h3>
        <p className="mt-1 text-xs text-muted">Runs a cron job in this request instead of waiting for the schedule.{cronReady ? "" : " CRON_SECRET is missing on the server, so this can't run."}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ConfirmAction label="Run scheduled prompts" title="Run due scheduled prompts now?" message="Only prompts that are already due run (up to 3). Takes up to a minute." confirmLabel="Run now" url="/api/admin/cron" disabled={!cronReady} testId="cron-scheduled"
            body={{ job: "scheduled" }} successText={(r) => { const s = r.summary as Record<string, unknown> | undefined; return s?.disabled ? "Scheduled tasks are switched off: nothing ran." : `Done: ${Number(s?.ran ?? 0)} ran.`; }} />
          <ConfirmAction label="Run For-you scan" title="Run the For-you scan now?" message="Scans up to 6 users with Google connected who weren't scanned in 20 h." confirmLabel="Run now" url="/api/admin/cron" disabled={!cronReady} testId="cron-proactive"
            body={{ job: "proactive" }} successText={(r) => `Done: ${Number((r.summary as Record<string, unknown> | undefined)?.scanned ?? 0)} scanned.`} />
        </div>
      </section>
    </div>
  );
}
