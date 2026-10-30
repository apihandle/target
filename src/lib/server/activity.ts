import type { Db } from "@/lib/server/auth";
import type { ActivityCategory } from "@/lib/activity";

export type NewEvent = {
  category: ActivityCategory; title: string; detail?: string; status?: string | null;
  project_id?: string | null; task_id?: string | null; approval_id?: string | null;
};

/** Append an activity record for the user. Never throws: history must not break the action it describes. */
export async function logActivity(db: Db, userId: string, ev: NewEvent): Promise<void> {
  try {
    const { error } = await db.from("activity_events").insert({
      user_id: userId, category: ev.category, title: ev.title.slice(0, 200), detail: (ev.detail ?? "").slice(0, 1000),
      status: ev.status ?? null, project_id: ev.project_id ?? null, task_id: ev.task_id ?? null, approval_id: ev.approval_id ?? null,
    });
    if (error) console.error("[activity] insert failed:", error.message);
  } catch (e) {
    console.error("[activity] insert threw:", e instanceof Error ? e.message : e);
  }
}
