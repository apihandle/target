"use client";

import React, { useState } from "react";
import { Sparkles, Layers, Box, Check, Plus, ExternalLink, ArrowRight, Package, DollarSign, Plane } from "lucide-react";

export default function DynamicPanelsTab() {
  const [prompt, setPrompt] = useState("Track my international parcels from DHL & FedEx in INR");
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [deployed, setDeployed] = useState(false);

  const handleSynthesize = () => {
    setIsSynthesizing(true);
    setTimeout(() => {
      setIsSynthesizing(false);
    }, 1000);
  };

  return (
    <div className="flex flex-col min-h-screen bg-obsidian-surface text-champagne-gold pb-28 pt-4 px-4 font-sans select-none">
      {/* Header */}
      <header className="pb-3 border-b border-white/10 flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <span className="font-editorial text-sm font-semibold tracking-wider text-champagne-gold">
              DYNAMIC PANELS SYNTHESIS
            </span>
          </div>
          <p className="text-[10px] text-white/50 font-mono tracking-wider">
            NATURAL LANGUAGE MICRO-APP GENERATOR • ZERO-CODE
          </p>
        </div>
        <span className="px-2 py-0.5 rounded-full bg-champagne-soft border border-champagne-accent/30 text-[9px] font-mono text-champagne-accent font-semibold">
          LIVE ENGINE
        </span>
      </header>

      {/* Synthesis Prompt Bar */}
      <section className="mt-4">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-white/70 block mb-1.5 flex items-center space-x-1">
          <Sparkles className="w-3.5 h-3.5 text-champagne-accent" />
          <span>Describe Intent for Instant Mini-App</span>
        </label>
        <div className="p-2 rounded-2xl bg-obsidian-lowest border border-champagne-accent/30 shadow-lg relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            className="w-full bg-transparent border-none text-xs text-champagne-gold placeholder-white/30 focus:outline-none resize-none"
            placeholder="e.g. Compare gold spot prices in Mumbai vs London with FX live alerts..."
          />
          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <span className="text-[10px] text-white/40 font-mono">Schemas & Connectors validated</span>
            <button
              onClick={handleSynthesize}
              disabled={isSynthesizing}
              className="px-3 py-1 rounded-full bg-champagne-gold hover:bg-white text-obsidian-lowest text-xs font-semibold flex items-center space-x-1 transition-all"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isSynthesizing ? "animate-spin" : ""}`} />
              <span>{isSynthesizing ? "Synthesizing..." : "Generate Panel"}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Interactive Sandbox Preview */}
      <section className="mt-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center space-x-1.5">
            <Layers className="w-3.5 h-3.5 text-champagne-accent" />
            <span>Generated Live Sandbox Preview</span>
          </h3>
          <span className="text-[10px] font-mono text-status-success flex items-center space-x-1">
            <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
            <span>Interactive Widget</span>
          </span>
        </div>

        {/* The Generated Mini-App Widget */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-obsidian-low to-obsidian-container border border-champagne-accent/40 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
            <div className="flex items-center space-x-2">
              <Package className="w-4 h-4 text-champagne-accent" />
              <h4 className="text-xs font-semibold text-champagne-gold">Cross-Border Courier Tracker (INR)</h4>
            </div>
            <span className="text-[9px] font-mono text-white/40">Auto-refresh 5m</span>
          </div>

          <div className="space-y-2.5">
            <div className="p-2.5 rounded-xl bg-obsidian-surface border border-white/10 flex items-center justify-between">
              <div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-[10px] font-mono font-semibold text-champagne-accent">DHL #84910283</span>
                  <span className="text-[9px] px-1 rounded bg-status-success/20 text-status-success font-mono">In Transit</span>
                </div>
                <p className="text-[11px] text-white/80 mt-0.5">Frankfurt Hub → Customs Clearance New Delhi</p>
              </div>
              <div className="text-right">
                <span className="text-xs font-mono font-semibold text-champagne-gold">₹4,280</span>
                <span className="text-[9px] text-white/40 block font-mono">Customs Duty</span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-obsidian-surface border border-white/10 flex items-center justify-between">
              <div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-[10px] font-mono font-semibold text-champagne-accent">FedEx #39108412</span>
                  <span className="text-[9px] px-1 rounded bg-status-info/20 text-status-info font-mono">Out for Delivery</span>
                </div>
                <p className="text-[11px] text-white/80 mt-0.5">Gurugram Sort Facility • Courier On Route</p>
              </div>
              <div className="text-right">
                <span className="text-xs font-mono font-semibold text-status-success">Paid</span>
                <span className="text-[9px] text-white/40 block font-mono">No Dues</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
            <span className="text-[10px] text-white/50 font-mono">API: DHL Express API + FedEx v3 + RBI FX Rates</span>
            <button
              onClick={() => setDeployed(true)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center space-x-1.5 ${
                deployed
                  ? "bg-status-success text-obsidian-lowest"
                  : "bg-champagne-gold hover:bg-white text-obsidian-lowest shadow-goldGlow"
              }`}
            >
              {deployed ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              <span>{deployed ? "Deployed to Hub" : "Deploy Live Panel"}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Preset Micro-Apps Section */}
      <section className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/70 mb-2.5">
          Active Custom Synthesized Panels
        </h3>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="p-3 rounded-xl bg-obsidian-low border border-white/10 hover:border-champagne-accent/30 transition-all">
            <div className="flex items-center space-x-1.5 mb-1 text-champagne-accent">
              <DollarSign className="w-3.5 h-3.5" />
              <h5 className="text-[11px] font-semibold text-champagne-gold">INR / USD Live Sentinel</h5>
            </div>
            <p className="text-[10px] text-white/50">Alerts when rate crosses ₹84.50</p>
            <span className="text-xs font-mono font-semibold text-status-success mt-2 block">₹84.38 (+0.12%)</span>
          </div>

          <div className="p-3 rounded-xl bg-obsidian-low border border-white/10 hover:border-champagne-accent/30 transition-all">
            <div className="flex items-center space-x-1.5 mb-1 text-champagne-accent">
              <Plane className="w-3.5 h-3.5" />
              <h5 className="text-[11px] font-semibold text-champagne-gold">Flight Radar AI</h5>
            </div>
            <p className="text-[10px] text-white/50">DEL → LHR Virgin Atlantic 301</p>
            <span className="text-xs font-mono font-semibold text-status-warning mt-2 block">Delayed 20m</span>
          </div>
        </div>
      </section>
    </div>
  );
}