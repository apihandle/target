export const ACTIVITY_CATEGORIES = ["task", "approval", "outcome", "project", "panel", "connection", "memory"] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export type ActivityEvent = {
  id: string; category: ActivityCategory; title: string; detail: string; status: string | null;
  project_id: string | null; task_id: string | null; approval_id: string | null; created_at: string;
};
export const ACTIVITY_COLS = "id, category, title, detail, status, project_id, task_id, approval_id, created_at";

/** Filters on the Activity page. "outcomes" = results of approved actions and finished/failed tasks. */
export const ACTIVITY_FILTERS = {
  all: null,
  tasks: ["task"],
  approvals: ["approval"],
  outcomes: ["outcome"],
} as const satisfies Record<string, readonly ActivityCategory[] | null>;
export type ActivityFilter = keyof typeof ACTIVITY_FILTERS;

export function parseFilter(v: string | null | undefined): ActivityFilter {
  return v && Object.prototype.hasOwnProperty.call(ACTIVITY_FILTERS, v) ? (v as ActivityFilter) : "all";
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
