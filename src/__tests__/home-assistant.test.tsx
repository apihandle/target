import { render, screen, within, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";
import { getTargetAndroid, notificationHeadline, oneLine } from "@/lib/targetAndroid";

const U = "user-1";
const state: { db: FakeDb } = { db: new FakeDb() };

vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  getSessionOrRedirect: async () => ({ supabase: state.db.as(U), user: { id: U, email: "u@x.test", user_metadata: { full_name: "Vikash Kushwaha" }, app_metadata: {} } }),
}));

const { default: HomePage } = await import("@/app/app/home/page");

async function renderHome(seed: Record<string, Record<string, unknown>[]> = {}) {
  state.db = new FakeDb(seed);
  render(await HomePage());
}

type Call = { method: string; args: unknown[] };
function fakeBridge(extra: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const rec = (method: string, result: unknown) => async (...args: unknown[]) => { calls.push({ method, args }); return result; };
  const bridge = {
    version: rec("version", { ok: true, version: "5", platform: "android" }),
    battery: rec("battery", { ok: true, level: 82, charging: true }),
    openApp: rec("openApp", { ok: true }),
    dial: rec("dial", { ok: true }),
    composeSms: rec("composeSms", { ok: true }),
    setAlarm: rec("setAlarm", { ok: true }),
    setTimer: rec("setTimer", { ok: true }),
    flashlight: rec("flashlight", { ok: true }),
    openUrl: rec("openUrl", { ok: true }),
    navigate: rec("navigate", { ok: true }),
    share: rec("share", { ok: true }),
    takePendingImage: rec("takePendingImage", { ok: true }),
    speak: rec("speak", { ok: true }),
    listen: rec("listen", { ok: true, started: true }),
    ...extra,
  };
  return { bridge, calls };
}

function installBridge(b: unknown) {
  (window as unknown as { TargetAndroid?: unknown }).TargetAndroid = b;
}

describe("targetAndroid helpers", () => {
  it("detects the bridge only when the core methods exist", () => {
    expect(getTargetAndroid({})).toBeNull();
    expect(getTargetAndroid({ TargetAndroid: { version: 1 } })).toBeNull();
    const b = { version: async () => ({ ok: true }), battery: async () => ({ ok: true }) };
    expect(getTargetAndroid({ TargetAndroid: b })).toBe(b);
  });

  it("writes notification headlines the way the card shows them", () => {
    expect(notificationHeadline({ total: 3, byApp: { WhatsApp: 3 } })).toBe("3 new WhatsApp messages");
    expect(notificationHeadline({ total: 1, byApp: { Gmail: 1 } })).toBe("1 new Gmail message");
    expect(notificationHeadline({ total: 5, byApp: { WhatsApp: 2, Gmail: 3 } })).toBe("5 new notifications");
    expect(notificationHeadline({ total: 0, byApp: {} })).toBe("No new notifications");
  });

  it("flattens a chat reply to one clean line", () => {
    expect(oneLine("**All set** — your `report` is ready.\n\nNext step soon.")).toBe("All set — your report is ready. Next step soon.");
    expect(oneLine("x".repeat(300)).length).toBe(140);
  });
});

describe("Home assistant sections", () => {
  beforeEach(() => { document.body.innerHTML = ""; window.localStorage.clear(); });
  afterEach(() => { installBridge(undefined); });

  it("shows the assistant card in a browser, with no phone-only parts", async () => {
    await renderHome();
    await waitFor(() => expect(screen.getByTestId("assistant-status").textContent).toContain("Ready"));
    const pills = within(screen.getByTestId("assistant-pills"));
    expect(pills.getByText("Online")).toBeTruthy();
    expect(pills.getByText("Mode: Normal")).toBeTruthy();
    expect(pills.queryByText(/Wake word/)).toBeNull();
    expect(pills.queryByText(/App lock/)).toBeNull();
    expect(screen.queryAllByTestId("phone-action")).toHaveLength(0);
    expect(screen.queryByTestId("home-today")).toBeNull();
    const sos = within(screen.getByTestId("home-safety")).getByTestId("sos-btn") as HTMLButtonElement;
    expect(sos.disabled).toBe(true);
    expect(screen.getByText("Coming soon")).toBeTruthy();

    fireEvent.click(pills.getByRole("button", { name: /toggle assistant mode/i }));
    expect(pills.getByText("Mode: Agent")).toBeTruthy();
    expect(window.localStorage.getItem("target-home-mode")).toBe("agent");
  });

  it("shows recent chats with the last reply, routines and today's reminder and event", async () => {
    await renderHome({
      conversations: [
        { id: "c1", user_id: U, title: "Older chat", updated_at: "2026-11-05T10:00:00Z" },
        { id: "c2", user_id: U, title: "Trip planning", updated_at: "2026-11-06T10:00:00Z" },
      ],
      messages: [
        { id: "m1", user_id: U, conversation_id: "c2", role: "user", content: "Plan it", created_at: "2026-11-06T09:00:00Z" },
        { id: "m2", user_id: U, conversation_id: "c2", role: "assistant", content: "**All set** — your report is ready.", created_at: "2026-11-06T09:05:00Z" },
      ],
      scheduled_jobs: [
        { id: "j1", user_id: U, status: "active", title: "Morning brief", prompt: "Give me my morning brief", next_run_at: "2999-01-01T07:00:00Z" },
        { id: "j2", user_id: U, status: "paused", title: "Paused one", prompt: "Do not show", next_run_at: "2999-01-01T07:00:00Z" },
      ],
      suggestions: [
        { id: "s1", user_id: U, status: "open", kind: "bill", title: "Pay the electricity bill", detail: "", prompt: "Pay it", due_at: "2999-01-02T09:00:00Z", created_at: "2026-11-01T00:00:00Z" },
        { id: "s2", user_id: U, status: "open", kind: "event", title: "Dentist appointment", detail: "", prompt: "Show it", due_at: "2999-01-03T09:00:00Z", created_at: "2026-11-01T00:00:00Z" },
        { id: "s3", user_id: U, status: "open", kind: "bill", title: "Old bill", detail: "", prompt: "Pay it", due_at: "2000-01-01T09:00:00Z", created_at: "2026-11-01T00:00:00Z" },
      ],
    });

    const chats = screen.getAllByTestId("home-recent-chat");
    expect(chats).toHaveLength(2);
    expect(chats[0].getAttribute("href")).toBe("/app?c=c2");
    expect(within(screen.getByTestId("home-recent-chats")).getByText("Trip planning")).toBeTruthy();
    expect(screen.getByTestId("assistant-reply").textContent).toContain("All set — your report is ready.");

    const routines = screen.getAllByTestId("home-routine");
    expect(routines).toHaveLength(1);
    expect(routines[0].textContent).toBe("Morning brief");
    expect(routines[0].getAttribute("href")).toBe(`/app?q=${encodeURIComponent("Give me my morning brief")}&send=1`);
    expect(screen.queryByText("Paused one")).toBeNull();

    expect(within(screen.getByTestId("today-reminder")).getByText("Pay the electricity bill")).toBeTruthy();
    expect(within(screen.getByTestId("today-event")).getByText("Dentist appointment")).toBeTruthy();
    expect(within(screen.getByTestId("home-today")).queryByText("Old bill")).toBeNull();
  });

  it("inside the app: phone chips, battery, blocked notifications and the native mic", async () => {
    const { bridge, calls } = fakeBridge();
    installBridge(bridge);
    await renderHome();

    const chips = await screen.findAllByTestId("phone-action");
    expect(chips.map((c) => c.getAttribute("data-kind"))).toEqual(["call", "whatsapp", "sms", "alarm", "timer", "camera", "flashlight", "music"]);

    await waitFor(() => expect(within(screen.getByTestId("today-phone")).getByText(/82%/)).toBeTruthy());
    expect(within(screen.getByTestId("today-phone")).getByText(/Charging/)).toBeTruthy();
    await screen.findByTestId("today-notifications-blocked");

    fireEvent.click(within(screen.getByTestId("today-notifications-blocked")).getByRole("button", { name: /allow access/i }));
    await waitFor(() => expect(calls.some((c) => c.method === "openApp" && c.args[0] === "settings")).toBe(true));

    fireEvent.click(chips.find((c) => c.getAttribute("data-kind") === "flashlight")!);
    await waitFor(() => expect(calls.some((c) => c.method === "flashlight" && c.args[0] === true)).toBe(true));

    fireEvent.click(screen.getByTestId("voice-btn-native"));
    await waitFor(() => expect(calls.some((c) => c.method === "listen")).toBe(true));
    await act(async () => {
      window.dispatchEvent(new CustomEvent("target-listen", { detail: { ok: true, text: "Set a timer for five minutes" } }));
    });
    expect(screen.getByTestId("assistant-heard").textContent).toContain("Set a timer for five minutes");
  });

  it("inside the app with full bridge data: notifications, alarm, wake word and app lock", async () => {
    const { bridge } = fakeBridge({
      notifications: async () => ({ ok: true, total: 3, byApp: { WhatsApp: 3 } }),
      doNotDisturb: async () => ({ ok: true, on: false }),
      nextAlarm: async () => ({ ok: true, time: "7:30 AM", label: "Gym", at: null }),
      wakeWordEnabled: async () => ({ ok: true, enabled: true }),
      appLockEnabled: async () => ({ ok: true, enabled: true }),
    });
    installBridge(bridge);
    await renderHome();

    await waitFor(() => expect(within(screen.getByTestId("today-notifications")).getByText("3 new WhatsApp messages")).toBeTruthy());
    expect(within(screen.getByTestId("today-alarm")).getByText("7:30 AM")).toBeTruthy();
    expect(within(screen.getByTestId("today-phone")).getByText(/Do Not Disturb off/)).toBeTruthy();
    const pills = within(screen.getByTestId("assistant-pills"));
    await waitFor(() => expect(pills.getByText("Wake word on")).toBeTruthy());
    expect(pills.getByText("App lock on")).toBeTruthy();
    await waitFor(() => expect(within(screen.getByTestId("home-safety")).getByText("App lock is on.")).toBeTruthy());
  });
});
