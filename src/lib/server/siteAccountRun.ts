import type { Db } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_VAULT_ITEMS, sealVault } from "@/lib/builtins/vault";
import { kickCloudWorker } from "@/lib/server/kickWorker";
import { accountGoal, accountOf, generatePassword, type AccountInputs } from "@/lib/siteAccount";

const pendingLabel = (a: AccountInputs) => `${a.site} (${a.flow === "reset" ? "new password" : "new account"}, in progress)`.slice(0, 80);

/**
 * Called only by the approval executor (site_account). Generates the password, seals it into the vault
 * (the value never leaves this function), and queues the browser job that was prepared at proposal time.
 */
export async function runSiteAccount(userId: string, jobId: string, dbIn?: Db): Promise<Record<string, unknown>> {
  const db = dbIn ?? (createAdminClient() as unknown as Db);
  const { data: job } = await db.from("browser_jobs").select("id, status, inputs").eq("id", jobId).eq("user_id", userId).maybeSingle();
  const a = accountOf(job?.inputs);
  if (!job || !a) throw new Error("This request no longer exists.");
  if (job.status !== "needs_approval" && job.status !== "failed") throw new Error("This was already started.");
  const { count } = await db.from("vault_secrets").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if ((count ?? 0) >= MAX_VAULT_ITEMS) throw new Error(`Your vault is full (${MAX_VAULT_ITEMS} items). Delete one first.`);

  const sealed = sealVault(userId, { kind: "login", label: pendingLabel(a), site: a.site, username: a.username ?? a.email, password: generatePassword() });
  const { data: item, error } = await db.from("vault_secrets").insert({ user_id: userId, kind: "login", label: pendingLabel(a), ...sealed }).select("id").single();
  if (error || !item) throw new Error("Couldn't save the new password to your vault.");
  const vault_id = item.id as string;
  // The full goal (over the 500-char column limit) rides in inputs, like a sign-in job's.
  const account = { ...a, vault_id, goal: accountGoal({ ...a, vault_id }) };
  const { data: queued } = await db.from("browser_jobs").update({
    status: "queued", allowed_secrets: [vault_id], inputs: { ...(job.inputs as Record<string, unknown>), account }, error: null, log: [],
  }).eq("id", jobId).eq("user_id", userId).in("status", ["needs_approval", "failed"]).select("id");
  if (!queued?.length) {
    await db.from("vault_secrets").delete().eq("id", vault_id).eq("user_id", userId);
    throw new Error("This was already started.");
  }
  await kickCloudWorker();
  return { browser_job_id: jobId, note: a.flow === "reset" ? "The browser is resetting the password now. The new password is in your vault." : "The browser is creating the account now. The login is in your vault." };
}

/**
 * When an account job ends: on success the new login becomes the site's login (a reset replaces the old one);
 * on failure an item whose password was never typed is removed, otherwise it is kept and marked unconfirmed
 * so a password the site may already have accepted is never lost.
 */
export async function settleSiteAccount(db: Db, userId: string, a: AccountInputs, ok: boolean, log: string[]): Promise<void> {
  if (!a.vault_id) return;
  if (ok) {
    await db.from("vault_secrets").update({ label: a.site.slice(0, 80) }).eq("id", a.vault_id).eq("user_id", userId);
    if (a.flow === "reset" && a.replaces && a.replaces !== a.vault_id) await db.from("vault_secrets").delete().eq("id", a.replaces).eq("user_id", userId);
    return;
  }
  const typed = log.some((l) => l.startsWith("fill_secret") && l.includes(" password"));
  if (!typed) { await db.from("vault_secrets").delete().eq("id", a.vault_id).eq("user_id", userId); return; }
  await db.from("vault_secrets").update({ label: `${a.site} (unconfirmed password)`.slice(0, 80) }).eq("id", a.vault_id).eq("user_id", userId);
}
