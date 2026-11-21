/**
 * Connectors listed on the Connectors page, in this order. All connect with OAuth (provider sign-in);
 * Figma additionally offers a personal-access-token connect, so its card renders even before its
 * OAuth app env vars are set (the others stay hidden until their OAuth client is configured).
 * Facebook and Instagram are display cards fed by the user's single "meta" connection
 * (lib/connectors/meta.ts): the Facebook card shows the Page they picked, the Instagram card the
 * professional account linked to that Page.
 */
export const SHOWN_CONNECTORS = ["github", "google", "supabase", "vercel", "blogger", "facebook", "instagram", "youtube", "canva", "figma", "notion", "slack"] as const;
