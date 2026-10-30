import { cleanMultiline, cleanText, isUuid } from "@/lib/ids";

export const TASK_STATUSES = ["queued", "planning", "in_progress", "waiting_approval", "completed", "failed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type Task = {
  id: string; title: string; notes: string; status: TaskStatus; progress: string; error: string | null;
  origin: "user" | "assistant"; project_id: string | null; conversation_id: string | null;
  created_at?: string; updated_at?: string;
};

export const TASK_COLS = "id, title, notes, status, progress, error, origin, project_id, conversation_id, created_at, updated_at";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: "Queued", planning: "Planning", in_progress: "In progress", waiting_approval: "Waiting for approval",
  completed: "Completed", failed: "Failed", cancelled: "Cancelled",
};

/** Allowed lifecycle moves. "waiting_approval" is entered only by the server when an approval is requested. */
const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  queued: ["planning", "in_progress", "completed", "cancelled"],
  planning: ["in_progress", "waiting_approval", "failed", "cancelled"],
  in_progress: ["planning", "waiting_approval", "completed", "failed", "cancelled"],
  waiting_approval: ["in_progress", "completed", "failed", "cancelled"],
  completed: ["queued"],
  failed: ["queued", "planning", "in_progress", "cancelled"],
  cancelled: ["queued"],
};

/** Statuses a user may set by hand. The approval/assistant statuses are system-owned. */
export const USER_SETTABLE: TaskStatus[] = ["queued", "in_progress", "completed", "cancelled"];

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || (TRANSITIONS[from]?.includes(to) ?? false);
}

export function isOpen(s: TaskStatus) {
  return s !== "completed" && s !== "cancelled";
}

type NewTask = { title: string; notes: string; project_id: string | null };
export function validateNewTask(input: Record<string, unknown>): { ok: true; value: NewTask } | { ok: false; error: string; field?: string } {
  const title = cleanText(input.title, 201);
  if (!title) return { ok: false, error: "Give the task a title", field: "title" };
  if (title.length > 200) return { ok: false, error: "Title is too long (200 max)", field: "title" };
  const notes = cleanMultiline(input.notes, 2001);
  if (notes.length > 2000) return { ok: false, error: "Notes are too long", field: "notes" };
  const pid = input.project_id ?? input.projectId ?? null;
  if (pid !== null && pid !== undefined && pid !== "" && !isUuid(pid)) return { ok: false, error: "Unknown project", field: "project_id" };
  return { ok: true, value: { title, notes, project_id: isUuid(pid) ? pid : null } };
}

type TaskPatch = { title?: string; notes?: string; status?: TaskStatus };
export function validateTaskPatch(input: Record<string, unknown>): { ok: true; value: TaskPatch } | { ok: false; error: string } {
  const value: TaskPatch = {};
  if (input.title !== undefined) {
    const t = cleanText(input.title, 201);
    if (!t || t.length > 200) return { ok: false, error: "Title must be 1–200 characters" };
    value.title = t;
  }
  if (input.notes !== undefined) {
    const n = cleanMultiline(input.notes, 2001);
    if (n.length > 2000) return { ok: false, error: "Notes are too long" };
    value.notes = n;
  }
  if (input.status !== undefined) {
    if (!USER_SETTABLE.includes(input.status as TaskStatus)) return { ok: false, error: "That status can't be set by hand" };
    value.status = input.status as TaskStatus;
  }
  if (!Object.keys(value).length) return { ok: false, error: "Nothing to update" };
  return { ok: true, value };
}

export function summarizeTasks(tasks: Pick<Task, "status">[]) {
  const by = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
  for (const t of tasks) by[t.status] = (by[t.status] ?? 0) + 1;
  return { total: tasks.length, open: tasks.filter((t) => isOpen(t.status)).length, by };
}

/** Compact list of open tasks for the assistant's context. */
export function tasksBlock(tasks: Pick<Task, "title" | "status">[]): string {
  const open = tasks.filter((t) => isOpen(t.status)).slice(0, 15);
  if (!open.length) return "\n\nThe user has no open tasks in TARGET right now.";
  return "\n\nThe user's open tasks in TARGET (status in brackets):\n" + open.map((t) => `- ${t.title} [${STATUS_LABEL[t.status]}]`).join("\n");
}
