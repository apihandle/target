/**
 * Why a browser job stopped, in one short exact line, plus the next step that actually exists. Used by the chat
 * message after a job ends and by the live card, so a failure is never just "The browser task failed".
 */
export type FailureHint = { code: string; reason: string; next: string };

const TOOK_MIN = /within (\d+) minutes/;

export function failureHint(error: string | null | undefined): FailureHint {
  const e = (error ?? "").replace(/\s+/g, " ").trim();
  const detail = e.replace(/^[A-Z_]{6,}[:\s-]*/, "").slice(0, 200);
  if (/EARN_TASK_REFUSED/.test(e)) return {
    code: "EARN_TASK_REFUSED", reason: "Paid-to-click, ad-watching and survey earn tasks are not done by the bot (click fraud; it gets the account banned).",
    next: "Signing in and reading your balance works. Do the tasks yourself.",
  };
  if (/PAUSE_TIMEOUT|nobody completed it within|wasn't completed within|Nobody took over/i.test(e)) return {
    code: "PAUSE_TIMEOUT", reason: `The job waited for you and nobody finished the step${TOOK_MIN.test(e) ? ` within ${e.match(TOOK_MIN)![1]} minutes` : ""}.`,
    next: "Ask again and tap Take control when the check shows, then Continue.",
  };
  if (/GOOGLE_BLOCKED/i.test(e)) return {
    code: "GOOGLE_BLOCKED", reason: "Google refuses sign-in from automated browsers.",
    next: "Ask again and sign in with Google yourself via Take control, or save the site's own email + password in the vault.",
  };
  if (/CLOUDFLARE_BLOCKED/i.test(e) || /cloudflare|turnstile/i.test(e)) return {
    code: "CLOUDFLARE_BLOCKED", reason: "The Cloudflare check could not be solved automatically (the free solver failed and no paid solver is on).",
    next: "Ask again and tap Take control to pass the check yourself. The owner can turn on a paid solver (CAPSOLVER_API_KEY or STEEL_SOLVE_CAPTCHA).",
  };
  if (/no cloud browser (available|is configured|free)|insufficient credits|out of credit|402|quota/i.test(e)) return {
    code: "NO_BROWSER", reason: `No cloud browser had credit or answered right now${detail ? ` (${detail.slice(0, 120)})` : ""}.`,
    next: "Try again later. The owner can add credit or another provider key (see Admin > Browser providers).",
  };
  if (/gmail isn'?t connected/i.test(e)) return { code: "NEEDS_GMAIL", reason: "The site emailed a link or code and Gmail isn't connected.", next: "Connect Gmail in Settings > Connectors, then ask again." };
  if (/no one-time code arrived|email with the link didn'?t arrive/i.test(e)) return { code: "NO_CODE", reason: detail || "The site's code or link didn't arrive in time.", next: "Ask again; you can type the code in the chat when it asks." };
  if (/WRONG_LOGIN/i.test(e)) return { code: "WRONG_LOGIN", reason: "The site says the saved username or password is wrong.", next: "Update the login in the vault, then ask again." };
  if (/STOPPED_BY_USER|Stopped by you/i.test(e)) return { code: "STOPPED", reason: "You stopped the job.", next: "Ask again whenever you want." };
  if (/NOT_SIGNED_IN/i.test(e)) return { code: "NOT_SIGNED_IN", reason: `The sign-in wasn't confirmed on the page${detail ? `: ${detail.slice(0, 160)}` : ""}.`, next: "Ask again, or tap Take control to finish it yourself." };
  if (/NOT_SUBMITTED/.test(e)) return { code: "NOT_SUBMITTED", reason: `The form was NOT submitted: ${detail || "the page never confirmed it"}.`, next: "Ask again, or tap Take control to check the fields and press Submit yourself." };
  if (/took too long|ran out of steps/i.test(e)) return { code: "TIMEOUT", reason: detail || "The job ran out of time.", next: "Try a shorter, more specific request." };
  return { code: "FAILED", reason: detail || "The browser stopped without a reason.", next: "Ask again, or tap Take control next time to see the page." };
}

/** "Reason. Next: step." for chat text. */
export function failureLine(error: string | null | undefined): string {
  const h = failureHint(error);
  return `${h.reason} Next: ${h.next}`;
}
