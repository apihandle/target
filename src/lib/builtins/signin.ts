import { z } from "zod";
import { kickCloudWorker } from "@/lib/server/kickWorker";
import { SITE } from "@/lib/builtins/helpers";
import { normalizeSite } from "@/lib/sessions";
import { googleLogin, matchLogin, signinFailure, signinGoal, type VaultLoginRow } from "@/lib/signin";
import type { BuiltinCtx, BuiltinTool } from "@/lib/builtins/tools";

/** Log line the worker writes while it waits for the user's one-time code. */
export const WAITING_FOR_CODE = "waiting for code";

type JobRow = { id: string; status: string; result: string | null; error: string | null; log: string[] | null };

async function pollSignin(ctx: BuiltinCtx, id: string, ms: number, every = 3000): Promise<JobRow | null> {
  const until = Date.now() + ms;
  let last: JobRow | null = null;
  for (;;) {
    const { data } = await ctx.db.from("browser_jobs").select("id, status, result, error, log").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
    last = (data as JobRow | null) ?? last;
    if (!last || ["done", "failed", "cancelled"].includes(last.status) || (last.log ?? []).includes(WAITING_FOR_CODE) || Date.now() + every > until) return last;
    await new Promise((r) => setTimeout(r, every));
  }
}

export const siteLoginTool: BuiltinTool = {
  name: "site_login", label: "Signing in",
  description:
    "Sign in to a website on the user's behalf (their own account) and report what the signed-in page shows. Use whenever the user says log in / sign in / login karo / account kholo on a site. " +
    "Checks the vault for a saved login; if none, a secure save-login form is shown to the user automatically. Handles email OTP (via connected Gmail, else a code form) and saves the session for later. method \"google\" = use the site's Continue with Google button.",
  input: z.object({
    site: z.string().min(3).max(200).describe("Website domain or URL, e.g. timebucks.com"),
    method: z.enum(["password", "google"]).default("password"),
    check: z.string().max(200).optional().describe("Anything specific to read after signing in, e.g. 'the balance'"),
  }),
  async execute(raw, ctx) {
    const a = raw as { site: string; method: "password" | "google"; check?: string };
    const site = normalizeSite(a.site.replace(/^https?:\/\//i, ""));
    if (!site) throw new Error("Give a website like example.com");
    const { data } = await ctx.db.from("vault_secrets").select("id, kind, label, site").eq("user_id", ctx.userId).eq("kind", "login").limit(50);
    const items = (data ?? []) as VaultLoginRow[];
    const own = a.method === "google" ? null : matchLogin(items, site);
    const g = googleLogin(items);
    if (!own && !g) {
      const wantGoogle = a.method === "google";
      return {
        status: "needs_login", site,
        note: wantGoogle
          ? "No Google login is saved. A secure form is shown under your reply to save the Google account (or the site's own email + password). Say so in one short line; you sign in right after it is saved. Never ask for the password in chat."
          : `No login for ${site} is saved yet. A secure form is shown under your reply. Tell the user in one short line to save their ${site} login there; you sign in right after. Never ask for the password in chat, no warnings.`,
        __card: { type: "vault_login", site: wantGoogle ? "google.com" : site, for: site },
      };
    }
    // With only a Google login saved, the browser tries the site's Google button with it.
    const ids = [own?.id, g?.id].filter((x): x is string => !!x);
    const goal = signinGoal(site, { siteLogin: own?.id ?? null, googleLogin: g?.id ?? null, check: a.check });
    const { data: job, error } = await ctx.db.from("browser_jobs").insert({
      user_id: ctx.userId, goal: `Sign in to ${site}`.slice(0, 500), start_url: `https://${site}/`, steps: [], mode: "auto", max_steps: 30,
      allowed_secrets: ids, inputs: { signin: { site, via: own ? "password" : "google", goal } }, status: "queued", conversation_id: ctx.conversationId,
    }).select("id").single();
    if (error || !job) throw new Error("Couldn't start the sign-in");
    await kickCloudWorker();
    const j = await pollSignin(ctx, job.id as string, 150000);
    if (j && (j.log ?? []).includes(WAITING_FOR_CODE) && j.status === "running")
      return {
        job_id: job.id, status: "needs_code", site,
        note: `${site} sent a one-time code and it was not found in Gmail. A small code form is shown under your reply; ask for the code in one line. The sign-in continues once it is entered.`,
        __card: { type: "otp", job: job.id, site },
      };
    if (j?.status === "done") return { job_id: job.id, status: "signed_in", site, result: (j.result ?? "").slice(0, 4000), note: "Signed in; the session is saved. Report what the page shows in 1-3 lines." };
    if (j?.status === "failed") {
      const f = signinFailure(j.error, site);
      return {
        job_id: job.id, status: "failed", site, reason: f.line,
        note: f.offerPassword ? `Say this in one short line and offer email + password instead (a form is shown under your reply).` : "Say this in one short line. No lectures.",
        ...(f.offerPassword ? { __card: { type: "vault_login", site, for: site } } : {}),
      };
    }
    return { job_id: job.id, status: j?.status ?? "queued", site, manage_url: `${SITE}/app/settings/browser`, note: "Still signing in; the result is posted in this chat when it finishes." };
  },
};

/** Pull the card a site_login result asked for out of the tool output (the chat shows it under the reply). */
export function cardFromToolOutput(content: string): Record<string, string> | null {
  const m = content.match(/"__card":(\{[^{}]*\})/);
  if (!m) return null;
  try { const c = JSON.parse(m[1]); return c && typeof c === "object" ? c : null; } catch { return null; }
}
