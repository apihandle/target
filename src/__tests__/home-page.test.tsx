import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";
import { greeting } from "@/lib/greeting";
import { panelGlance } from "@/components/home/PanelTile";
import type { Panel } from "@/lib/panels";

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

const panel = (id: string, extra: Record<string, unknown>) => ({ id, user_id: U, title: `Panel ${id}`, config: {}, created_at: "2026-11-01T00:00:00Z", ...extra });

describe("Home", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("greets by first name and shows the Ask TARGET input that starts a chat", async () => {
    await renderHome();
    expect(screen.getByTestId("home-greeting").textContent).toMatch(/^Good (morning|afternoon|evening), Vikash$/);
    const form = screen.getByTestId("home-ask") as HTMLFormElement;
    expect(form.getAttribute("action")).toBe("/app");
    expect(form.getAttribute("method")).toBe("get");
    const input = within(form).getByPlaceholderText("Ask TARGET…") as HTMLInputElement;
    expect(input.name).toBe("q");
    expect((form.querySelector('input[name="send"]') as HTMLInputElement).value).toBe("1");
  });

  it("has no tasks, activity, subtitle or explanatory empty states", async () => {
    await renderHome({ tasks: [{ id: "t1", user_id: U, title: "Old task", status: "queued" }], activity_events: [{ id: "e1", user_id: U, title: "Something happened", created_at: "2026-11-01T00:00:00Z" }] });
    expect(screen.queryByText("Open tasks")).toBeNull();
    expect(screen.queryByText("Recent activity")).toBeNull();
    expect(screen.queryByText("Old task")).toBeNull();
    expect(screen.queryByText(/what needs you and what/i)).toBeNull();
    expect(screen.queryByText("Nothing waiting on you")).toBeNull();
    expect(screen.queryByText("No panels yet")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hides approvals when none are pending and shows a compact strip when they are", async () => {
    await renderHome({ approval_requests: [{ id: "a0", user_id: U, status: "executed", summary: "Done already", created_at: "2026-11-01T00:00:00Z" }] });
    expect(screen.queryByTestId("home-approvals")).toBeNull();

    document.body.innerHTML = "";
    await renderHome({ approval_requests: [
      { id: "a1", user_id: U, status: "pending", summary: "Send email to Asha", destination: "Gmail", created_at: "2026-11-01T00:00:00Z" },
      { id: "a2", user_id: U, status: "pending", summary: "Add calendar event", destination: "Calendar", created_at: "2026-11-01T00:00:00Z" },
    ] });
    const strip = screen.getByTestId("home-approvals");
    expect(within(strip).getByText("2 things need you")).toBeTruthy();
    expect(within(strip).getByText("Send email to Asha")).toBeTruthy();
  });

  it("shows only the + tile when there are no panels, and a tile per panel otherwise", async () => {
    await renderHome();
    expect(screen.queryAllByTestId("home-panel")).toHaveLength(0);
    expect(screen.getByTestId("home-add-panel").getAttribute("href")).toBe("/app/panels?new=1");
    expect(screen.getByText("Add a panel")).toBeTruthy();

    document.body.innerHTML = "";
    await renderHome({ panels: [panel("p1", { kind: "note", config: { text: "Buy milk" } }), panel("p2", { kind: "list", items: [{ id: "i1", text: "a", done: true }, { id: "i2", text: "b", done: false }] })] });
    expect(screen.getAllByTestId("home-panel")).toHaveLength(2);
    expect(screen.getByText("1/2")).toBeTruthy();
    expect(screen.getByTestId("home-add-panel")).toBeTruthy();
    expect(screen.queryByText("Add a panel")).toBeNull();
  });

  it("shows For you only when there are suggestions", async () => {
    await renderHome();
    expect(screen.queryByTestId("for-you")).toBeNull();
    document.body.innerHTML = "";
    await renderHome({ suggestions: [{ id: "s1", user_id: U, status: "open", kind: "bill", title: "Pay the electricity bill", detail: "", prompt: "Pay it", due_at: null, created_at: "2026-11-01T00:00:00Z" }] });
    expect(within(screen.getByTestId("for-you")).getByText("Pay the electricity bill")).toBeTruthy();
  });

  it("keeps the IST greeting logic and reads panels at a glance", () => {
    expect(greeting(new Date("2026-11-03T03:00:00Z"))).toBe("Good morning");   // 08:30 IST
    expect(greeting(new Date("2026-11-03T08:00:00Z"))).toBe("Good afternoon"); // 13:30 IST
    expect(greeting(new Date("2026-11-03T13:00:00Z"))).toBe("Good evening");   // 18:30 IST
    const p = (x: Partial<Panel>) => ({ id: "x", title: "t", config: {}, data: null, ...x }) as Panel;
    expect(panelGlance(p({ kind: "goal", config: { target: "10", unit: "km" }, items: [{ id: "g", amount: 4, note: "", date: "" }] }))).toMatchObject({ value: "40%", pct: 40, sub: "4 of 10 km" });
    expect(panelGlance(p({ kind: "weather" })).value).toBe("—");
    expect(panelGlance(p({ kind: "weather", data: { temp: 30.6, code: 0, place: "Patna" } }))).toMatchObject({ value: "31°", sub: "Clear · Patna" });
  });
});
