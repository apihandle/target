"use client";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { useAssistantState } from "@/components/home/AssistantState";
import { notificationHeadline } from "@/lib/targetAndroid";

export type TodayItem = { title: string; at: string };

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function Tile({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className="rounded-2xl border border-line bg-surface/80 p-3.5">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-soft">{label}</p>
      <div className="mt-1.5 text-sm text-ink">{children}</div>
    </div>
  );
}

function Skeleton() {
  return <div aria-hidden className="h-[76px] animate-pulse rounded-2xl border border-line bg-surface/60" />;
}

/**
 * "Today" on Home: the next reminder and calendar event (from the same suggestions the
 * For you strip uses), plus phone state from the Android bridge — next alarm, battery and
 * Do Not Disturb, and a notification summary. Phone cards exist only in the app; when
 * notification access is missing there, an EmptyState-style card offers the grant action.
 */
export default function TodaySection({ reminder, event }: { reminder: TodayItem | null; event: TodayItem | null }) {
  const s = useAssistantState();
  const hasServer = !!(reminder || event);
  if (s.ready && !hasServer && !s.inApp) return null;

  const alarmText = s.nextAlarm ? (s.nextAlarm.time || (s.nextAlarm.at ? fmtWhen(s.nextAlarm.at) : "")) : "";
  const appLines = s.notifications
    ? Object.entries(s.notifications.byApp).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, 2)
    : [];

  return (
    <section aria-labelledby="today-title" data-testid="home-today" className="mt-6">
      <h2 id="today-title" className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-soft">Today</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {reminder && (
          <Tile label="Next reminder" testId="today-reminder">
            <p className="font-medium">{reminder.title}</p>
            <p className="mt-0.5 text-xs text-muted">{fmtWhen(reminder.at)}</p>
          </Tile>
        )}
        {event && (
          <Tile label="Next event" testId="today-event">
            <p className="font-medium">{event.title}</p>
            <p className="mt-0.5 text-xs text-muted">{fmtWhen(event.at)}</p>
          </Tile>
        )}
        {!s.ready && (<><Skeleton /><Skeleton /></>)}
        {s.inApp && alarmText && (
          <Tile label="Next alarm" testId="today-alarm">
            <p className="font-medium">{alarmText}</p>
            {s.nextAlarm?.label && <p className="mt-0.5 text-xs text-muted">{s.nextAlarm.label}</p>}
          </Tile>
        )}
        {s.inApp && s.battery && (
          <Tile label="Phone" testId="today-phone">
            <p className="font-medium">{s.battery.level}%{s.battery.charging ? " · Charging" : ""}</p>
            {s.dnd !== null && <p className="mt-0.5 text-xs text-muted">Do Not Disturb {s.dnd ? "on" : "off"}</p>}
          </Tile>
        )}
        {s.inApp && (s.notifications ? (
          <Tile label="Notifications" testId="today-notifications">
            <p className="font-medium">{notificationHeadline(s.notifications)}</p>
            {appLines.map(([app, count]) => (
              <p key={app} className="mt-0.5 text-xs text-muted">{app}: {count}</p>
            ))}
          </Tile>
        ) : s.notificationsBlocked ? (
          <div data-testid="today-notifications-blocked" className="rounded-xl2 border border-dashed border-line-strong p-4">
            <p className="text-sm font-medium text-ink">Notifications aren't connected</p>
            <p className="mt-1 text-sm text-muted">Allow notification access so TARGET can sum up what's new on your phone.</p>
            <div className="mt-3">
              <Button size="sm" onClick={s.grantNotifications}>Allow access</Button>
            </div>
          </div>
        ) : null)}
      </div>
    </section>
  );
}
