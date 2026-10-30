"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmButton } from "@/components/ui/ConfirmButton";

export default function ClearActivity() {
  const router = useRouter();
  const [error, setError] = useState("");
  return (
    <div className="flex items-center gap-3">
      <ConfirmButton label="Clear activity history" question="Delete all activity history? Tasks and approvals stay." confirmLabel="Clear history" testId="activity-clear"
        onConfirm={async () => {
          const r = await fetch("/api/activity", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) }).catch(() => null);
          if (!r || !r.ok) setError("Couldn't clear history"); else router.refresh();
        }} />
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
