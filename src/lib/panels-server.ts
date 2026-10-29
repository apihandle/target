import { MODELS } from "@/lib/ai";
import type { Panel } from "@/lib/panels";

async function getJSON(url: string, init?: RequestInit) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`Source returned ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/** Gather fresh data for a panel. Throws with a user-readable message on failure. */
export async function computePanelData(p: Pick<Panel, "kind" | "config">): Promise<Record<string, unknown>> {
  switch (p.kind) {
    case "weather": {
      const g = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(p.config.city)}`);
      const place = g.results?.[0];
      if (!place) throw new Error(`Couldn't find "${p.config.city}"`);
      const w = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m" +
        "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1");
      return {
        place: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
        temp: w.current.temperature_2m, feels: w.current.apparent_temperature, code: w.current.weather_code,
        wind: w.current.wind_speed_10m, humidity: w.current.relative_humidity_2m,
        high: w.daily.temperature_2m_max[0], low: w.daily.temperature_2m_min[0], rain: w.daily.precipitation_probability_max?.[0] ?? null,
        source: "open-meteo.com",
      };
    }
    case "crypto": {
      const j = await getJSON(`https://api.coinbase.com/v2/prices/${p.config.symbol}-${p.config.currency}/spot`)
        .catch(() => { throw new Error(`No price for ${p.config.symbol} in ${p.config.currency}`); });
      const amount = Number(j.data?.amount);
      if (!isFinite(amount)) throw new Error(`No price for ${p.config.symbol}`);
      return { amount, currency: p.config.currency, symbol: p.config.symbol, source: "coinbase.com" };
    }
    case "ai": {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new Error("AI is not configured");
      const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
      const j = await getJSON("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://gettarget.vercel.app", "X-Title": "TARGET" },
        body: JSON.stringify({
          model: MODELS[0], models: MODELS, reasoning: { enabled: false },
          messages: [
            { role: "system", content: `You write the content of a small glanceable dashboard panel. Today is ${today}. Be concrete and short: at most 4 short lines or bullets, no preamble, plain markdown.` },
            { role: "user", content: p.config.prompt },
          ],
        }),
      });
      const text = (j.choices?.[0]?.message?.content ?? "").trim();
      if (!text) throw new Error("AI returned nothing");
      return { text: text.slice(0, 1200) };
    }
    default:
      return {};
  }
}
