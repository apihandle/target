import type { Db } from "@/lib/server/auth";
import type { ConnectorDef } from "@/lib/connectors/types";
import { logActivity } from "@/lib/server/activity";

/**
 * After a connect, tasks that were paused waiting for this connector move back to in_progress.
 * The chat then continues them (the Connect button returns to the chat with ?resume=<task>).
 */
export async function resumeTasksFor(db: Db, userId: string, c: ConnectorDef): Promise<number> {
  try {
    const { data } = await db.from("tasks")
      .update({ status: "in_progress", progress: `${c.name} connected. Open the chat to let TARGET continue.`, updated_at: new Date().toISOString() })
      .eq("user_id", userId).eq("status", "needs_connection").eq("needs_connector", c.id).select("id, title, project_id");
    for (const t of (data ?? []) as { id: string; title: string; project_id: string | null }[])
      await logActivity(db, userId, { category: "task", title: `Resumed “${t.title}”`, detail: `${c.name} is connected now.`, status: "in_progress", task_id: t.id, project_id: t.project_id });
    return data?.length ?? 0;
  } catch { return 0; }
}
