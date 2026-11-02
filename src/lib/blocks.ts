// Rich answer cards: the model may append a ```blocks JSON array to a reply. The client parses and sanitizes it
// (never trusting the model's JSON), and falls back to plain markdown when anything is malformed.
export type Block =
  | { type: "links"; items: { title: string; url: string; description?: string }[] }
  | { type: "table"; title?: string; columns: string[]; rows: string[][] }
  | { type: "images"; items: { url: string; caption?: string }[] }
  | { type: "summary"; title: string; markdown: string }
  | { type: "draft"; title: string; body: string }
  | { type: "code"; title?: string; language: string; source: string }
  | { type: "calendar"; title: string; start: string; end?: string; location?: string }
  | { type: "order"; merchant: string; items: { name: string; price: string }[]; total: string; comment?: string };

export const BLOCKS_PROMPT = `

RICH CARDS (optional): when the reply is clearer as a card, end it with ONE fenced block of JSON, after your normal text:
\`\`\`blocks
[{"type":"links","items":[{"title":"…","url":"https://…","description":"short"}]}]
\`\`\`
Block types: links (pages to open, up to 6, real URLs from search results only), table {title,columns[],rows[][]} (3+ columns, for comparing options), images {items:[{url,caption}]} (https image URLs you were given only), summary {title,markdown} (long briefing/plan/itinerary), draft {title,body} (an email/message the user will send, plain text), code {title,language,source}, calendar {title,start,end,location} (ISO date-time with offset), order {merchant,items:[{name,price}],total,comment} (a cart/booking summary to show; TARGET never pays by itself).
EMAILS, EVENTS, FILES: when you list or summarize emails, calendar events or Drive files, ALWAYS use a table card (emails: columns From, Subject, Gist, Date; events: Event, When, Where; files: Name, Type, Updated), one row per item, newest first, and above it 1-2 short lines with only what needs the user's attention. No emoji headings, no bullet lists of emails. Write domains as plain text (no raw URLs in the text).
Keep the text above short when a card carries the detail; never repeat the card's content in the text. Skip the block for greetings and simple answers. Never invent URLs.`;

const s = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const https = (v: unknown) => { const u = s(v, 600); return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : ""; };
const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

export function sanitizeBlock(raw: unknown): Block | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case "links": {
      const items = arr(b.items, 6).flatMap((x) => {
        const o = (x ?? {}) as Record<string, unknown>;
        const url = https(o.url) || (/^http:\/\/[^\s]+$/i.test(s(o.url, 600)) ? s(o.url, 600) : "");
        return url ? [{ title: s(o.title, 140) || url, url, description: s(o.description, 200) || undefined }] : [];
      });
      return items.length ? { type: "links", items } : null;
    }
    case "table": {
      const columns = arr(b.columns, 8).map((c) => s(c, 60)).filter(Boolean);
      if (columns.length < 2) return null;
      const rows = arr(b.rows, 25).filter(Array.isArray).map((r) => columns.map((_, i) => s((r as unknown[])[i] ?? "", 200)));
      return rows.length ? { type: "table", title: s(b.title, 80) || undefined, columns, rows } : null;
    }
    case "images": {
      const items = arr(b.items, 6).flatMap((x) => {
        const o = (x ?? {}) as Record<string, unknown>;
        const url = https(o.url);
        return url ? [{ url, caption: s(o.caption, 100) || undefined }] : [];
      });
      return items.length ? { type: "images", items } : null;
    }
    case "summary": { const title = s(b.title, 100), markdown = s(b.markdown, 8000); return title && markdown ? { type: "summary", title, markdown } : null; }
    case "draft": { const body = s(b.body, 6000); return body ? { type: "draft", title: s(b.title, 100) || "Draft", body } : null; }
    case "code": { const source = typeof b.source === "string" ? b.source.slice(0, 12000) : ""; return source.trim() ? { type: "code", title: s(b.title, 80) || undefined, language: s(b.language, 20).replace(/[^\w+-]/g, "") || "text", source } : null; }
    case "calendar": {
      const title = s(b.title, 120), start = s(b.start, 40), end = s(b.end, 40);
      if (!title || isNaN(Date.parse(start))) return null;
      return { type: "calendar", title, start, end: end && !isNaN(Date.parse(end)) ? end : undefined, location: s(b.location, 200) || undefined };
    }
    case "order": {
      const items = arr(b.items, 15).flatMap((x) => { const o = (x ?? {}) as Record<string, unknown>; const name = s(o.name, 120); return name ? [{ name, price: s(o.price, 30) }] : []; });
      const merchant = s(b.merchant, 100), total = s(b.total, 30);
      return merchant && items.length && total ? { type: "order", merchant, items, total, comment: s(b.comment, 200) || undefined } : null;
    }
  }
  return null;
}

/** Split a reply into visible markdown + sanitized cards. Hides a half-streamed block. */
export function splitBlocks(content: string): { text: string; blocks: Block[] } {
  const blocks: Block[] = [];
  let text = content.replace(/```blocks?\s*\n?([\s\S]*?)```/gi, (_m, body: string) => {
    try {
      const parsed = JSON.parse(body.trim());
      for (const r of Array.isArray(parsed) ? parsed : [parsed]) {
        const b = sanitizeBlock(r);
        if (b && blocks.length < 8) blocks.push(b);
      }
    } catch { /* malformed block: drop silently, keep the markdown */ }
    return "";
  });
  const open = text.search(/```blocks?\b/i);
  if (open !== -1) text = text.slice(0, open);
  return { text: text.trimEnd(), blocks };
}

export function hostOfUrl(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}
export function faviconUrl(url: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOfUrl(url))}&sz=64`;
}
