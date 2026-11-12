"use client";

import React, { useState, useEffect } from "react";
import { X, Mic, MicOff, Globe, PhoneOff, Radio, Sparkles } from "lucide-react";

interface VoiceModeModalProps {
  onClose: () => void;
}

export default function VoiceModeModal({ onClose }: VoiceModeModalProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [language, setLanguage] = useState<"HI" | "EN">("HI");
  const [pulseLevel, setPulseLevel] = useState(1);

  // Audio waveform pulse simulation
  useEffect(() => {
    const interval = setInterval(() => {
      setPulseLevel(0.85 + Math.random() * 0.35);
    }, 180);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-obsidian-surface/98 backdrop-blur-2xl flex flex-col justify-between p-6 select-none animate-in fade-in duration-300">
      {/* Top Nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-status-success animate-ping" />
          <span className="text-[11px] font-mono tracking-wider text-champagne-accent font-semibold">
            TLS 1.3 SECURE ACOUSTIC STREAM
          </span>
        </div>

        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-obsidian-container border border-white/10 flex items-center justify-center text-white/60 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Central Acoustic Orb Visualizer */}
      <div className="flex flex-col items-center justify-center my-auto relative">
        <div className="relative flex items-center justify-center">
          {/* Multi-tier pulsing luxury rings */}
          <div
            style={{ transform: `scale(${pulseLevel * 1.35})` }}
            className="absolute w-64 h-64 rounded-full border border-champagne-accent/20 blur-sm transition-transform duration-200 pointer-events-none"
          />
          <div
            style={{ transform: `scale(${pulseLevel * 1.15})` }}
            className="absolute w-52 h-52 rounded-full border border-champagne-accent/40 blur-xs transition-transform duration-200 pointer-events-none"
          />
          <div
            style={{ transform: `scale(${pulseLevel})` }}
            className="w-40 h-40 rounded-full bg-gradient-to-tr from-[#99793d] via-[#c5a059] to-[#e6e0d4] shadow-[0_0_50px_rgba(197,160,89,0.5)] flex items-center justify-center transition-transform duration-200"
          >
            <div className="w-28 h-28 rounded-full bg-obsidian-lowest/70 backdrop-blur-md border border-white/20 flex items-center justify-center">
              <Radio className="w-8 h-8 text-champagne-gold animate-pulse" />
            </div>
          </div>
        </div>

        <div className="mt-8 text-center">
          <h3 className="font-editorial text-lg text-champagne-gold tracking-wide">
            {isMuted ? "Acoustic Stream Muted" : "TARGET is listening..."}
          </h3>
          <p className="text-xs text-white/50 font-mono mt-1">
            {language === "HI" ? "Hinglish & Hindi Mode Active" : "English Mode Active"}
          </p>
        </div>

        {/* Live Multi-task Chips appearing as user speaks */}
        <div className="w-full max-w-sm mt-6 space-y-2">
          <div className="p-3 rounded-2xl bg-obsidian-low border border-champagne-accent/30 flex items-center justify-between shadow-lg">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-3.5 h-3.5 text-champagne-accent" />
              <span className="text-xs font-semibold text-champagne-gold">IndiGo 6E-204 Flight Hold</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-status-success/20 text-status-success">
              Confirmed
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-obsidian-low border border-white/10 flex items-center justify-between shadow-lg">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-3.5 h-3.5 text-champagne-accent" />
              <span className="text-xs font-semibold text-champagne-gold">Skyline Rooftop Dinner 8 PM</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-champagne-soft text-champagne-accent">
              2 Guests
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Dock Controls */}
      <div className="flex items-center justify-center space-x-6 pb-4">
        {/* Language Toggle */}
        <button
          onClick={() => setLanguage(language === "HI" ? "EN" : "HI")}
          className="flex flex-col items-center space-y-1 text-white/60 hover:text-champagne-gold"
        >
          <div className="w-12 h-12 rounded-full bg-obsidian-container border border-white/15 flex items-center justify-center">
            <Globe className="w-5 h-5 text-champagne-accent" />
          </div>
          <span className="text-[10px] font-mono">{language === "HI" ? "Hinglish" : "English"}</span>
        </button>

        {/* Mute Toggle */}
        <button
          onClick={() => setIsMuted(!isMuted)}
          className="flex flex-col items-center space-y-1 text-white/60 hover:text-champagne-gold"
        >
          <div
            className={`w-14 h-14 rounded-full border flex items-center justify-center transition-all ${
              isMuted
                ? "bg-status-danger/20 border-status-danger text-status-danger"
                : "bg-obsidian-container border-champagne-accent/40 text-champagne-gold shadow-goldGlow"
            }`}
          >
            {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
          </div>
          <span className="text-[10px] font-mono">{isMuted ? "Unmute" : "Mute"}</span>
        </button>

        {/* Hang Up Control */}
        <button
          onClick={onClose}
          className="flex flex-col items-center space-y-1 text-white/60 hover:text-white"
        >
          <div className="w-12 h-12 rounded-full bg-status-danger border border-white/20 flex items-center justify-center text-white shadow-lg">
            <PhoneOff className="w-5 h-5" />
          </div>
          <span className="text-[10px] font-mono">End Voice</span>
        </button>
      </div>
    </div>
  );
}