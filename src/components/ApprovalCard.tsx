"use client";
import { Fragment, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { ACTION_DEFS, STATUS_TEXT, type Approval } from "@/lib/approvals";

const FIELD_LABEL: Record<string, string> = { connector: "App", tool: "Action", args: "Details", title: "Title", notes: "Notes", name: "Name", description: "Purpose", start: "Starts", end: "Ends", location: "Location", details: "Details", items: "Items", total: "Total", payment: "Pay with", deliver_to: "Deliver to", to: "To", cc: "Cc", bcc: "Bcc", subject: "Subject", body: "Message", flow: "Action", site: "Website", email: "Email", what: "Booking", when: "When", price: "Price" };
const HIDDEN = new Set(["browser_job_id"]);
const MAIL_TOOLS = new Set(["gmail_send", "gmail_reply", "gmail_reply_all", "gmail_forward", "gmail_send_draft"]);

/** An email waiting to be sent: the card shows the exact recipients, subject and text instead of raw JSON. */
export function emailOf(payload: Record<string, unknown> | null | undefined): { to: string; cc?: string; bcc?: string; subject: string; body: string } | null {
  if (!payload || payload.connector !== "google" || payload.tool !== "gmail_send") return null;
  const a = payload.args as Record<string, unknown> | undefined;
  if (!a || typeof a.to !== "string" || typeof a.subject !== "string" || typeof a.body !== "string") return null;
  return { to: a.to, ...(typeof a.cc === "string" && a.cc.trim() ? { cc: a.cc } : {}), ...(typeof a.bcc === "string" && a.bcc.trim() ? { bcc: a.bcc } : {}), subject: a.subject, body: a.body };
}

/**
 * A connector action the server looked up before asking (e.g. a repository about to be deleted): the card shows
 * those server-built details and warning instead of the raw arguments.
 */
export function previewOf(payload: Record<string, unknown> | null | undefined): { rows: [string, string][]; warning?: string } | null {
  const p = payload?.preview as { details?: Record<string, unknown>; warning?: unknown } | undefined;
  if (!p || typeof p !== "object") return null;
  const rows = Object.entries(p.details ?? {}).filter(([, v]) => typeof v === "string" && v).map(([k, v]) => [k, v as string] as [string, string]);
  const warning = typeof p.warning === "string" && p.warning ? p.warning : undefined;
  return rows.length || warning ? { rows, ...(warning ? { warning } : {}) } : null;
}

function fmt(k: string, v: unknown) {
  if ((k === "start" || k === "end") && typeof v === "string" && !isNaN(Date.parse(v)))
    return new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + " IST";
  if (k === "items" && Array.isArray(v)) return v.map((i: { name?: string; qty?: number; price?: string }) => `${i.qty ?? 1} x ${i.name ?? ""}${i.price ? `  ${i.price}` : ""}`).join("\n");
  if (k === "flow" && (v === "reset" || v === "register")) return v === "reset" ? "Reset the password (a new one is generated and saved in your vault, never shown)" : "Create a new account (the password is generated and saved in your vault, never shown)";
  if (v && typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

/**
 * Shows exactly what an approved action will do, where, with which details, then Approve / Reject.
 * All details come from the server record, never from chat text.
 */
export default function ApprovalCard({ id, initial, onChange }: { id: string; initial?: Approval; onChange?: (a: Approval) => void }) {
  const [a, setA] = useState<Approval | null>(initial ?? null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<"" | "approve" | "reject">("");
  const [error, setError] = useState("");

  async function load() {
    setLoadError("");
    try {
      const r = await fetch(`/api/approvals/${id}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setLoadError(r.status === 404 ? "This request no longer exists." : j.error ?? "Couldn't load this request"); return; }
      setA(j.approval);
    } catch { setLoadError("Couldn't load this request"); }
  }
  useEffect(() => { if (!initial) load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(decision: "approve" | "reject") {
    setBusy(decision); setError("");
    try {
      const r = await fetch(`/api/approvals/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
      const j = await r.json().catch(() => ({}));
      if (j.approval) { setA(j.approval); onChange?.(j.approval); }
      if (!r.ok) setError(j.error ?? "That didn't work");
    } catch { setError("Network error. Nothing was changed on this device; reload to see the current status."); }
    finally { setBusy(""); }
  }

  if (loadError) return <p data-testid="approval-missing" className="mt-3 rounded-lg border border-line px-3 py-2 text-xs text-muted">{loadError} <button className="underline" onClick={load}>Retry</button></p>;
  if (!a) return <div data-testid="approval-loading" className="mt-3 h-24 animate-pulse rounded-xl border border-line bg-surface" aria-label="Loading approval request" />;

  const def = ACTION_DEFS[a.action_type];
  // Task mode: approved in code, shown compact. A failure keeps the full card so it can be retried.
  if (a.auto && a.status !== "failed") {
    return (
      <section data-testid="approval-auto" data-status={a.status} aria-label={`Done automatically: ${a.summary}`} className="not-prose mt-2 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs">
        <span aria-hidden className={a.status === "executed" ? "text-ok" : "text-muted"}>{a.status === "executed" ? "✓" : "…"}</span>
        <span className="font-medium text-ink">{a.status === "executed" ? "Done automatically" : "Running automatically"}</span>
        <span className="min-w-0 flex-1 truncate text-muted">{a.summary}</span>
      </section>
    );
  }
  const email = emailOf(a.payload);
  const preview = previewOf(a.payload);
  // Replies, forwards and drafts are emails too; their recipients and text come from the server-built preview.
  const sendsMail = !!email || (a.payload?.connector === "google" && MAIL_TOOLS.has(String(a.payload?.tool)));
  const details: [string, unknown][] = email
    ? [...Object.entries(email), ...(preview?.rows ?? []).filter(([k]) => !(k in email))]
    : preview
      ? [["connector", a.payload.connector], ["tool", a.payload.tool], ...preview.rows]
      : Object.entries(a.payload ?? {}).filter(([k, v]) => v !== "" && v != null && !HIDDEN.has(k));
  const reconnect = a.status === "failed" && /^Reconnect /.test(a.error ?? "") && typeof a.payload?.connector === "string" ? `/app/connectors?connect=${encodeURIComponent(a.payload.connector)}` : null;
  const canDecide = a.status === "pending" || a.status === "failed";
  const link = typeof a.result?.link === "string" && /^https:\/\//.test(a.result.link) ? a.result.link : null;

  return (
    <section data-testid="approval-card" data-status={a.status} aria-label={`Approval request: ${a.summary}`}
      className="not-prose mt-3 rounded-xl border border-warn/30 bg-surface p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{sendsMail ? "Send an email" : def?.label ?? a.action_type}</p>
          <p className="mt-0.5 font-medium text-ink">{a.summary}</p>
        </div>
        <StatusBadge status={a.status} label={STATUS_TEXT[a.status]} />
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted">Where</dt><dd className="text-ink-soft">{a.destination}</dd>
        {details.map(([k, v]) => (<Fragment key={k}><dt className="text-muted">{FIELD_LABEL[k] ?? k}</dt><dd className="whitespace-pre-wrap break-words text-ink-soft">{fmt(k, v)}</dd></Fragment>))}
      </dl>
      {preview?.warning && a.status === "pending" && <p data-testid="approval-warning" role="note" className="mt-3 rounded-lg border border-danger/40 bg-danger-subtle px-3 py-2 text-xs font-medium text-danger">⚠ {preview.warning}</p>}
      {a.status === "pending" && <p className="mt-3 text-xs text-muted">{sendsMail ? "Nothing is sent until you approve. You can reject it instead." : "Nothing happens until you approve. You can reject it instead."}</p>}
      {a.status === "executed" && <p data-testid="approval-result" className="mt-3 text-xs text-ok">{sendsMail ? "Sent." : "Done."}{link && <> <a className="underline" href={link} target="_blank" rel="noopener noreferrer">Open it</a></>}</p>}
      {a.status === "failed" && <p data-testid="approval-error" className="mt-3 text-xs text-danger">It failed: {a.error ?? "unknown error"}. {reconnect ? <><a className="underline" href={reconnect} data-testid="approval-reconnect">Reconnect</a>, then approve again to retry, or cancel.</> : "You can approve it again to retry, or cancel."}</p>}
      {(a.status === "rejected" || a.status === "cancelled") && <p className="mt-3 text-xs text-muted">Nothing was done.</p>}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      {canDecide && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="approve" data-testid="approve-btn" disabled={!!busy} onClick={() => decide("approve")}>
            {busy === "approve" ? "Running…" : a.status === "failed" ? "Approve & retry" : a.action_type === "purchase" ? "Place order" : a.action_type === "reservation" ? "Confirm booking" : email ? "Approve & send" : a.payload?.tool === "delete_repo" ? "Approve & delete" : "Approve"}
          </Button>
          <Button size="sm" variant="secondary" data-testid="reject-btn" disabled={!!busy} onClick={() => decide("reject")}>
            {busy === "reject" ? "…" : a.status === "failed" ? "Cancel" : "Reject"}
          </Button>
        </div>
      )}
    </section>
  );
}
