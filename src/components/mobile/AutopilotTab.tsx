"use client";

import React, { useState } from "react";
import { ShieldAlert, Play, Pause, CheckCircle2, ScanFace, ExternalLink, Cpu, RefreshCw, KeyRound } from "lucide-react";

interface AutopilotTabProps {
  onTakeOver: () => void;
  onApprovePayment: () => void;
}

export default function AutopilotTab({ onTakeOver, onApprovePayment }: AutopilotTabProps) {
  const [isRunning, setIsRunning] = useState(true);

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
            onClick={() => setIsRunning(!isRunning)}
            className="p-1.5 rounded-lg bg-obsidian-container border border-white/10 text-white/70 hover:text-white"
          >
            {isRunning ? <Pause className="w-4 h-4 text-status-warning" /> : <Play className="w-4 h-4 text-status-success" />}
          </button>
          <span className="px-2 py-0.5 rounded-full bg-champagne-soft border border-champagne-accent/30 text-[9px] font-mono text-champagne-accent font-semibold">
            SECURE ENCLAVE
          </span>
        </div>
      </header>

      {/* Virtual Cloud Viewport */}
      <section className="mt-4 bg-obsidian-lowest border border-white/15 rounded-2xl overflow-hidden shadow-2xl relative">
        <div className="bg-obsidian-container px-3 py-2 border-b border-white/10 flex items-center justify-between text-[11px] font-mono text-white/60">
          <div className="flex items-center space-x-1.5 truncate">
            <span className="w-2 h-2 rounded-full bg-white/20" />
            <span className="text-white/40">https://</span>
            <span className="text-champagne-accent font-semibold">acko.com</span>
            <span className="text-white/40">/checkout/comprehensive-renew</span>
          </div>
          <span className="px-1.5 py-0.5 rounded bg-status-success/20 text-status-success text-[9px] font-semibold">
            DOM LIVE
          </span>
        </div>

        {/* Viewport Content Simulation */}
        <div className="p-4 bg-gradient-to-b from-obsidian-low to-obsidian-container/80 text-white relative min-h-[220px]">
          <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">Vehicle Insurance</span>
              <h4 className="text-sm font-semibold text-champagne-gold">Acko Drive Secure Plus (Comprehensive)</h4>
            </div>
            <span className="text-xs font-mono font-semibold text-champagne-accent bg-champagne-soft px-2 py-0.5 rounded border border-champagne-accent/30">
              ₹8,940
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="p-2 rounded-xl bg-obsidian-surface border border-white/10 relative">
              <span className="text-[9px] font-mono text-white/40 block">VEHICLE REGISTRATION</span>
              <span className="font-mono text-xs text-champagne-gold font-semibold">DL-01-AB-1234 (Honda City 2021)</span>
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

            <div className="p-2 rounded-xl bg-obsidian-surface/60 border border-white/5 flex items-center justify-between text-white/60">
              <span className="text-[10px]">Vault Virtual Visa Infinite</span>
              <span className="font-mono text-[10px]">4111 •••• •••• 8921</span>
            </div>
          </div>

          {/* Highlight indicator */}
          <div className="mt-3 flex items-center justify-between text-[10px] text-white/40 font-mono">
            <span className="flex items-center space-x-1">
              <Cpu className="w-3 h-3 text-champagne-accent animate-spin" />
              <span>Autopilot interacting with DOM node #card-pay-btn</span>
            </span>
            <span className="text-champagne-accent">Ready for Biometric</span>
          </div>
        </div>
      </section>

      {/* Step Audit Log */}
      <section className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/70 mb-2">Step Audit Trail</h3>
        <div className="space-y-1.5 font-mono text-xs">
          <div className="flex items-center space-x-2 p-2 rounded-xl bg-obsidian-low border border-white/5 text-white/70">
            <CheckCircle2 className="w-3.5 h-3.5 text-status-success shrink-0" />
            <span className="text-[11px]">Filled vehicle registration (DL-01-AB-1234)</span>
          </div>
          <div className="flex items-center space-x-2 p-2 rounded-xl bg-obsidian-low border border-white/5 text-white/70">
            <CheckCircle2 className="w-3.5 h-3.5 text-status-success shrink-0" />
            <span className="text-[11px]">Applied promo coupon TGT_EXCLUSIVE (Saved ₹1,200)</span>
          </div>
          <div className="flex items-center space-x-2 p-2 rounded-xl bg-champagne-soft border border-champagne-accent/30 text-champagne-accent">
            <RefreshCw className="w-3.5 h-3.5 text-champagne-accent animate-spin shrink-0" />
            <span className="text-[11px] font-semibold">Payment gate reached: ₹8,940 awaiting user confirmation</span>
          </div>
        </div>
      </section>

      {/* Human-in-the-Loop Safeguard */}
      <section className="mt-5 p-4 rounded-2xl bg-gradient-to-tr from-obsidian-lowest to-obsidian-container border border-champagne-accent/40 shadow-xl">
        <div className="flex items-center space-x-2 mb-2">
          <ShieldAlert className="w-4 h-4 text-champagne-accent" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-champagne-gold">
            Human-in-the-Loop Safeguard
          </h3>
        </div>
        <p className="text-xs text-white/70 leading-relaxed mb-3">
          Autopilot has prepared the checkout. Confirm transaction to dispatch encrypted card credentials from Enclave.
        </p>

        <div className="flex flex-col space-y-2">
          <button
            onClick={onApprovePayment}
            className="w-full py-3 rounded-full bg-champagne-gold hover:bg-white text-obsidian-lowest font-semibold text-xs transition-all shadow-goldGlow flex items-center justify-center space-x-2"
          >
            <ScanFace className="w-4 h-4 text-obsidian-lowest" />
            <span>Authorize Payment with FaceID (₹8,940)</span>
          </button>

          <button
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