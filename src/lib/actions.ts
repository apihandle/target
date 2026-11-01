export type Action =
  | { type: "calendar"; title: string; start: string; end?: string; location?: string; details?: string }
  | { type: "map"; query: string; label?: string }
  | { type: "link"; url: string; label: string }
  | { type: "memory"; content: string }
  | { type: "panel"; kind: "weather" | "countdown" | "crypto" | "ai" | "note"; title?: string; config: Record<string, string> }
  | { type: "copy"; text: string; label?: string }
  /** A pending approval request created by the server. Details are always re-read from the server. */
  | { type: "approval"; id: string }
  /** An action the user asked for that this build can't perform; shown as a limitation, never as an approval. */
  | { type: "unavailable"; label: string; reason: string }
  /** Created by the server when a task paused because a connector isn't connected. */
  | { type: "connect"; connector: string; taskId?: string };

export const ACTIONS_PROMPT = `

ACTION BUTTONS: choose up to 3 one-tap buttons for concrete next steps the reply points to. Only use these types:
- {"type":"calendar","title":"…","start":"2026-11-02T18:00:00+05:30","end":"…","location":"…"}  (an event/reminder with a real date-time)
- {"type":"map","query":"place name, city"}  (a place the user may go to)
- {"type":"link","label":"…","url":"https://…"}  (only well-known official URLs you are sure exist)
- {"type":"memory","content":"short fact about the user"}  (when the user shares a lasting personal fact)
- {"type":"panel","kind":"weather|countdown|crypto|ai|note","title":"…","config":{…}}  (weather {"city"}, countdown {"date":"YYYY-MM-DD"}, crypto {"symbol":"BTC"}, ai {"prompt"}, note {"text"}) for things worth tracking on their Home
- {"type":"copy","label":"Copy message","text":"…"}  (a draft the user will paste somewhere)
- {"type":"propose","action":"create_task","title":"…","notes":"…"}  (the user asks TARGET to add/track a to-do)
- {"type":"propose","action":"create_schedule","title":"…","prompt":"what TARGET should do each time","cadence":"once|interval|daily|weekly","run_on":"YYYY-MM-DD (once only, the user's local date)","interval_hours":"1-168 (interval only)","weekday":"0-6 (0=Sunday, weekly only)","time_of_day":"HH:MM (for interval, the first run)","timezone":"Asia/Kolkata"}  (the user wants TARGET to do or remind something later or repeatedly: "kal shaam 6 baje yaad dilana" = once, "har 2 ghante paani peene ko bolo" = interval 2, "har din subah 8 baje news bhejo" = daily, "every Monday plan my week" = weekly. Work out run_on from the current date-time line.)
- {"type":"propose","action":"create_project","name":"…","description":"…"}  (the user wants to start a longer effort as a project)
- {"type":"propose","action":"calendar_event","title":"…","start":"…","end":"…","location":"…"}  (the user asks TARGET itself to put an event on their Google Calendar)
- {"type":"propose","action":"send_email","to":"…","subject":"…"}  (the user asks TARGET to send an email/message for them; also add a copy button with the draft)
- {"type":"propose","action":"purchase"} or {"type":"propose","action":"booking"}  (the user asks TARGET to buy, book or cancel something for them)
"propose" buttons are only proposals: the app asks the user to approve, or explains that the action isn't available.
Rules: base buttons ONLY on what the user asks in their latest message, never on older context.
- The user lists several to-dos to track -> one create_task proposal per to-do (up to 3).
- A repeating request (daily/weekly/har din/har hafte/roz) -> create_schedule, not a calendar button.
- A specific date/time being planned -> calendar button. A named place to visit -> map button.
- The user wants to check/track something regularly (a price, weather, a date) -> ALWAYS a panel button (crypto {"symbol"}, weather {"city"}, countdown {"date"}).
- Greetings, thanks, small talk, general questions -> [].`;

const TYPES = new Set(["calendar", "map", "link", "memory", "panel", "copy", "approval", "unavailable", "connect"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
    case "approval": { const id = s(a.id, 40); return UUID.test(id) ? { type: "approval", id } : null; }
    case "connect": {
      const connector = s(a.connector, 30), taskId = s(a.taskId, 40);
      return /^[a-z][a-z0-9_]{1,29}$/.test(connector) ? { type: "connect", connector, ...(UUID.test(taskId) ? { taskId } : {}) } : null;
    }
    case "unavailable": {
      const label = s(a.label, 80), reason = s(a.reason, 300);
      return label && reason ? { type: "unavailable", label, reason } : null;
    }
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
        if (a && actions.length < 4) actions.push(a);
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
    case "calendar": return `Add “${a.title}” to calendar`;
    case "map": return `${a.label ?? a.query}`;
    case "link": return `${a.label}`;
    case "memory": return "Remember this";
    case "panel": return `Add ${a.title ?? a.kind} panel to Home`;
    case "copy": return `${a.label ?? "Copy"}`;
    case "approval": return "Review action";
    case "unavailable": return a.label;
    case "connect": return `Connect ${a.connector}`;
  }
}

const COINS: Record<string, string> = { bitcoin: "BTC", btc: "BTC", ethereum: "ETH", eth: "ETH", solana: "SOL", sol: "SOL", dogecoin: "DOGE", doge: "DOGE", xrp: "XRP", cardano: "ADA" };

/** Deterministic buttons the model tends to miss: tracking a coin regularly -> crypto panel. */
export function heuristicActions(userText: string): Action[] {
  const t = userText.toLowerCase();
  if (!/(roz|daily|har din|track|monitor|nazar|regular|every day|check kar)/.test(t)) return [];
  for (const [word, symbol] of Object.entries(COINS)) {
    if (new RegExp(`\\b${word}\\b`).test(t)) return [{ type: "panel", kind: "crypto", title: `${symbol} price`, config: { symbol, currency: "INR" } }];
  }
  return [];
}

export function mergeActions(a: Action[], b: Action[]): Action[] {
  const out = [...a];
  for (const x of b) if (!out.some((y) => y.type === x.type && JSON.stringify(y) === JSON.stringify(x)) && !(x.type === "panel" && out.some((y) => y.type === "panel"))) out.push(x);
  return out.slice(0, 3);
}
