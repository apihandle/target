/**
 * Connectors listed on the Connectors page, in this order. All connect with OAuth (provider sign-in).
 * Facebook and Instagram are display cards fed by the user's single "meta" connection
 * (lib/connectors/meta.ts): the Facebook card shows the Page they picked, the Instagram card the
 * professional account linked to that Page.
 */
export const SHOWN_CONNECTORS = ["github", "google", "supabase", "vercel", "blogger", "facebook", "instagram"] as const;
