import { json } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { auditFirst } from "@/lib/server/adminWrite";
import { AI_PROVIDER_LABEL, cleanAiFilters, loadAiCalls } from "@/lib/server/adminAiUsage";
import { toCsv } from "@/lib/adminConfig";

export const dynamic = "force-dynamic";

const MAX_ROWS = 5000;

/**
 * CSV of AI calls (one row per model attempt), newest first, same filters as the page (max 5000 rows). Audited.
 * There is no prompt or reply text in the table, so none can end up in the file.
 */
export async function GET(req: Request) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const sp = new URL(req.url).searchParams;
  const f = cleanAiFilters(Object.fromEntries(["provider", "model", "feature", "status", "user"].map((k) => [k, sp.get(k) ?? undefined])));
  const r = await loadAiCalls(a.db, { ...f, page: 1, limit: MAX_ROWS });
  if (r.error) return json({ error: "Could not load AI usage (has migration 0020 run?)" }, 502);
  const blocked = await auditFirst(a, { action: "export.ai_usage", targetType: "export", targetId: "ai_usage", detail: { rows: r.rows.length, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) } });
  if (blocked) return blocked;
  const csv = toCsv(
    ["created_at", "request_id", "attempt", "provider", "model", "feature", "user_id", "email", "streamed", "success", "error_code", "race_won", "latency_ms", "ttft_ms", "input_tokens", "output_tokens"],
    r.rows.map((x) => [x.created_at, x.request_id ?? "", x.attempt ?? "", AI_PROVIDER_LABEL[x.provider] ?? x.provider, x.model, x.feature, x.user_id ?? "", x.email, x.streamed ? "yes" : "no",
      x.success ? "yes" : "no", x.error_code ?? "", x.race_won == null ? "" : x.race_won ? "won" : "lost", x.latency_ms ?? "", x.ttft_ms ?? "", x.input_tokens ?? "", x.output_tokens ?? ""]),
  );
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="target-ai-usage-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}
