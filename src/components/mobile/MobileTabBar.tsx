"use client";

import React from "react";
import { MobileTab } from "./types";
import { MessageSquare, Compass, LayoutGrid, Shield } from "lucide-react";

interface MobileTabBarProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
}

export default function MobileTabBar({ activeTab, onTabChange }: MobileTabBarProps) {
  const tabs: { id: MobileTab; label: string; icon: React.ElementType }[] = [
    { id: "thread", label: "One Thread", icon: MessageSquare },
    { id: "autopilot", label: "Autopilot", icon: Compass },
    { id: "panels", label: "Panels", icon: LayoutGrid },
    { id: "vault", label: "Vault", icon: Shield },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-obsidian-lowest/95 backdrop-blur-xl border-t border-white/10 px-4 py-2 safe-area-bottom">
      <div className="max-w-md mx-auto flex items-center justify-around">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all duration-200 relative ${
                isActive ? "text-champagne-gold" : "text-white/40 hover:text-white/70"
              }`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 transition-transform duration-200 ${isActive ? "scale-110" : ""}`} />
                {isActive && (
                  <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-champagne-accent shadow-[0_0_8px_#c5a059]" />
                )}
              </div>
              <span className={`text-[10px] mt-1 tracking-tight font-medium ${isActive ? "font-semibold" : ""}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}