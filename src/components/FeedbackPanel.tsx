"use client";
import { useState } from "react";
import FeedbackForm from "@/components/FeedbackForm";
import MyFeedback from "@/components/MyFeedback";

/** Settings → Send feedback: the form, then the user's own messages (refreshed after each send). */
export default function FeedbackPanel() {
  const [n, setN] = useState(0);
  return (
    <>
      <div className="rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur-xl">
        <FeedbackForm pagePath="/app/settings/feedback" onSent={() => setN((x) => x + 1)} />
      </div>
      <MyFeedback refreshKey={n} />
    </>
  );
}
