import Link from "next/link";
import { Badge, toneFor } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { timeAgo, type ActivityEvent } from "@/lib/activity";

const CAT_LABEL: Record<string, string> = { task: "Task", approval: "Approval", outcome: "Outcome", project: "Project", panel: "Panel", connection: "Connection", memory: "Memory" };

function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" });
}

export default function ActivityTimeline({ events, projectNames = {}, emptyText = "Nothing has happened yet. Tasks, approvals and their outcomes will show up here." }: { events: ActivityEvent[]; projectNames?: Record<string, string>; emptyText?: string }) {
  if (!events.length) return <EmptyState title="No activity" testId="activity-empty">{emptyText}</EmptyState>;
  const groups: [string, ActivityEvent[]][] = [];
  for (const e of events) {
    const k = dayKey(e.created_at);
    const g = groups[groups.length - 1];
    if (g && g[0] === k) g[1].push(e); else groups.push([k, [e]]);
  }
  return (
    <div data-testid="activity-timeline" className="space-y-6">
      {groups.map(([day, list]) => (
        <section key={day} aria-label={day}>
          <h3 className="mb-2 text-xs font-medium text-muted">{day}</h3>
          <ol className="relative space-y-3 border-l border-line pl-5">
            {list.map((e) => (
              <li key={e.id} data-testid="activity-item" data-category={e.category} className="relative">
                <span aria-hidden className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-bg ${e.status === "failed" ? "bg-danger" : e.status === "pending" ? "bg-warn" : e.category === "outcome" ? "bg-ok" : "bg-line-strong"}`} />
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-ink">{e.title}</p>
                  <Badge tone={e.status ? toneFor(e.status) : "neutral"}>{CAT_LABEL[e.category] ?? e.category}</Badge>
                </div>
                {e.detail && <p className="mt-0.5 text-xs text-muted">{e.detail}</p>}
                <p className="mt-0.5 text-[11px] text-muted-soft">
                  <time dateTime={e.created_at}>{timeAgo(e.created_at)}</time>
                  {e.project_id && projectNames[e.project_id] && <> · <Link className="hover:underline" href={`/app/projects/${e.project_id}`}>{projectNames[e.project_id]}</Link></>}
                </p>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
