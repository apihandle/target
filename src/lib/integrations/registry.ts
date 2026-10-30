/**
 * Connected-app adapters. The UI only talks to this registry, never to a specific provider,
 * so new integrations are added by registering another adapter here (plus its server module).
 */
export type Env = Record<string, string | undefined>;

export type IntegrationKind = "builtin" | "oauth" | "planned";

export type Integration = {
  id: string;
  name: string;
  kind: IntegrationKind;
  description: string;
  /** What data the connection can read or send. */
  dataAccess: string[];
  /** What TARGET can do with it. */
  capabilities: string[];
  /** OAuth scopes requested (oauth kind only). Keep to the minimum the feature needs. */
  scopes: string[];
  /** Server env vars that must be present for this to work. Names only. */
  requiredEnv: string[];
  /** For built-ins: any one of these being set is enough. */
  anyEnv?: string[];
};

export const INTEGRATIONS: Integration[] = [
  {
    id: "ai_model", name: "AI model", kind: "builtin",
    description: "Generates TARGET's chat replies, task drafts and AI panels.",
    dataAccess: ["Your chat messages, project instructions, open task titles and saved memories (if memory is on) are sent to the configured AI provider (NVIDIA NIM and/or OpenRouter) to generate replies."],
    capabilities: ["Write replies and suggestions. It can only propose actions; it can't execute them."],
    scopes: [], requiredEnv: [], anyEnv: ["NVIDIA_API_KEY", "OPENROUTER_API_KEY"],
  },
  {
    id: "web_search", name: "Web search (Tavily)", kind: "builtin",
    description: "Looks up current information when a question needs it or you turn on Web.",
    dataAccess: ["A search query built from your message is sent to Tavily."],
    capabilities: ["Read public web results and cite them."],
    scopes: [], requiredEnv: ["TAVILY_API_KEY"],
  },
  {
    id: "google_calendar", name: "Google Calendar", kind: "oauth",
    description: "Lets TARGET add events to your primary Google Calendar after you approve each one.",
    dataAccess: ["Google's calendar.events permission covers viewing and editing events on your calendars. TARGET only uses it to create events you approve; it does not read your existing events."],
    capabilities: ["Create a calendar event — only after you press Approve."],
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
    requiredEnv: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
  },
  {
    id: "gmail", name: "Gmail", kind: "planned",
    description: "Sending email on your behalf isn't available in this version of TARGET.",
    dataAccess: [], capabilities: ["Not available yet. TARGET can draft emails for you to copy and send yourself."],
    scopes: [], requiredEnv: [],
  },
];

export function getIntegration(id: string): Integration | undefined {
  return INTEGRATIONS.find((i) => i.id === id);
}

export function isConfigured(i: Integration, env: Env): boolean {
  if (i.kind === "planned") return false;
  if (i.anyEnv?.length && !i.anyEnv.some((k) => !!env[k])) return false;
  return i.requiredEnv.every((k) => !!env[k]);
}

export type IntegrationStatus = "ready" | "connected" | "not_connected" | "setup_required" | "unavailable";

export type IntegrationView = Omit<Integration, "requiredEnv" | "anyEnv"> & {
  status: IntegrationStatus; accountLabel?: string; connectedAt?: string; missingEnv: string[];
};

/** Compute what the Connected apps page shows. Never reports "connected" without a stored connection row. */
export function integrationViews(env: Env, connections: { provider: string; account_label?: string; connected_at?: string }[]): IntegrationView[] {
  return INTEGRATIONS.map(({ requiredEnv, anyEnv, ...i }) => {
    const full = { ...i, requiredEnv, anyEnv };
    const configured = isConfigured(full, env);
    const missingEnv = i.kind === "planned" ? [] : [...requiredEnv.filter((k) => !env[k]), ...(anyEnv && !anyEnv.some((k) => env[k]) ? [anyEnv.join(" or ")] : [])];
    const conn = connections.find((c) => c.provider === i.id);
    let status: IntegrationStatus;
    if (i.kind === "planned") status = "unavailable";
    else if (!configured) status = "setup_required";
    else if (i.kind === "builtin") status = "ready";
    else status = conn ? "connected" : "not_connected";
    return { ...i, status, missingEnv, accountLabel: conn?.account_label || undefined, connectedAt: conn?.connected_at };
  });
}
