import { createHash, randomBytes } from "crypto";

/**
 * Read-only share links. The link carries a random 256-bit token; the database stores only its
 * SHA-256, so a leaked database row can't be turned back into a working link. SERVER ONLY.
 */
export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Tokens are exactly 43 base64url characters (32 bytes). Anything else is rejected before any lookup. */
export function isShareToken(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
}

export const sharePath = (token: string) => `/share/${token}`;

export type SharedMessage = { role: "user" | "assistant"; content: string; created_at?: string; attachments?: { name: string; kind: string }[] };
export type SharedConversation = { title: string; messages: SharedMessage[] };

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }> };

/**
 * Look up a shared chat through the get_shared_conversation() function (migration 0008), which only
 * returns non-revoked shares and only that conversation's user/assistant messages.
 */
export async function loadSharedConversation(token: unknown, client: RpcClient): Promise<SharedConversation | null> {
  if (!isShareToken(token)) return null;
  try {
    const { data, error } = await client.rpc("get_shared_conversation", { p_token_hash: hashShareToken(token) });
    if (error || !data || typeof data !== "object") return null;
    const d = data as { title?: unknown; messages?: unknown };
    const messages = (Array.isArray(d.messages) ? d.messages : [])
      .filter((m): m is SharedMessage => !!m && typeof m === "object" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({ role: m.role, content: m.content, created_at: m.created_at, attachments: Array.isArray(m.attachments) ? m.attachments.filter((x) => x && typeof x.name === "string").map((x) => ({ name: String(x.name).slice(0, 200), kind: String(x.kind ?? "") })) : [] }));
    return { title: typeof d.title === "string" ? d.title : "Shared chat", messages };
  } catch {
    return null;
  }
}

/** Remove app-only blocks (action buttons, approval cards) from a shared assistant message. */
export function publicContent(content: string): string {
  return content.replace(/\n*```actions?\s*\n[\s\S]*?\n```/gi, "").trim();
}
