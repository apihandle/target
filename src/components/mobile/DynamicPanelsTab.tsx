"use client";

import React, { useState } from "react";
import {
  Sparkles,
  Layers,
  Check,
  Plus,
  Package,
  DollarSign,
  Plane,
  Trash2,
  RefreshCw,
  Coins,
  TrendingUp,
} from "lucide-react";

interface SynthesizedPanel {
  id: string;
  title: string;
  category: string;
  sourceApi: string;
  items: Array<{
    badge: string;
    badgeColor?: string;
    headline: string;
    subline: string;
    rightPrimary: string;
    rightSecondary: string;
  }>;
}

const DEFAULT_PANELS: SynthesizedPanel[] = [
  {
    id: "sentinel-fx",
    title: "INR / USD Live Sentinel",
    category: "FX MARKET WATCH",
    sourceApi: "RBI FX Daily + Bloomberg Feed",
    items: [
      {
        badge: "SPOT RATE",
        headline: "USD/INR Interbank",
        subline: "Threshold: Alert at ₹84.50",
        rightPrimary: "₹84.38",
        rightSecondary: "+0.12%",
      },
    ],
  },
  {
    id: "sentinel-flight",
    title: "Flight Radar Sentinel (DEL → LHR)",
    category: "AVIATION RADAR",
    sourceApi: "FlightAware API + ADS-B Live",
    items: [
      {
        badge: "ON RADAR",
        headline: "Virgin Atlantic VS-301",
        subline: "Altitude: 36,000 ft • Speed: 510 kts",
        rightPrimary: "Delayed 20m",
        rightSecondary: "ETA 19:40 GMT",
      },
    ],
  },
];

export default function DynamicPanelsTab() {
  const [prompt, setPrompt] = useState("Track my international parcels from DHL & FedEx in INR");
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [deployed, setDeployed] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [activePanels, setActivePanels] = useState<SynthesizedPanel[]>(DEFAULT_PANELS);

  const [currentPreview, setCurrentPreview] = useState<SynthesizedPanel>({
    id: "preview-courier",
    title: "Cross-Border Courier Tracker (INR)",
    category: "COURIER & LOGISTICS",
    sourceApi: "DHL Express API + FedEx v3 + RBI FX Rates",
    items: [
      {
        badge: "In Transit",
        headline: "DHL #84910283",
        subline: "Frankfurt Hub → Customs Clearance New Delhi",
        rightPrimary: "₹4,280",
        rightSecondary: "Customs Duty",
      },
      {
        badge: "Out for Delivery",
        headline: "FedEx #39108412",
        subline: "Gurugram Sort Facility • Courier On Route",
        rightPrimary: "Paid",
        rightSecondary: "No Dues",
      },
    ],
  });

  const handleSynthesize = () => {
    if (!prompt.trim() || isSynthesizing) return;
    setIsSynthesizing(true);
    setDeployed(false);

    setTimeout(() => {
      const lower = prompt.toLowerCase();
      let generated: SynthesizedPanel;

      if (lower.includes("gold") || lower.includes("mumbai") || lower.includes("silver")) {
        generated = {
          id: `panel-${Date.now()}`,
          title: "Mumbai 24K Gold & Bullion Sentinel",
          category: "COMMODITIES & BULLION",
          sourceApi: "IBJA Gold Spot Index + MCX Realtime",
          items: [
            {
              badge: "24K PURE",
              headline: "Gold 999 (10g)",
              subline: "Zaveri Bazaar Cash Spot • GST 3% incl.",
              rightPrimary: "₹79,450",
              rightSecondary: "+₹320 today",
            },
            {
              badge: "SILVER 999",
              headline: "Silver 1kg Bar",
              subline: "MCX Futures Settlement Dec 2026",
              rightPrimary: "₹92,800",
              rightSecondary: "+0.45%",
            },
          ],
        };
      } else if (lower.includes("flight") || lower.includes("indigo") || lower.includes("airport")) {
        generated = {
          id: `panel-${Date.now()}`,
          title: "IndiGo 6E-204 Live Gate & Baggage Tracker",
          category: "AIRPORT & FLIGHT CONCIERGE",
          sourceApi: "DIAL Airport System + IndiGo Live API",
          items: [
            {
              badge: "GATE 42B",
              headline: "IndiGo 6E-204 (DEL → BOM)",
              subline: "Boarding at 17:50 IST • Aisle Seat 12B",
              rightPrimary: "On Time",
              rightSecondary: "Belt #4 at BOM",
            },
          ],
        };
      } else if (lower.includes("crypto") || lower.includes("bitcoin") || lower.includes("btc")) {
        generated = {
          id: `panel-${Date.now()}`,
          title: "Cold Vault Crypto Sentinel",
          category: "DECENTRALIZED ASSETS",
          sourceApi: "Coinbase Prime + Binance Oracle",
          items: [
            {
              badge: "SECURE ENCLAVE",
              headline: "Bitcoin (BTC)",
              subline: "Hardware Multi-Sig Vault Balance: 1.45 BTC",
              rightPrimary: "$94,150",
              rightSecondary: "+2.8%",
            },
          ],
        };
      } else {
        generated = {
          id: `panel-${Date.now()}`,
          title: prompt.slice(0, 36) || "Custom Synthesized Sentinel",
          category: "CUSTOM USER INTENT",
          sourceApi: "Synthesized Schema • Webhook Worker",
          items: [
            {
              badge: "ACTIVE",
              headline: prompt,
              subline: "Real-time parameters monitored via Vault Enclave",
              rightPrimary: "Optimal",
              rightSecondary: "Synced",
            },
          ],
        };
      }

      setCurrentPreview(generated);
      setIsSynthesizing(false);
    }, 700);
  };

  const handleDeploy = () => {
    if (deployed) return;
    setDeployed(true);
    setActivePanels((prev) => [currentPreview, ...prev.filter((p) => p.id !== currentPreview.id)]);
  };

  const handleDelete = (id: string) => {
    setActivePanels((prev) => prev.filter((p) => p.id !== id));
  };

  const handleRefresh = (id: string) => {
    setRefreshingId(id);
    setTimeout(() => {
      setRefreshingId(null);
    }, 600);
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
        <div className="p-3 rounded-2xl bg-obsidian-lowest border border-champagne-accent/30 shadow-lg relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            className="w-full bg-transparent border-none text-xs text-champagne-gold placeholder-white/30 focus:outline-none resize-none leading-relaxed"
            placeholder="e.g. Compare gold spot prices in Mumbai vs London with FX live alerts..."
          />
          {/* Quick Prompt Ideas */}
          <div className="flex flex-wrap gap-1.5 pt-1 pb-2">
            {[
              "Gold spot Mumbai",
              "IndiGo flight 6E-204",
              "Courier parcels DHL",
              "Cold Vault Bitcoin",
            ].map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => setPrompt(chip)}
                className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-obsidian-container border border-white/10 text-white/60 hover:text-champagne-accent transition-colors"
              >
                {chip}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <span className="text-[10px] text-white/40 font-mono">Schemas & Connectors validated</span>
            <button
              type="button"
              onClick={handleSynthesize}
              disabled={isSynthesizing || !prompt.trim()}
              className="px-3.5 py-1.5 rounded-full bg-champagne-gold hover:bg-white text-obsidian-lowest text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-goldGlow disabled:opacity-50"
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
              <h4 className="text-xs font-semibold text-champagne-gold">{currentPreview.title}</h4>
            </div>
            <span className="text-[9px] font-mono text-white/40">Auto-refresh 5m</span>
          </div>

          <div className="space-y-2.5">
            {currentPreview.items.map((item, idx) => (
              <div
                key={idx}
                className="p-2.5 rounded-xl bg-obsidian-surface border border-white/10 flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center space-x-1.5">
                    <span className="text-[10px] font-mono font-semibold text-champagne-accent">
                      {item.headline}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-status-success/20 text-status-success font-mono">
                      {item.badge}
                    </span>
                  </div>
                  <p className="text-[11px] text-white/80 mt-0.5">{item.subline}</p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-mono font-semibold text-champagne-gold">
                    {item.rightPrimary}
                  </span>
                  <span className="text-[9px] text-white/40 block font-mono">
                    {item.rightSecondary}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
            <span className="text-[10px] text-white/50 font-mono truncate max-w-[200px]">
              API: {currentPreview.sourceApi}
            </span>
            <button
              type="button"
              onClick={handleDeploy}
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
      <section className="mt-6">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/70 mb-2.5">
          Active Custom Synthesized Panels ({activePanels.length})
        </h3>
        <div className="space-y-2.5">
          {activePanels.map((p) => {
            const isRefreshing = refreshingId === p.id;
            return (
              <div
                key={p.id}
                className="p-3.5 rounded-xl bg-obsidian-low border border-white/10 hover:border-champagne-accent/30 transition-all flex flex-col justify-between"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    {p.id.includes("fx") && <DollarSign className="w-3.5 h-3.5 text-champagne-accent" />}
                    {p.id.includes("flight") && <Plane className="w-3.5 h-3.5 text-champagne-accent" />}
                    {p.id.includes("gold") && <Coins className="w-3.5 h-3.5 text-champagne-accent" />}
                    {!p.id.includes("fx") && !p.id.includes("flight") && !p.id.includes("gold") && (
                      <TrendingUp className="w-3.5 h-3.5 text-champagne-accent" />
                    )}
                    <h5 className="text-[11px] font-semibold text-champagne-gold">{p.title}</h5>
                  </div>
                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      aria-label="Refresh panel"
                      onClick={() => handleRefresh(p.id)}
                      className="p-1 text-white/40 hover:text-champagne-accent transition-colors"
                    >
                      <RefreshCw className={`w-3 h-3 ${isRefreshing ? "animate-spin text-champagne-gold" : ""}`} />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete panel"
                      onClick={() => handleDelete(p.id)}
                      className="p-1 text-white/40 hover:text-status-danger transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {p.items.map((it, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px]">
                    <span className="text-white/60">{it.subline}</span>
                    <span className="font-mono font-semibold text-status-success">{it.rightPrimary}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
