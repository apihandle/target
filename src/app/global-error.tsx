"use client";
import { useEffect } from "react";
import { sendErrorReport } from "@/lib/clientErrors";

/** Last-resort boundary when the root layout itself fails. Has to bring its own html and styles. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { sendErrorReport(error, { digest: error.digest }); }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#05090c", color: "#eeede4", fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
        <div style={{ maxWidth: 360, padding: 24 }}>
          <h1 style={{ fontSize: 26, fontWeight: 500 }}>Something went wrong</h1>
          <p style={{ color: "#94a2a3", fontSize: 14 }}>The error has been reported. Please try again.</p>
          <button onClick={reset} style={{ marginTop: 16, background: "#e6c487", color: "#1a1406", border: 0, borderRadius: 999, padding: "10px 22px", fontWeight: 600, cursor: "pointer" }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
