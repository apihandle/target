"use client";
import { useAssistantState, type PhoneActionKind } from "@/components/home/AssistantState";

const ACTIONS: { kind: PhoneActionKind; label: string }[] = [
  { kind: "call", label: "Call" },
  { kind: "whatsapp", label: "WhatsApp" },
  { kind: "sms", label: "SMS" },
  { kind: "alarm", label: "Alarm" },
  { kind: "timer", label: "Timer" },
  { kind: "camera", label: "Camera" },
  { kind: "flashlight", label: "Flashlight" },
  { kind: "music", label: "Music" },
];

/**
 * Phone quick actions, appended to the existing quick-action chips on Home. Rendered only
 * inside the Android app, where window.TargetAndroid can actually do these; in a browser
 * this renders nothing. Each action goes through the bridge (dialler, WhatsApp, SMS
 * composer, Clock, Camera, torch, Spotify) — nothing runs without the tap.
 */
export default function PhoneActionChips() {
  const s = useAssistantState();
  if (!s.inApp) return null;
  return (
    <>
      {ACTIONS.map((a) => (
        <li key={a.kind} className="shrink-0">
          <button type="button" data-testid="phone-action" data-kind={a.kind} onClick={() => s.phoneAction(a.kind)}
            aria-pressed={a.kind === "flashlight" ? s.flashlightOn : undefined}
            aria-label={a.kind === "flashlight" ? `Flashlight ${s.flashlightOn ? "off" : "on"}` : a.label}
            className="flex min-h-11 items-center whitespace-nowrap rounded-full border border-line bg-surface/70 px-3.5 text-xs text-ink-soft hover:border-line-strong hover:text-ink">
            {a.label}
          </button>
        </li>
      ))}
    </>
  );
}
