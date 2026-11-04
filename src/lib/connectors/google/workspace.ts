import { z } from "zod";
import { clip, tool } from "@/lib/connectors/define";
import type { ToolContext } from "@/lib/connectors/types";
import { NEED, type GTool, fileId, gcall, qs, str } from "@/lib/connectors/google/shared";

/** Google Sheets, Docs and Contacts basics. */
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const DOCS = "https://docs.googleapis.com/v1/documents";
const PEOPLE = "https://people.googleapis.com/v1";

const range = z.string().min(1).max(200).regex(/^[^\r\n]+$/).describe("A1 range, e.g. Sheet1!A1:D20 (or just a tab name)");
const cell = z.union([z.string().max(50000), z.number(), z.boolean(), z.null()]);
const rows = z.array(z.array(cell).max(200)).min(1).max(5000);
const r = (id: string, rng: string) => `${SHEETS}/${id}/values/${encodeURIComponent(rng)}`;

type SheetInfo = { properties?: { title?: string; timeZone?: string }; sheets?: { properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number; columnCount?: number } } }[]; spreadsheetUrl?: string };
const info = (ctx: ToolContext, id: string) => gcall<SheetInfo>(ctx, `${SHEETS}/${id}?fields=properties(title,timeZone),spreadsheetUrl,sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))`);
const firstTab = async (ctx: ToolContext, id: string) => str((await info(ctx, id)).sheets?.[0]?.properties?.title) || "Sheet1";
/** A bare tab name must be quoted when it has spaces or symbols ('My tab'). */
const quoteTab = (t: string) => (/^[A-Za-z0-9_]+$/.test(t) ? t : `'${t.replace(/'/g, "''")}'`);

type DocEl = { paragraph?: { elements?: { textRun?: { content?: string } }[]; paragraphStyle?: { namedStyleType?: string } }; table?: { tableRows?: { tableCells?: { content?: DocEl[] }[] }[] } };
/** Plain text of a Doc body; headings get #, table cells are separated by " | ". */
export function docText(content: DocEl[] = []): string {
  const out: string[] = [];
  for (const el of content) {
    if (el.paragraph) {
      const t = (el.paragraph.elements ?? []).map((e) => e.textRun?.content ?? "").join("");
      const h = /^HEADING_(\d)$/.exec(el.paragraph.paragraphStyle?.namedStyleType ?? "")?.[1];
      out.push(h && t.trim() ? `${"#".repeat(Number(h))} ${t}` : t);
    } else if (el.table) {
      for (const row of el.table.tableRows ?? []) out.push((row.tableCells ?? []).map((c) => docText(c.content).replace(/\n+/g, " ").trim()).join(" | ") + "\n");
    }
  }
  return out.join("");
}

type Person = { names?: { displayName?: string }[]; emailAddresses?: { value?: string; type?: string }[]; phoneNumbers?: { value?: string }[]; organizations?: { name?: string; title?: string }[] };
const personView = (p: Person, source: string) => ({
  name: p.names?.[0]?.displayName, emails: (p.emailAddresses ?? []).map((e) => e.value).filter(Boolean),
  ...(p.phoneNumbers?.length ? { phones: p.phoneNumbers.map((x) => x.value) } : {}), ...(p.organizations?.[0]?.name ? { org: p.organizations[0].name } : {}), source,
});

export const WORKSPACE_TOOLS: GTool[] = [
  // ------------------------------------------------------------ Sheets
  { need: NEED.sheetsRead, ...tool({
    name: "sheets_get_info",
    description: "A Google Sheet's title, link and tabs (name, rows, columns). Use before reading or writing to learn the tab names.",
    input: z.object({ spreadsheet_id: fileId }),
    async execute(a, ctx) {
      const s = await info(ctx, a.spreadsheet_id);
      return { title: s.properties?.title, link: s.spreadsheetUrl, tabs: (s.sheets ?? []).map((t) => ({ title: t.properties?.title, rows: t.properties?.gridProperties?.rowCount, columns: t.properties?.gridProperties?.columnCount })) };
    },
  }) },
  { need: NEED.sheetsRead, ...tool({
    name: "sheets_read_range",
    description: "Read cells from a Google Sheet (A1 range like Sheet1!A1:F50, or a tab name for the whole tab). Defaults to the first tab.",
    input: z.object({ spreadsheet_id: fileId, range: range.optional() }),
    async execute(a, ctx) {
      const rng = a.range ?? quoteTab(await firstTab(ctx, a.spreadsheet_id));
      const j = await gcall<{ range?: string; values?: unknown[][] }>(ctx, `${r(a.spreadsheet_id, rng)}?valueRenderOption=FORMATTED_VALUE`);
      const values = j.values ?? [];
      return { range: j.range, rows: values.length, values: values.slice(0, 1000), ...(values.length > 1000 ? { note: `Showing the first 1000 of ${values.length} rows; read a smaller range for the rest.` } : {}) };
    },
  }) },
  { need: NEED.sheetsWrite, ...tool({
    name: "sheets_append_rows",
    description: "Add rows at the bottom of a Google Sheet tab (after the last row with data). Values are entered as if typed (numbers, dates and =formulas work).",
    input: z.object({ spreadsheet_id: fileId, tab: z.string().min(1).max(100).optional().describe("Tab name; defaults to the first tab"), rows }),
    async execute(a, ctx) {
      const tab = quoteTab(a.tab ?? await firstTab(ctx, a.spreadsheet_id));
      const j = await gcall<{ updates?: { updatedRange?: string; updatedRows?: number } }>(ctx, `${r(a.spreadsheet_id, tab)}:append${qs({ valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS" })}`, { method: "POST", body: { json: { values: a.rows } } });
      return { appended: j.updates?.updatedRows ?? a.rows.length, range: j.updates?.updatedRange };
    },
  }) },
  { need: NEED.sheetsWrite, ...tool({
    name: "sheets_update_range",
    description: "Write values into specific cells of a Google Sheet (overwrites that range), e.g. range Sheet1!B2:C3 with [[1,2],[3,4]]. Values are entered as if typed.",
    input: z.object({ spreadsheet_id: fileId, range, values: rows }),
    async execute(a, ctx) {
      const j = await gcall<{ updatedRange?: string; updatedCells?: number }>(ctx, `${r(a.spreadsheet_id, a.range)}?valueInputOption=USER_ENTERED`, { method: "PUT", body: { json: { range: a.range, majorDimension: "ROWS", values: a.values } } });
      return { updated_cells: j.updatedCells, range: j.updatedRange };
    },
  }) },
  { need: NEED.sheetsWrite, ...tool({
    name: "sheets_add_tab",
    description: "Add a new tab to a Google Sheet.",
    input: z.object({ spreadsheet_id: fileId, title: z.string().min(1).max(100) }),
    async execute(a, ctx) {
      const j = await gcall<{ replies?: { addSheet?: { properties?: { sheetId?: number; title?: string } } }[] }>(ctx, `${SHEETS}/${a.spreadsheet_id}:batchUpdate`, { method: "POST", body: { json: { requests: [{ addSheet: { properties: { title: a.title } } }] } } });
      return { added: true, tab: j.replies?.[0]?.addSheet?.properties?.title ?? a.title };
    },
  }) },
  // ------------------------------------------------------------ Docs
  { need: NEED.docsRead, ...tool({
    name: "docs_read",
    description: "Read a Google Doc's title and text (headings marked with #, tables as rows).",
    input: z.object({ document_id: fileId }),
    async execute(a, ctx) {
      const d = await gcall<{ title?: string; body?: { content?: DocEl[] } }>(ctx, `${DOCS}/${a.document_id}`);
      return { title: d.title, link: `https://docs.google.com/document/d/${a.document_id}/edit`, text: clip(docText(d.body?.content), 30000) };
    },
  }) },
  { need: NEED.docsWrite, ...tool({
    name: "docs_append_text",
    description: "Add text at the end of a Google Doc (starts on a new line).",
    input: z.object({ document_id: fileId, text: z.string().min(1).max(200000) }),
    async execute(a, ctx) {
      await gcall(ctx, `${DOCS}/${a.document_id}:batchUpdate`, { method: "POST", body: { json: { requests: [{ insertText: { endOfSegmentLocation: { segmentId: "" }, text: `\n${a.text}` } }] } } });
      return { appended: true, characters: a.text.length, link: `https://docs.google.com/document/d/${a.document_id}/edit` };
    },
  }) },
  { need: NEED.docsWrite, ...tool({
    name: "docs_replace_text",
    description: "Find and replace text everywhere in a Google Doc. Returns how many places changed.",
    input: z.object({ document_id: fileId, find: z.string().min(1).max(1000), replace: z.string().max(10000), match_case: z.boolean().default(true) }),
    async execute(a, ctx) {
      const j = await gcall<{ replies?: { replaceAllText?: { occurrencesChanged?: number } }[] }>(ctx, `${DOCS}/${a.document_id}:batchUpdate`, { method: "POST", body: { json: { requests: [{ replaceAllText: { containsText: { text: a.find, matchCase: a.match_case }, replaceText: a.replace } }] } } });
      return { replaced: j.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0 };
    },
  }) },
  // ------------------------------------------------------------ Contacts
  { need: NEED.contacts, ...tool({
    name: "contacts_search",
    description: "Look up people in the user's Google Contacts (and people they've emailed) by name, email or phone, to get the right email address before sending or inviting.",
    input: z.object({ query: z.string().min(1).max(100), max: z.number().int().min(1).max(30).default(10) }),
    async execute(a, ctx) {
      const mask = "names,emailAddresses,phoneNumbers,organizations";
      // The People API asks for an empty "warm-up" search before real ones so its cache is fresh.
      const [mine, other] = await Promise.all([
        (async () => {
          await gcall(ctx, `${PEOPLE}/people:searchContacts${qs({ query: "", readMask: "names" })}`).catch(() => undefined);
          return gcall<{ results?: { person?: Person }[] }>(ctx, `${PEOPLE}/people:searchContacts${qs({ query: a.query, readMask: mask, pageSize: a.max })}`).catch((e) => ({ error: e as Error }));
        })(),
        (async () => {
          await gcall(ctx, `${PEOPLE}/otherContacts:search${qs({ query: "", readMask: "names,emailAddresses" })}`).catch(() => undefined);
          return gcall<{ results?: { person?: Person }[] }>(ctx, `${PEOPLE}/otherContacts:search${qs({ query: a.query, readMask: "names,emailAddresses,phoneNumbers", pageSize: a.max })}`).catch((e) => ({ error: e as Error }));
        })(),
      ]);
      if ("error" in mine && "error" in other) throw mine.error;
      const people = [
        ...("results" in mine ? (mine.results ?? []).map((x) => personView(x.person ?? {}, "contacts")) : []),
        ...("results" in other ? (other.results ?? []).map((x) => personView(x.person ?? {}, "emailed before")) : []),
      ];
      const seen = new Set<string>();
      const out = people.filter((p) => { const k = (p.emails[0] ?? p.name ?? "").toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
      return { people: out.slice(0, a.max), ...(out.length ? {} : { note: `No contact matches “${a.query}”. Ask the user for the address; never guess it.` }) };
    },
  }) },
];
