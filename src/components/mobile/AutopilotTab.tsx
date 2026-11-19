"use client";

import React, { useState } from "react";
import {
  ShieldAlert,
  Play,
  Pause,
  CheckCircle2,
  ScanFace,
  Cpu,
  RefreshCw,
  KeyRound,
  Plane,
  Utensils,
  Car,
} from "lucide-react";

interface AutopilotTabProps {
  onTakeOver: () => void;
  onApprovePayment: () => void;
}

type AutopilotTaskKey = "acko" | "indigo" | "dinner";

interface AutopilotTask {
  key: AutopilotTaskKey;
  title: string;
  category: string;
  url: string;
  statusBadge: string;
  price: string;
  domNode: string;
  steps: Array<{ text: string; done: boolean; active?: boolean }>;
  safeguardTitle: string;
  safeguardDesc: string;
  safeguardAction: string;
}

const TASKS: Record<AutopilotTaskKey, AutopilotTask> = {
  acko: {
    key: "acko",
    title: "Acko Drive Secure Plus (Comprehensive)",
    category: "VEHICLE INSURANCE CHECKOUT",
    url: "https://acko.com/checkout/comprehensive-renew",
    statusBadge: "PAYMENT GATE",
    price: "₹8,940",
    domNode: "#card-pay-btn",
    steps: [
      { text: "Filled vehicle registration (DL-01-AB-1234)", done: true },
      { text: "Applied promo coupon TGT_EXCLUSIVE (Saved ₹1,200)", done: true },
      { text: "Payment gate reached: ₹8,940 awaiting user confirmation", done: false, active: true },
    ],
    safeguardTitle: "Human-in-the-Loop Safeguard",
    safeguardDesc:
      "Autopilot has prepared the checkout. Confirm transaction to dispatch encrypted card credentials from Enclave.",
    safeguardAction: "Authorize Payment with FaceID (₹8,940)",
  },
  indigo: {
    key: "indigo",
    title: "IndiGo Flight 6E-204 Seat Selection",
    category: "AIRLINE PASSENGER CHECK-IN",
    url: "https://goindigo.in/web-checkin/6E204",
    statusBadge: "SEAT RESERVED",
    price: "₹350 (Seat 12B)",
    domNode: "#confirm-boarding-pass",
    steps: [
      { text: "Retrieved PNR: TGT902 from user itinerary", done: true },
      { text: "Selected Preferred Aisle Seat 12B (Extra Legroom)", done: true },
      { text: "Generate e-Boarding Pass & Apple Wallet pass", done: false, active: true },
    ],
    safeguardTitle: "Boarding Pass Generation Check",
    safeguardDesc:
      "Review selected seat 12B on flight 6E-204 (DEL to BOM) before final issuance.",
    safeguardAction: "Confirm Seat 12B & Issue Pass",
  },
  dinner: {
    key: "dinner",
    title: "Skyline Rooftop Lounge Table Reservation",
    category: "FINE DINING CONCIERGE",
    url: "https://eazydiner.com/restaurant/skyline-rooftop-delhi",
    statusBadge: "TABLE HELD",
    price: "Complimentary HOLD",
    domNode: "#table-hold-14",
    steps: [
      { text: "Checked Friday 8:00 PM availability for 2 guests", done: true },
      { text: "Held Window View Table #14 for 15 minutes", done: true },
      { text: "Ready to confirm contact details and OTP verification", done: false, active: true },
    ],
    safeguardTitle: "Concierge Reservation Confirm",
    safeguardDesc:
      "Table #14 held at Skyline Rooftop Lounge for tonight 8:00 PM. Confirm to finalize booking.",
    safeguardAction: "Confirm Reservation with VIP Concierge",
  },
};

export default function AutopilotTab({ onTakeOver, onApprovePayment }: AutopilotTabProps) {
  const [isRunning, setIsRunning] = useState(true);
  const [activeTaskKey, setActiveTaskKey] = useState<AutopilotTaskKey>("acko");

  const currentTask = TASKS[activeTaskKey];

  return (
    <div className="flex flex-col min-h-screen bg-obsidian-surface text-champagne-gold pb-28 pt-4 px-4 font-sans select-none">
      {/* Telemetry Header */}
      <header className="pb-3 border-b border-white/10 flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-status-success animate-ping" />
            <span className="font-editorial text-sm font-semibold tracking-wider text-champagne-gold">
              AUTOPILOT VIRTUAL BROWSER
            </span>
          </div>
          <p className="text-[10px] text-white/50 font-mono tracking-wider">
            SESSION #9021 • 18ms LATENCY • 60 FPS • ISOLATED CONTAINER
          </p>
        </div>

        <div className="flex items-center space-x-1.5">
          <button
            type="button"
            aria-label={isRunning ? "Pause autopilot session" : "Resume autopilot session"}
            onClick={() => setIsRunning(!isRunning)}
            className="p-1.5 rounded-lg bg-obsidian-container border border-white/10 text-white/70 hover:text-white"
          >
            {isRunning ? (
              <Pause className="w-4 h-4 text-status-warning" />
            ) : (
              <Play className="w-4 h-4 text-status-success" />
            )}
          </button>
          <span className="px-2 py-0.5 rounded-full bg-champagne-soft border border-champagne-accent/30 text-[9px] font-mono text-champagne-accent font-semibold">
            SECURE ENCLAVE
          </span>
        </div>
      </header>

      {/* Task Selector Switcher */}
      <div className="flex items-center space-x-2 py-3 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTaskKey("acko")}
          className={`px-3 py-1.5 rounded-xl text-xs font-mono flex items-center space-x-1.5 whitespace-nowrap transition-all border ${
            activeTaskKey === "acko"
              ? "bg-champagne-gold text-obsidian-lowest font-semibold border-champagne-gold shadow-goldGlow"
              : "bg-obsidian-low text-white/60 border-white/10 hover:border-champagne-accent/30"
          }`}
        >
          <Car className="w-3.5 h-3.5" />
          <span>Acko Renewal</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTaskKey("indigo")}
          className={`px-3 py-1.5 rounded-xl text-xs font-mono flex items-center space-x-1.5 whitespace-nowrap transition-all border ${
            activeTaskKey === "indigo"
              ? "bg-champagne-gold text-obsidian-lowest font-semibold border-champagne-gold shadow-goldGlow"
              : "bg-obsidian-low text-white/60 border-white/10 hover:border-champagne-accent/30"
          }`}
        >
          <Plane className="w-3.5 h-3.5" />
          <span>Flight 6E-204</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTaskKey("dinner")}
          className={`px-3 py-1.5 rounded-xl text-xs font-mono flex items-center space-x-1.5 whitespace-nowrap transition-all border ${
            activeTaskKey === "dinner"
              ? "bg-champagne-gold text-obsidian-lowest font-semibold border-champagne-gold shadow-goldGlow"
              : "bg-obsidian-low text-white/60 border-white/10 hover:border-champagne-accent/30"
          }`}
        >
          <Utensils className="w-3.5 h-3.5" />
          <span>Skyline Table</span>
        </button>
      </div>

      {/* Virtual Cloud Viewport */}
      <section className="mt-1 bg-obsidian-lowest border border-white/15 rounded-2xl overflow-hidden shadow-2xl relative">
        <div className="bg-obsidian-container px-3 py-2 border-b border-white/10 flex items-center justify-between text-[11px] font-mono text-white/60">
          <div className="flex items-center space-x-1.5 truncate">
            <span className="w-2 h-2 rounded-full bg-white/20" />
            <span className="text-white/40">https://</span>
            <span className="text-champagne-accent font-semibold truncate">
              {currentTask.url.replace("https://", "")}
            </span>
          </div>
          <span className="px-1.5 py-0.5 rounded bg-status-success/20 text-status-success text-[9px] font-semibold shrink-0">
            {isRunning ? "DOM LIVE" : "PAUSED"}
          </span>
        </div>

        {/* Viewport Content Simulation */}
        <div className="p-4 bg-gradient-to-b from-obsidian-low to-obsidian-container/80 text-white relative min-h-[200px]">
          <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">
                {currentTask.category}
              </span>
              <h4 className="text-sm font-semibold text-champagne-gold">{currentTask.title}</h4>
            </div>
            <span className="text-xs font-mono font-semibold text-champagne-accent bg-champagne-soft px-2 py-0.5 rounded border border-champagne-accent/30 shrink-0">
              {currentTask.price}
            </span>
          </div>

          <div className="space-y-2 text-xs">
            {activeTaskKey === "acko" && (
              <>
                <div className="p-2 rounded-xl bg-obsidian-surface border border-white/10 relative">
                  <span className="text-[9px] font-mono text-white/40 block">VEHICLE REGISTRATION</span>
                  <span className="font-mono text-xs text-champagne-gold font-semibold">
                    DL-01-AB-1234 (Honda City 2021)
                  </span>
                  <span className="absolute right-2 top-2 w-2 h-2 rounded-full bg-status-success" />
                </div>
                <div className="p-2 rounded-xl bg-obsidian-surface border border-champagne-accent/40 relative shadow-goldGlow">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[9px] font-mono text-champagne-accent block">PROMO APPLIED</span>
                      <span className="font-mono text-xs text-white font-semibold">TGT_EXCLUSIVE</span>
                    </div>
                    <span className="text-[11px] font-mono font-semibold text-status-success">- ₹1,200</span>
                  </div>
                </div>
              </>
            )}

            {activeTaskKey === "indigo" && (
              <>
                <div className="p-2 rounded-xl bg-obsidian-surface border border-white/10 relative">
                  <span className="text-[9px] font-mono text-white/40 block">SECTOR & TIMING</span>
                  <span className="font-mono text-xs text-champagne-gold font-semibold">
                    DEL T3 (18:30) → BOM T2 (20:45)
                  </span>
                  <span className="absolute right-2 top-2 w-2 h-2 rounded-full bg-status-success" />
                </div>
                <div className="p-2 rounded-xl bg-obsidian-surface border border-champagne-accent/40 relative shadow-goldGlow">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[9px] font-mono text-champagne-accent block">SEAT MAP LOCK</span>
                      <span className="font-mono text-xs text-white font-semibold">Seat 12B (Aisle, Row 12)</span>
                    </div>
                    <span className="text-[11px] font-mono font-semibold text-status-success">Held</span>
                  </div>
                </div>
              </>
            )}

            {activeTaskKey === "dinner" && (
              <>
                <div className="p-2 rounded-xl bg-obsidian-surface border border-white/10 relative">
                  <span className="text-[9px] font-mono text-white/40 block">RESERVATION HOLD</span>
                  <span className="font-mono text-xs text-champagne-gold font-semibold">
                    Table #14 • Window Skyline View • 2 Guests
                  </span>
                  <span className="absolute right-2 top-2 w-2 h-2 rounded-full bg-status-success" />
                </div>
                <div className="p-2 rounded-xl bg-obsidian-surface border border-champagne-accent/40 relative shadow-goldGlow">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[9px] font-mono text-champagne-accent block">DATE & TIME</span>
                      <span className="font-mono text-xs text-white font-semibold">Tonight, 8:00 PM IST</span>
                    </div>
                    <span className="text-[11px] font-mono font-semibold text-status-success">VIP Priority</span>
                  </div>
                </div>
              </>
            )}

            <div className="p-2 rounded-xl bg-obsidian-surface/60 border border-white/5 flex items-center justify-between text-white/60">
              <span className="text-[10px]">Vault Virtual Visa Infinite</span>
              <span className="font-mono text-[10px]">4111 •••• •••• 8921</span>
            </div>
          </div>

          {/* Highlight indicator */}
          <div className="mt-3 flex items-center justify-between text-[10px] text-white/40 font-mono">
            <span className="flex items-center space-x-1">
              <Cpu className="w-3 h-3 text-champagne-accent animate-spin" />
              <span>Autopilot interacting with DOM node {currentTask.domNode}</span>
            </span>
            <span className="text-champagne-accent">{currentTask.statusBadge}</span>
          </div>
        </div>
      </section>

      {/* Step Audit Log */}
      <section className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/70 mb-2">Step Audit Trail</h3>
        <div className="space-y-1.5 font-mono text-xs">
          {currentTask.steps.map((st, i) => (
            <div
              key={i}
              className={`flex items-center space-x-2 p-2 rounded-xl border ${
                st.active
                  ? "bg-champagne-soft border-champagne-accent/30 text-champagne-accent"
                  : "bg-obsidian-low border-white/5 text-white/70"
              }`}
            >
              {st.active ? (
                <RefreshCw className="w-3.5 h-3.5 text-champagne-accent animate-spin shrink-0" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-status-success shrink-0" />
              )}
              <span className={`text-[11px] ${st.active ? "font-semibold" : ""}`}>{st.text}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Human-in-the-Loop Safeguard */}
      <section className="mt-5 p-4 rounded-2xl bg-gradient-to-tr from-obsidian-lowest to-obsidian-container border border-champagne-accent/40 shadow-xl">
        <div className="flex items-center space-x-2 mb-2">
          <ShieldAlert className="w-4 h-4 text-champagne-accent" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-champagne-gold">
            {currentTask.safeguardTitle}
          </h3>
        </div>
        <p className="text-xs text-white/70 leading-relaxed mb-3">{currentTask.safeguardDesc}</p>

        <div className="flex flex-col space-y-2">
          <button
            type="button"
            onClick={onApprovePayment}
            className="w-full py-3 rounded-full bg-champagne-gold hover:bg-white text-obsidian-lowest font-semibold text-xs transition-all shadow-goldGlow flex items-center justify-center space-x-2"
          >
            <ScanFace className="w-4 h-4 text-obsidian-lowest" />
            <span>{currentTask.safeguardAction}</span>
          </button>

          <button
            type="button"
            onClick={onTakeOver}
            className="w-full py-2.5 rounded-full bg-obsidian-container border border-white/15 hover:border-champagne-accent/40 text-white/80 hover:text-champagne-gold font-medium text-xs transition-all flex items-center justify-center space-x-1.5"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Take Over Virtual Browser</span>
          </button>
        </div>
      </section>
    </div>
  );
}
