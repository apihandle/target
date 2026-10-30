export const PANEL_KINDS = ["weather", "countdown", "crypto", "ai", "note", "list", "tracker", "goal"] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];

/** Structured item shapes for the user-maintained panel kinds. */
export type ListItem = { id: string; text: string; done: boolean };
export type TrackerItem = { id: string; text: string; status: "todo" | "doing" | "done" };
export type GoalEntry = { id: string; amount: number; note: string; date: string };
export type PanelItem = ListItem | TrackerItem | GoalEntry;

export type Panel = {
  id: string; kind: PanelKind; title: string;
  config: Record<string, string>; data: Record<string, unknown> | null;
  error?: string | null; refreshed_at?: string | null;
  description?: string; items?: PanelItem[];
};

export const PANEL_COLS = "id, kind, title, description, items, config, data, error, refreshed_at, position";
/** Kinds whose content the user maintains by hand (no external source). */
export const MANUAL_KINDS: PanelKind[] = ["note", "list", "tracker", "goal", "countdown"];
export const MAX_ITEMS = 100;

/** How long a panel's data stays fresh before a view triggers a refresh (ms). */
export const STALE_MS: Record<PanelKind, number> = {
  weather: 60 * 60 * 1000, crypto: 60 * 60 * 1000, ai: 24 * 60 * 60 * 1000, countdown: Infinity, note: Infinity,
  list: Infinity, tracker: Infinity, goal: Infinity,
};

export function isStale(p: Pick<Panel, "kind" | "refreshed_at" | "data">, now = Date.now()): boolean {
  if (STALE_MS[p.kind] === Infinity) return false;
  if (!p.refreshed_at || !p.data) return true;
  return now - new Date(p.refreshed_at).getTime() > STALE_MS[p.kind];
}

type V = { ok: true; value: { kind: PanelKind; title: string; config: Record<string, string>; description?: string; items?: PanelItem[] } } | { ok: false; error: string };

export function validatePanel(input: { kind?: unknown; title?: unknown; config?: unknown; description?: unknown; items?: unknown }): V {
  const kind = input.kind as PanelKind;
  if (!PANEL_KINDS.includes(kind)) return { ok: false, error: "Unknown panel type" };
  const c = (input.config && typeof input.config === "object" ? input.config : {}) as Record<string, unknown>;
  const str = (k: string, max: number) => (typeof c[k] === "string" ? (c[k] as string).trim().slice(0, max) : "");
  const config: Record<string, string> = {};
  let title = typeof input.title === "string" ? input.title.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  switch (kind) {
    case "weather": {
      config.city = str("city", 80);
      if (!config.city) return { ok: false, error: "City is required" };
      title ||= `Weather · ${config.city}`; break;
    }
    case "countdown": {
      config.date = str("date", 30);
      if (!config.date || isNaN(new Date(config.date).getTime())) return { ok: false, error: "A valid date is required" };
      title ||= "Countdown"; break;
    }
    case "crypto": {
      config.symbol = str("symbol", 10).toUpperCase().replace(/[^A-Z0-9]/g, "");
      config.currency = (str("currency", 5) || "INR").toUpperCase().replace(/[^A-Z]/g, "");
      if (!config.symbol) return { ok: false, error: "Coin symbol is required" };
      title ||= `${config.symbol} price`; break;
    }
    case "ai": {
      config.prompt = str("prompt", 500);
      if (config.prompt.length < 5) return { ok: false, error: "Tell TARGET what this panel should show" };
      title ||= config.prompt.slice(0, 40); break;
    }
    case "note": {
      config.text = str("text", 1000);
      if (!config.text) return { ok: false, error: "Note text is required" };
      title ||= "Note"; break;
    }
    case "list": case "tracker": {
      title ||= kind === "list" ? "List" : "Task tracker"; break;
    }
    case "goal": {
      const target = Number(str("target", 15));
      if (!isFinite(target) || target <= 0) return { ok: false, error: "Set a target above 0" };
      config.target = String(target);
      config.unit = str("unit", 20);
      title ||= "Goal"; break;
    }
  }
  const out: { kind: PanelKind; title: string; config: Record<string, string>; description?: string; items?: PanelItem[] } = { kind, title, config };
  if (input.description !== undefined) {
    const d = typeof input.description === "string" ? input.description.replace(/\s+/g, " ").trim() : "";
    if (d.length > 300) return { ok: false, error: "Description is too long (300 max)" };
    if (d) out.description = d;
  }
  if (input.items !== undefined && (kind === "list" || kind === "tracker" || kind === "goal")) {
    const it = validateItems(kind, input.items);
    if (!it.ok) return it;
    out.items = it.items;
  }
  return { ok: true, value: out };
}

const newId = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)).slice(0, 36);
const okId = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9-]{1,36}$/.test(v) ? v : newId());

/** Strict schema check for panel items. Unknown fields are dropped; nothing is executed or evaluated. */
export function validateItems(kind: PanelKind, raw: unknown): { ok: true; items: PanelItem[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "Items must be a list" };
  const max = kind === "goal" ? 365 : MAX_ITEMS;
  if (raw.length > max) return { ok: false, error: `At most ${max} items` };
  const items: PanelItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return { ok: false, error: "Bad item" };
    const x = r as Record<string, unknown>;
    if (kind === "goal") {
      const amount = Number(x.amount);
      if (!isFinite(amount) || Math.abs(amount) > 1e9) return { ok: false, error: "Each entry needs a number" };
      const date = typeof x.date === "string" && !isNaN(Date.parse(x.date)) ? new Date(x.date).toISOString() : new Date().toISOString();
      items.push({ id: okId(x.id), amount, note: typeof x.note === "string" ? x.note.trim().slice(0, 120) : "", date });
      continue;
    }
    const text = typeof x.text === "string" ? x.text.replace(/\s+/g, " ").trim() : "";
    if (!text) return { ok: false, error: "Items can't be empty" };
    if (text.length > 200) return { ok: false, error: "Items are limited to 200 characters" };
    if (kind === "list") items.push({ id: okId(x.id), text, done: x.done === true });
    else {
      const status = x.status === "doing" || x.status === "done" ? x.status : "todo";
      items.push({ id: okId(x.id), text, status });
    }
  }
  return { ok: true, items };
}

type Patch = { title?: string; description?: string; items?: PanelItem[]; config?: Record<string, string> };
/** Validate an edit to an existing panel of the given kind. Kind itself can't change. */
export function validatePanelPatch(kind: PanelKind, current: Record<string, string>, input: Record<string, unknown>): { ok: true; value: Patch } | { ok: false; error: string } {
  const value: Patch = {};
  if (input.title !== undefined) {
    const t = typeof input.title === "string" ? input.title.replace(/\s+/g, " ").trim() : "";
    if (!t || t.length > 80) return { ok: false, error: "Title must be 1–80 characters" };
    value.title = t;
  }
  if (input.description !== undefined) {
    const d = typeof input.description === "string" ? input.description.replace(/\s+/g, " ").trim() : "";
    if (d.length > 300) return { ok: false, error: "Description is too long (300 max)" };
    value.description = d;
  }
  if (input.items !== undefined) {
    if (kind !== "list" && kind !== "tracker" && kind !== "goal") return { ok: false, error: "This panel has no items" };
    const it = validateItems(kind, input.items);
    if (!it.ok) return it;
    value.items = it.items;
  }
  if (input.config !== undefined) {
    const v = validatePanel({ kind, config: { ...current, ...(input.config as Record<string, unknown>) }, title: "x" });
    if (!v.ok) return v;
    if (kind === "weather" || kind === "crypto" || kind === "ai") return { ok: false, error: "Remove and re-add this panel to change its source" };
    value.config = v.value.config;
  }
  if (!Object.keys(value).length) return { ok: false, error: "Nothing to update" };
  return { ok: true, value };
}

/** One-line summary for structured panels (used on cards and Home). */
export function summarizePanel(p: Pick<Panel, "kind" | "items" | "config">): string {
  const items = p.items ?? [];
  if (p.kind === "list") {
    const l = items as ListItem[]; const done = l.filter((i) => i.done).length;
    return l.length ? `${done} of ${l.length} done` : "Empty list";
  }
  if (p.kind === "tracker") {
    const t = items as TrackerItem[];
    const c = (s: TrackerItem["status"]) => t.filter((i) => i.status === s).length;
    return t.length ? `${c("todo")} to do · ${c("doing")} doing · ${c("done")} done` : "No tasks yet";
  }
  if (p.kind === "goal") {
    const total = goalTotal(items as GoalEntry[]);
    const target = Number(p.config.target) || 0;
    const unit = p.config.unit ? ` ${p.config.unit}` : "";
    return `${fmtNum(total)} of ${fmtNum(target)}${unit} (${target ? Math.min(100, Math.round((total / target) * 100)) : 0}%)`;
  }
  return "";
}

export function goalTotal(entries: GoalEntry[]): number {
  return Math.round(entries.reduce((a, e) => a + (Number(e.amount) || 0), 0) * 100) / 100;
}
const fmtNum = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);

export function daysUntil(date: string, now = new Date()): number {
  const d = new Date(date);
  const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((a - b) / 86400000);
}

const WMO: Record<number, [string, string]> = {
  0: ["Clear", "☀️"], 1: ["Mostly clear", "🌤️"], 2: ["Partly cloudy", "⛅"], 3: ["Cloudy", "☁️"],
  45: ["Fog", "🌫️"], 48: ["Fog", "🌫️"], 51: ["Drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Drizzle", "🌦️"],
  61: ["Rain", "🌧️"], 63: ["Rain", "🌧️"], 65: ["Heavy rain", "🌧️"], 71: ["Snow", "🌨️"], 73: ["Snow", "🌨️"], 75: ["Heavy snow", "❄️"],
  80: ["Showers", "🌦️"], 81: ["Showers", "🌧️"], 82: ["Violent showers", "⛈️"], 95: ["Thunderstorm", "⛈️"], 96: ["Thunderstorm", "⛈️"], 99: ["Thunderstorm", "⛈️"],
};
export function weatherLabel(code: number): [string, string] { return WMO[code] ?? ["—", "🌡️"]; }
