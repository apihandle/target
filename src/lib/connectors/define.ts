import type { z } from "zod";
import type { ConnectorDef, ToolDef } from "@/lib/connectors/types";

/** Keeps each tool's argument types inferred from its zod schema. */
export function tool<S extends z.ZodTypeAny>(def: ToolDef<S>): ToolDef {
  return def as unknown as ToolDef;
}

export function defineConnector(def: ConnectorDef): ConnectorDef {
  return def;
}

export const clip = (s: string, n = 8000) => (s.length > n ? s.slice(0, n) + `\n…[truncated ${s.length - n} chars]` : s);
