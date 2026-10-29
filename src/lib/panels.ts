export const PANEL_KINDS = ["weather", "countdown", "crypto", "ai", "note"] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];
export type Panel = {
  id: string; kind: PanelKind; title: string;
  config: Record<string, string>; data: Record<string, unknown> | null;
  error?: string | null; refreshed_at?: string | null;
};

/** How long a panel's data stays fresh before a view triggers a refresh (ms). */
export const STALE_MS: Record<PanelKind, number> = {
  weather: 60 * 60 * 1000, crypto: 60 * 60 * 1000, ai: 24 * 60 * 60 * 1000, countdown: Infinity, note: Infinity,
};

export function isStale(p: Pick<Panel, "kind" | "refreshed_at" | "data">, now = Date.now()): boolean {
  if (p.kind === "countdown" || p.kind === "note") return false;
  if (!p.refreshed_at || !p.data) return true;
  return now - new Date(p.refreshed_at).getTime() > STALE_MS[p.kind];
}

type V = { ok: true; value: { kind: PanelKind; title: string; config: Record<string, string> } } | { ok: false; error: string };

export function validatePanel(input: { kind?: unknown; title?: unknown; config?: unknown }): V {
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
  }
  return { ok: true, value: { kind, title, config } };
}

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
