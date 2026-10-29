export type Action =
  | { type: "calendar"; title: string; start: string; end?: string; location?: string; details?: string }
  | { type: "map"; query: string; label?: string }
  | { type: "link"; url: string; label: string }
  | { type: "memory"; content: string }
  | { type: "panel"; kind: "weather" | "countdown" | "crypto" | "ai" | "note"; title?: string; config: Record<string, string> }
  | { type: "copy"; text: string; label?: string };

export const ACTIONS_PROMPT = `

ACTION BUTTONS: choose up to 3 one-tap buttons for concrete next steps the reply points to. Only use these types:
- {"type":"calendar","title":"…","start":"2026-11-02T18:00:00+05:30","end":"…","location":"…"}  (an event/reminder with a real date-time)
- {"type":"map","query":"place name, city"}  (a place the user may go to)
- {"type":"link","label":"…","url":"https://…"}  (only well-known official URLs you are sure exist)
- {"type":"memory","content":"short fact about the user"}  (when the user shares a lasting personal fact)
- {"type":"panel","kind":"weather|countdown|crypto|ai|note","title":"…","config":{…}}  (weather {"city"}, countdown {"date":"YYYY-MM-DD"}, crypto {"symbol":"BTC"}, ai {"prompt"}, note {"text"}) for things worth tracking on their Home
- {"type":"copy","label":"Copy message","text":"…"}  (a draft the user will paste somewhere)
Prefer a calendar button whenever a specific date/time is planned, a map button for a named place, a panel button when the user wants to keep checking something.`;

const TYPES = new Set(["calendar", "map", "link", "memory", "panel", "copy"]);
const PANEL_KINDS = new Set(["weather", "countdown", "crypto", "ai", "note"]);
const s = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function sanitizeAction(raw: unknown): Action | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (!TYPES.has(a.type as string)) return null;
  switch (a.type) {
    case "calendar": {
      const title = s(a.title, 120), start = s(a.start, 40);
      if (!title || isNaN(Date.parse(start))) return null;
      const end = s(a.end, 40);
      return { type: "calendar", title, start, end: end && !isNaN(Date.parse(end)) ? end : undefined, location: s(a.location, 200) || undefined, details: s(a.details, 500) || undefined };
    }
    case "map": { const query = s(a.query, 200); return query ? { type: "map", query, label: s(a.label, 60) || undefined } : null; }
    case "link": {
      const url = s(a.url, 500), label = s(a.label, 60);
      return /^https:\/\/[^\s]+$/i.test(url) && label ? { type: "link", url, label } : null;
    }
    case "memory": { const content = s(a.content, 300); return content.length >= 3 ? { type: "memory", content } : null; }
    case "panel": {
      if (!PANEL_KINDS.has(a.kind as string) || !a.config || typeof a.config !== "object") return null;
      const config: Record<string, string> = {};
      for (const [k, v] of Object.entries(a.config as Record<string, unknown>)) if (typeof v === "string") config[k] = v.slice(0, 500);
      return { type: "panel", kind: a.kind as Extract<Action, { type: "panel" }>["kind"], title: s(a.title, 80) || undefined, config };
    }
    case "copy": { const text = s(a.text, 4000); return text ? { type: "copy", text, label: s(a.label, 40) || undefined } : null; }
  }
  return null;
}

/** Split an assistant message into visible markdown + parsed action buttons. Hides a half-streamed block. */
export function splitActions(content: string): { text: string; actions: Action[] } {
  const re = /```actions?\s*\n?([\s\S]*?)```/gi;
  const actions: Action[] = [];
  let text = content.replace(re, (_m, body: string) => {
    try {
      const parsed = JSON.parse(body.trim());
      for (const r of Array.isArray(parsed) ? parsed : [parsed]) {
        const a = sanitizeAction(r);
        if (a && actions.length < 3) actions.push(a);
      }
    } catch { /* malformed block: drop silently */ }
    return "";
  });
  const open = text.search(/```actions?\b/i);
  if (open !== -1) text = text.slice(0, open);
  return { text: text.trimEnd(), actions };
}

function icsDate(iso: string) { return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }

export function calendarUrl(a: Extract<Action, { type: "calendar" }>): string {
  const start = icsDate(a.start);
  const end = icsDate(a.end ?? new Date(Date.parse(a.start) + 3600000).toISOString());
  const q = new URLSearchParams({ action: "TEMPLATE", text: a.title, dates: `${start}/${end}` });
  if (a.location) q.set("location", a.location);
  if (a.details) q.set("details", a.details);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

export function mapUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function actionLabel(a: Action): string {
  switch (a.type) {
    case "calendar": return `📅 Add “${a.title}” to calendar`;
    case "map": return `📍 ${a.label ?? a.query}`;
    case "link": return `🔗 ${a.label}`;
    case "memory": return "🧠 Remember this";
    case "panel": return `➕ Add ${a.title ?? a.kind} panel to Home`;
    case "copy": return `📋 ${a.label ?? "Copy"}`;
  }
}
