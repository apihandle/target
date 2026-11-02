"use client";
import { useState } from "react";
import { actionLabel, calendarUrl, mapUrl, type Action } from "@/lib/actions";
import ApprovalCard from "@/components/ApprovalCard";
import ConnectCard from "@/components/ConnectCard";
import LoginCard from "@/components/LoginCard";
import OtpCard from "@/components/OtpCard";

type State = "idle" | "busy" | "done" | "error";

export default function ActionButtons({ actions }: { actions: Action[] }) {
  const [state, setState] = useState<Record<number, State>>({});
  const [msg, setMsg] = useState<Record<number, string>>({});
  if (!actions.length) return null;

  async function run(i: number, a: Action) {
    const set = (st: State, m = "") => { setState((x) => ({ ...x, [i]: st })); setMsg((x) => ({ ...x, [i]: m })); };
    if (a.type === "copy") {
      try { await navigator.clipboard.writeText(a.text); set("done", "Copied"); } catch { set("error", "Couldn't copy"); }
      return;
    }
    if (a.type !== "memory" && a.type !== "panel") return;
    set("busy");
    const r = a.type === "memory"
      ? await fetch("/api/memories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: a.content }) })
      : await fetch("/api/panels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: a.kind, title: a.title, config: a.config }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) set("done", a.type === "memory" ? "Saved to memory" : "Added to Home");
    else if (r.status === 409) set("done", "Already remembered");
    else set("error", j.error ?? "Failed");
  }

  const cls = "inline-flex items-center gap-1 rounded-full border border-line-strong bg-surface px-3 py-1.5 text-xs text-ink-soft no-underline transition hover:bg-surface-2 disabled:opacity-50";
  const approvals = actions.filter((a): a is Extract<Action, { type: "approval" }> => a.type === "approval");
  const limits = actions.filter((a): a is Extract<Action, { type: "unavailable" }> => a.type === "unavailable");
  const connects = actions.filter((a): a is Extract<Action, { type: "connect" }> => a.type === "connect");
  const logins = actions.filter((a): a is Extract<Action, { type: "vault_login" }> => a.type === "vault_login");
  const codes = actions.filter((a): a is Extract<Action, { type: "otp" }> => a.type === "otp");
  const buttons = actions.filter((a) => !["approval", "unavailable", "connect", "vault_login", "otp"].includes(a.type));
  return (
    <>
    {buttons.length > 0 && <div data-testid="actions" className="mt-3 flex flex-wrap gap-2">
      {buttons.map((a, i) => {
        const st = state[i] ?? "idle";
        const label = st === "done" || st === "error" ? (st === "done" ? "✓ " : "⚠ ") + msg[i] : st === "busy" ? "…" : actionLabel(a);
        if (a.type === "calendar" || a.type === "map" || a.type === "link") {
          const href = a.type === "calendar" ? calendarUrl(a) : a.type === "map" ? mapUrl(a.query) : a.url;
          return <a key={i} data-testid="action" data-type={a.type} href={href} target="_blank" rel="noopener noreferrer" className={cls}>{label}</a>;
        }
        return <button key={i} data-testid="action" data-type={a.type} disabled={st === "busy" || st === "done"} onClick={() => run(i, a)} className={cls}>{label}</button>;
      })}
    </div>}
    {limits.map((l, i) => (
      <div key={`l${i}`} role="note" data-testid="action-unavailable" className="not-prose mt-3 rounded-xl border border-line-strong bg-surface px-4 py-3 text-xs text-muted">
        <p className="font-medium text-ink-soft">{l.label}</p>
        <p className="mt-0.5">{l.reason}</p>
      </div>
    ))}
    {connects.map((c) => <ConnectCard key={`${c.connector}-${c.taskId ?? ""}`} connector={c.connector} taskId={c.taskId} />)}
    {approvals.map((a) => <ApprovalCard key={a.id} id={a.id} />)}
    {logins.map((l) => <LoginCard key={l.site} site={l.site} forSite={l.for} />)}
    {codes.map((c) => <OtpCard key={c.job} job={c.job} site={c.site} />)}
    </>
  );
}
