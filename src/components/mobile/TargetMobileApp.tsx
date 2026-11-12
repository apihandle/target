"use client";

import React, { useState } from "react";
import { MobileTab, ModalOverlay } from "./types";
import MobileTabBar from "./MobileTabBar";
import CommandHubTab from "./CommandHubTab";
import AutopilotTab from "./AutopilotTab";
import DynamicPanelsTab from "./DynamicPanelsTab";
import VaultTab from "./VaultTab";
import VoiceModeModal from "./VoiceModeModal";
import VisionModeModal from "./VisionModeModal";
import AutopilotTakeoverModal from "./AutopilotTakeoverModal";

export default function TargetMobileApp() {
  const [activeTab, setActiveTab] = useState<MobileTab>("thread");
  const [activeOverlay, setActiveOverlay] = useState<ModalOverlay>(null);

  const handleAskAboutDoc = (docSummary: string) => {
    setActiveTab("thread");
    // Switch to thread and show message
  };

  return (
    <div className="min-h-screen bg-obsidian-surface text-champagne-gold font-sans antialiased overflow-x-hidden">
      {/* Active Tab Screen */}
      <main className="max-w-md mx-auto min-h-screen relative shadow-2xl">
        {activeTab === "thread" && (
          <CommandHubTab
            onOpenVoice={() => setActiveOverlay("voice")}
            onOpenVision={() => setActiveOverlay("vision")}
            onOpenAutopilot={() => setActiveTab("autopilot")}
          />
        )}

        {activeTab === "autopilot" && (
          <AutopilotTab
            onTakeOver={() => setActiveOverlay("takeover")}
            onApprovePayment={() => setActiveOverlay("takeover")}
          />
        )}

        {activeTab === "panels" && <DynamicPanelsTab />}

        {activeTab === "vault" && <VaultTab />}

        {/* Bottom Tab Bar */}
        <MobileTabBar activeTab={activeTab} onTabChange={setActiveTab} />
      </main>

      {/* Modal Overlays */}
      {activeOverlay === "voice" && (
        <VoiceModeModal onClose={() => setActiveOverlay(null)} />
      )}

      {activeOverlay === "vision" && (
        <VisionModeModal
          onClose={() => setActiveOverlay(null)}
          onAskAboutDoc={handleAskAboutDoc}
        />
      )}

      {activeOverlay === "takeover" && (
        <AutopilotTakeoverModal
          onClose={() => setActiveOverlay(null)}
          onFinishSuccess={() => {
            setActiveTab("thread");
          }}
        />
      )}
    </div>
  );
}