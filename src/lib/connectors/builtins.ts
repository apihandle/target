import type { Env } from "@/lib/connectors/types";

/** Server-wide services (not per-user connectors). Shown read-only in Settings → Connected apps. */
export type Builtin = { id: string; name: string; description: string; dataAccess: string; anyEnv: string[] };

export const BUILTINS: Builtin[] = [
  {
    id: "ai_model", name: "AI model",
    description: "Generates TARGET's chat replies, task drafts and AI panels, and decides when to use your connectors' tools.",
    dataAccess: "Your chat messages, project instructions, open task titles, saved memories (if memory is on) and connector tool results are sent to the configured AI provider (NVIDIA NIM and/or OpenRouter).",
    anyEnv: ["NVIDIA_API_KEY", "OPENROUTER_API_KEY"],
  },
  {
    id: "web_search", name: "Web search (Tavily)",
    description: "Looks up current information when a question needs it or you turn on Web.",
    dataAccess: "A search query built from your message is sent to Tavily.",
    anyEnv: ["TAVILY_API_KEY"],
  },
];

export const builtinReady = (b: Builtin, env: Env) => b.anyEnv.some((k) => !!env[k]);
