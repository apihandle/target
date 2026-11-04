import { z } from "zod";
import { normalizeSite } from "@/lib/sessions";
import { matchLogin, type VaultLoginRow } from "@/lib/signin";
import { accountSummary, userAsked, usernameIn, withProfileName, type AccountFlow } from "@/lib/siteAccount";
import { createAdminClient } from "@/lib/supabase/admin";
import { isLang, type Lang } from "@/lib/lang";
import type { BuiltinCtx, BuiltinTool } from "@/lib/builtins/tools";

/**
 * Account creation and password reset on websites. Both:
 *  - run only when the user's own latest message asks for it on that site (checked here, server-side),
 *  - then wait for the user to tap Approve on a card (approval_requests, action "site_account");
 *  - only on approval does the server generate the password, seal it in the vault and queue the browser.
 */
const email = z.string().trim().email().max(200);

async function defaultEmail(ctx: BuiltinCtx): Promise<string | null> {
  const { data } = await ctx.db.from("connections").select("account_label, status").eq("user_id", ctx.userId).eq("connector_id", "google").limit(1);
  const label = (data as { account_label?: string; status?: string }[] | null)?.[0]?.account_label ?? "";
  return email.safeParse(label).success ? label.toLowerCase() : null;
}

/** The user's own profile (TARGET account): email and name, used to fill a sign-up form. */
async function profile(ctx: BuiltinCtx): Promise<{ email: string | null; name: string | null }> {
  try {
    const admin = createAdminClient() as unknown as { auth: { admin: { getUserById(id: string): Promise<{ data: { user: { email?: string; user_metadata?: Record<string, unknown> } | null } }> } } };
    const { data } = await admin.auth.admin.getUserById(ctx.userId);
    const u = data.user;
    const m = u?.user_metadata ?? {};
    const name = [m.full_name, m.name].find((v): v is string => typeof v === "string" && v.trim().length > 1) ?? null;
    return { email: u?.email && email.safeParse(u.email).success ? u.email.toLowerCase() : null, name };
  } catch { return { email: null, name: null }; }
}

async function prepare(ctx: BuiltinCtx, flow: AccountFlow, rawSite: string, opts: { email?: string; details?: string; lang?: Lang | null }) {
  const site = normalizeSite(rawSite.replace(/^https?:\/\//i, ""));
  if (!site) throw new Error("Give a website like example.com");
  if (!userAsked(flow, site, ctx.userTexts))
    return { status: "not_requested", site, note: flow === "reset"
      ? `Only reset a password when the user's own message asks to reset/change the password on ${site}. Ask them first; do not retry.`
      : `Only create an account when the user's own message asks to create/sign up for an account on ${site}. Ask them first; do not retry.` };

  let replaces: string | null = null;
  let mail = opts.email?.toLowerCase() ?? null;
  if (flow === "reset") {
    const { data } = await ctx.db.from("vault_secrets").select("id, kind, label, site").eq("user_id", ctx.userId).eq("kind", "login").limit(50);
    const own = matchLogin((data ?? []) as VaultLoginRow[], site);
    replaces = own?.id ?? null;
  }
  const me = flow === "register" ? await profile(ctx) : { email: null, name: null };
  mail = mail ?? (await defaultEmail(ctx)) ?? me.email;
  // A username the user chose (in the tool's details or their own message) is typed into the form and becomes the
  // vault login's username, since sites with usernames sign in with it.
  const username = flow === "register" ? usernameIn(opts.details) ?? (ctx.userTexts ?? []).slice(-3).reverse().map(usernameIn).find(Boolean) ?? null : null;
  const details = flow === "register" ? withProfileName(opts.details, me.name) : opts.details;
  if (!mail) return { status: "needs_email", site, note: `Ask the user in one line which email address ${flow === "reset" ? "the account uses" : "to use for the new account"}, then call this again with it.` };

  const { data: job, error } = await ctx.db.from("browser_jobs").insert({
    user_id: ctx.userId, mode: "auto", goal: (flow === "reset" ? `Reset password on ${site}` : `Create an account on ${site}`).slice(0, 500),
    start_url: `https://${site}/`, steps: [], allowed_secrets: [], max_steps: 40, status: "needs_approval", conversation_id: ctx.conversationId,
    inputs: { account: { flow, site, email: mail, ...(username ? { username } : {}), replaces, ...(details ? { details: details.slice(0, 300) } : {}), ...(opts.lang ? { lang: opts.lang } : {}) } },
  }).select("id").single();
  if (error || !job) throw new Error("Couldn't prepare this");
  const summary = accountSummary({ flow, site, email: mail, name: flow === "register" && details && /\bname\b/i.test(details) ? (details.match(/\bname\s+([^;,]{2,80})/i)?.[1] ?? null) : null });
  const { data: ap, error: e2 } = await ctx.db.from("approval_requests").insert({
    user_id: ctx.userId, action_type: "site_account", summary, destination: site, status: "pending", conversation_id: ctx.conversationId,
    payload: { browser_job_id: job.id, flow, site, email: mail },
  }).select("id").single();
  if (e2 || !ap) throw new Error("Couldn't prepare the approval card");
  return { __approval: { id: ap.id as string, summary } };
}

export const sitePasswordResetTool: BuiltinTool = {
  name: "site_password_reset", label: "Preparing the password reset",
  description:
    "Reset (change) the user's password on a website through its Forgot password flow. ONLY when the user explicitly asks to reset/change their password on that site. " +
    "Shows an approval card; after the user approves, a strong new password is generated and saved in their vault (never shown), the browser sets it, and email codes/links are read from connected Gmail.",
  input: z.object({
    site: z.string().min(3).max(200).describe("Website domain, e.g. example.com"),
    email: email.optional().describe("The account's email, if the user said it (else the saved login or their Google email is used)"),
    lang: z.enum(["hinglish", "hindi", "english"]).optional(),
  }),
  async execute(raw, ctx) {
    const a = raw as { site: string; email?: string; lang?: Lang };
    return prepare(ctx, "reset", a.site, { email: a.email, lang: isLang(a.lang) ? a.lang : null });
  },
};

export const siteRegisterTool: BuiltinTool = {
  name: "site_register", label: "Preparing the new account",
  description:
    "Create a new account for the user on a website. ONLY when the user explicitly asks to create / sign up for an account on that site. " +
    "Shows an approval card; after approval a strong password is generated and saved in their vault (never shown), the browser fills the sign-up form, and the email verification code/link is read from connected Gmail. " +
    "Pass form details the user gave (name etc.) in details; never invent personal details.",
  input: z.object({
    site: z.string().min(3).max(200),
    email: email.optional().describe("Email for the new account, if the user said it (else their Google email)"),
    details: z.string().max(300).optional().describe("Other sign-up details the user gave, e.g. 'name Vikash Kushwaha'"),
    lang: z.enum(["hinglish", "hindi", "english"]).optional(),
  }),
  async execute(raw, ctx) {
    const a = raw as { site: string; email?: string; details?: string; lang?: Lang };
    return prepare(ctx, "register", a.site, { email: a.email, details: a.details, lang: isLang(a.lang) ? a.lang : null });
  },
};
