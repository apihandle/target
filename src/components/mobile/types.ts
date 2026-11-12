export type MobileTab = "thread" | "autopilot" | "panels" | "vault";

export type ModalOverlay = null | "voice" | "vision" | "takeover" | "receipt";

export interface BriefingItem {
  id: string;
  title: string;
  subtitle: string;
  category: "urgent" | "action" | "insight";
  amount?: string;
  actionText: string;
}

export interface ChatMessage {
  id: string;
  sender: "user" | "target";
  text: string;
  timestamp: string;
  card?: {
    title: string;
    description: string;
    status?: string;
    actionLabel?: string;
  };
}