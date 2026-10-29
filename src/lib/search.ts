// Feature 9: live web search via Tavily.
export type Source = { title: string; url: string };
export type SearchHit = { title: string; url: string; content: string };
export type SearchResult = { answer?: string; results: SearchHit[] };

const EXPLICIT = /^\s*(?:\/search|\/web|search(?:\s+the\s+web)?\s*:)\s*/i;
const SEARCH_VERB = /\b(search|google|look\s*up|dhoondh|dhundh|khoj)\w*\b/i;
const FRESH = /\b(latest|today'?s?|tonight|this\s+week|right\s+now|currently|current|news|headlines?|breaking|live\s+score|score|results?|who\s+won|price\s+of|price|rate|stock|share\s+price|weather|forecast|release\s+date|launched?|abhi|aaj|aajkal|taaza|khabar|kya\s+chal\s+raha|kitne\s+ka|bhav)\b/i;
const YEAR = /\b20(2[5-9]|3\d)\b/;
const SMALLTALK = /^(hi|hello|hey|thanks|thank you|ok|okay|shukriya|dhanyavad)\b/i;

/** Decide whether a message needs fresh information from the web. */
export function needsSearch(text: string): boolean {
  const t = text.trim();
  if (!t || SMALLTALK.test(t) && t.length < 25) return false;
  if (EXPLICIT.test(t)) return true;
  if (/\b(remember|yaad\s+rakh)/i.test(t)) return false;
  if (/\b(draft|write|likh|explain|translate|code|poem|essay)\b/i.test(t) && !SEARCH_VERB.test(t) && !/\b(news|latest)\b/i.test(t)) return false;
  return SEARCH_VERB.test(t) || FRESH.test(t) || YEAR.test(t);
}

/** Build the query sent to the search engine. */
export function searchQuery(text: string): string {
  return text.replace(EXPLICIT, "").replace(/\s+/g, " ").trim().slice(0, 380);
}

export async function tavilySearch(query: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<SearchResult> {
  const res = await fetchImpl("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, search_depth: "basic", max_results: 5, include_answer: true }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const j = (await res.json()) as { answer?: string; results?: { title?: string; url?: string; content?: string }[] };
  const results = (j.results ?? [])
    .filter((r) => typeof r.url === "string" && /^https?:\/\//.test(r.url))
    .map((r) => ({ title: (r.title || r.url || "").slice(0, 160), url: r.url as string, content: (r.content || "").slice(0, 900) }))
    .slice(0, 5);
  return { answer: j.answer || undefined, results };
}

/** System-prompt block with the search results the model should ground its reply in. */
export function searchBlock(query: string, r: SearchResult): string {
  if (!r.results.length) return `\n\nA live web search for "${query}" returned nothing useful; say you couldn't find current info rather than guessing.`;
  const lines = r.results.map((h, i) => `[${i + 1}] ${h.title} (${h.url})\n${h.content}`).join("\n\n");
  return `\n\nLIVE WEB SEARCH RESULTS for "${query}" (fetched just now). Base your answer on these, prefer them over your own knowledge for anything recent, cite sources inline like [1], and don't invent facts not in them.` +
    (r.answer ? `\nSearch summary: ${r.answer.slice(0, 600)}` : "") + `\n\n${lines}`;
}

export function sourcesFence(r: SearchResult): string {
  const s: Source[] = r.results.map(({ title, url }) => ({ title, url }));
  return s.length ? "\n\n```sources\n" + JSON.stringify(s) + "\n```" : "";
}

/** Pull a ```sources block out of a stored reply. */
export function splitSources(content: string): { text: string; sources: Source[] } {
  const sources: Source[] = [];
  let text = content.replace(/```sources\s*\n?([\s\S]*?)```/gi, (_m, body: string) => {
    try {
      const arr = JSON.parse(body.trim());
      for (const x of Array.isArray(arr) ? arr : []) {
        if (x && typeof x.url === "string" && /^https?:\/\//.test(x.url) && sources.length < 5)
          sources.push({ title: String(x.title || x.url).slice(0, 160), url: x.url });
      }
    } catch { /* drop malformed */ }
    return "";
  });
  const open = text.search(/```sources\b/i);
  if (open !== -1) text = text.slice(0, open);
  return { text: text.trimEnd(), sources };
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}
