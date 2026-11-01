"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

/** On/off for the daily "For you" scan of Gmail and Calendar. */
export default function ProactiveToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/settings").then((r) => r.json()).then((j) => setOn(j.settings?.proactive_enabled !== false)).catch(() => setOn(true)); }, []);
  async function flip() {
    const next = !on;
    const r = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proactive_enabled: next }) }).catch(() => null);
    if (r?.ok) { setOn(next); setError(""); } else setError("Couldn't save. Try again.");
  }
  if (on === null) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="proactive-toggle">
      <span className="text-sm text-ink-soft">Daily scan is <strong className="text-ink">{on ? "on" : "off"}</strong></span>
      <Button size="sm" onClick={flip}>{on ? "Turn off" : "Turn on"}</Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
