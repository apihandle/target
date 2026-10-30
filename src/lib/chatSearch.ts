/** Chat history search helpers (server uses ILIKE backed by the pg_trgm indexes from migration 0008). */

export const MIN_QUERY = 2;
export const MAX_QUERY = 100;

/** Normalised search text, or null when too short / not a string. */
export function cleanQuery(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const q = v.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);
  return q.length >= MIN_QUERY ? q : null;
}

/** ILIKE pattern that matches the text literally (%, _ and \ are escaped). */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** ~120 characters around the first match, with markdown fences and action blocks removed. */
export function snippet(content: string, q: string, width = 120): string {
  const text = content.replace(/```(actions?|sources)[\s\S]*?```/gi, " ").replace(/\s+/g, " ").trim();
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, width) + (text.length > width ? "…" : "");
  const start = Math.max(0, i - Math.floor((width - q.length) / 2));
  const end = Math.min(text.length, start + width);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

export type SearchHit = { id: string; title: string; pinned: boolean; snippet: string | null };

/** Title matches first (pinned before others), then chats that only match in their messages. */
export function mergeHits(titleRows: { id: string; title: string; pinned?: boolean | null }[], messageRows: { conversation_id: string; content: string }[], titles: Map<string, { title: string; pinned?: boolean | null }>, q: string, limit = 20): SearchHit[] {
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  const byConv = new Map<string, string>();
  for (const m of messageRows) if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, m.content);
  const sorted = [...titleRows].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  for (const t of sorted) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    const m = byConv.get(t.id);
    out.push({ id: t.id, title: t.title, pinned: !!t.pinned, snippet: m ? snippet(m, q) : null });
  }
  for (const [cid, content] of Array.from(byConv)) {
    if (seen.has(cid) || !titles.has(cid)) continue;
    seen.add(cid);
    const t = titles.get(cid)!;
    out.push({ id: cid, title: t.title, pinned: !!t.pinned, snippet: snippet(content, q) });
  }
  return out.slice(0, limit);
}
