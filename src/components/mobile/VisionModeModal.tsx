"use client";

import React, { useState } from "react";
import { X, Camera, Zap, FileText, Sparkles, Check, Scan, Eye } from "lucide-react";

interface VisionModeModalProps {
  onClose: () => void;
  onAskAboutDoc: (text: string) => void;
}

export default function VisionModeModal({ onClose, onAskAboutDoc }: VisionModeModalProps) {
  const [flashOn, setFlashOn] = useState(false);
  const [captured, setCaptured] = useState(false);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col justify-between p-6 select-none animate-in fade-in duration-300">
      {/* Viewfinder Top Bar */}
      <div className="flex items-center justify-between z-20">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-status-success animate-ping" />
          <span className="text-[11px] font-mono tracking-wider text-champagne-accent font-semibold">
            SPATIAL OCR VISION • HUD ACTIVE
          </span>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setFlashOn(!flashOn)}
            className={`w-9 h-9 rounded-full border flex items-center justify-center transition-colors ${
              flashOn
                ? "bg-champagne-gold text-obsidian-lowest border-champagne-gold"
                : "bg-obsidian-container border-white/20 text-white/60"
            }`}
          >
            <Zap className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-obsidian-container border border-white/20 flex items-center justify-center text-white/60 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Center Camera Viewfinder with HUD Reticle */}
      <div className="relative my-auto flex items-center justify-center w-full max-w-sm mx-auto aspect-[3/4] rounded-3xl border border-white/20 overflow-hidden bg-gradient-to-b from-obsidian-low to-obsidian-lowest">
        {/* Corner Reticle Brackets */}
        <div className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-champagne-accent" />
        <div className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-champagne-accent" />
        <div className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-champagne-accent" />
        <div className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-champagne-accent" />

        {/* Central Targeting Reticle */}
        <div className="absolute w-16 h-16 border border-champagne-accent/30 rounded-full flex items-center justify-center animate-pulse">
          <div className="w-1.5 h-1.5 bg-champagne-accent rounded-full" />
        </div>

        {/* Document Auto-Bounding Box Simulation */}
        <div className="w-[82%] h-[60%] border-2 border-dashed border-status-success/80 rounded-xl p-3 bg-status-success/5 backdrop-blur-[2px] flex flex-col justify-between relative shadow-lg">
          <div className="flex items-center justify-between text-[9px] font-mono text-status-success bg-obsidian-lowest/90 px-2 py-0.5 rounded border border-status-success/30 w-fit">
            <Scan className="w-3 h-3 mr-1" />
            <span>DOCUMENT DETECTED (CONFIDENCE 99.4%)</span>
          </div>

          <div className="space-y-1 font-mono text-[10px] text-white/80 bg-obsidian-lowest/80 p-2 rounded-lg">
            <p className="text-champagne-gold font-semibold">Policy: Acko Drive Plus Comprehensive</p>
            <p className="text-white/60">IDV: ₹7,80,000 • Zero Dep • Engine Protect</p>
            <p className="text-status-warning">Expiry: 17 Nov 2026 • Premium: ₹8,940</p>
          </div>
        </div>

        {/* Floating Contextual Insight Bubble */}
        <div className="absolute bottom-6 left-4 right-4 bg-obsidian-lowest/95 backdrop-blur-xl border border-champagne-accent/40 rounded-2xl p-3 shadow-2xl">
          <div className="flex items-start space-x-2">
            <Sparkles className="w-4 h-4 text-champagne-accent shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-semibold text-champagne-gold">Acko Policy Clause Recognized</h4>
              <p className="text-[11px] text-white/70 mt-0.5 leading-snug">
                Identified expiry date and vehicle details. Autopilot can auto-renew with coupon TGT_EXCLUSIVE.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="flex flex-col items-center space-y-3 pb-4 z-20">
        <button
          onClick={() => {
            onAskAboutDoc("Acko Car Insurance Policy Document (Expiry Nov 17)");
            onClose();
          }}
          className="w-full max-w-sm py-3 rounded-full bg-champagne-gold hover:bg-white text-obsidian-lowest font-semibold text-xs transition-all shadow-goldGlow flex items-center justify-center space-x-2"
        >
          <Sparkles className="w-4 h-4" />
          <span>Ask TARGET to Analyze & Renew This</span>
        </button>
      </div>
    </div>
  );
}