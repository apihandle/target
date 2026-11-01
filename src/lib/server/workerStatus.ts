import { createAdminClient } from "@/lib/supabase/admin";
import type { Db } from "@/lib/server/auth";

/** A worker counts as online when it asked for a job in the last 90 seconds (it asks every few seconds). */
export const ONLINE_MS = 90_000;

export type WorkerBeat = { id: string; modes: string[]; seen_at: string };

export function isOnline(beats: WorkerBeat[], mode?: string, now = Date.now()): boolean {
  return beats.some((b) => now - new Date(b.seen_at).getTime() < ONLINE_MS && (!mode || b.modes.includes(mode)));
}

/** Heartbeats are server-only, so they are read with the service role. Any failure counts as "no worker". */
export async function workerBeats(): Promise<WorkerBeat[]> {
  if (!process.env.SESSION_WORKER_SECRET) return [];
  try {
    const db = createAdminClient() as unknown as Db;
    const { data, error } = await db.from("worker_heartbeats").select("id, modes, seen_at").order("seen_at", { ascending: false }).limit(10);
    return error ? [] : ((data ?? []) as WorkerBeat[]);
  } catch { return []; }
}

export async function workerOnline(mode?: string): Promise<boolean> {
  return isOnline(await workerBeats(), mode);
}
