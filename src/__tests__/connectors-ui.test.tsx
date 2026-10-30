import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ConnectorsGrid from "@/components/ConnectorsGrid";
import TaskList from "@/components/TaskList";
import ActionButtons from "@/components/ActionButtons";
import { connectorViews } from "@/lib/connectors/registry";
import { sanitizeAction, splitActions } from "@/lib/actions";
import type { Task } from "@/lib/tasks";

const ENV = { CONNECTOR_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), SUPABASE_SERVICE_ROLE_KEY: "x", GITHUB_OAUTH_CLIENT_ID: "a", GITHUB_OAUTH_CLIENT_SECRET: "b" };
const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as Response;
afterEach(() => vi.unstubAllGlobals());

describe("Connectors page", () => {
  it("shows what the agent can do and explains permissions before connecting", () => {
    render(<ConnectorsGrid initial={connectorViews(ENV, [])} />);
    const card = screen.getAllByTestId("connector-card").find((c) => c.getAttribute("data-id") === "supabase")!;
    expect(card).toHaveTextContent("What the agent can do");
    expect(card).toHaveTextContent("Not connected");
    expect(screen.queryByTestId("connector-permissions")).toBeNull();
    fireEvent.click(card.querySelector('[data-testid="connector-connect"]')!);
    expect(screen.getByTestId("connector-permissions")).toHaveTextContent("Before you connect");
    expect(screen.getByTestId("connector-permissions")).toHaveTextContent("personal access token");
  });

  it("api-key connect posts the token to the server and never renders it", async () => {
    const f = vi.fn().mockResolvedValue(ok({ ok: true, accountLabel: "2 projects reachable" }));
    vi.stubGlobal("fetch", f);
    render(<ConnectorsGrid initial={connectorViews(ENV, [])} focus="supabase" />);
    fireEvent.change(screen.getByTestId("connector-key"), { target: { value: "sbp_secret_value_1234567890" } });
    fireEvent.click(screen.getByTestId("connector-save"));
    await waitFor(() => expect(f).toHaveBeenCalledWith("/api/connectors/supabase/connect", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(screen.getAllByTestId("connector-card").find((c) => c.getAttribute("data-id") === "supabase")).toHaveAttribute("data-status", "connected"));
    expect(document.body.innerHTML).not.toContain("sbp_secret_value_1234567890");
  });

  it("OAuth connectors link to the server connect route, carrying the return path", () => {
    render(<ConnectorsGrid initial={connectorViews(ENV, [])} focus="github" returnTo="/app?c=1&resume=2" />);
    expect(screen.getByTestId("connector-oauth")).toHaveAttribute("href", "/api/connectors/github/connect?return=%2Fapp%3Fc%3D1%26resume%3D2");
  });
});

describe("needs_connection in tasks and chat", () => {
  it("a paused task shows a Connect button that returns to its chat to resume", () => {
    const t: Task = { id: "t1", title: "Count users", notes: "", status: "needs_connection", progress: "Waiting for you to connect Supabase.", error: null, origin: "assistant", project_id: null, conversation_id: "c1", needs_connector: "supabase" };
    render(<TaskList initial={[t]} allowAdd={false} />);
    expect(screen.getByTestId("task-connect")).toHaveAttribute("href", `/app/connectors?connect=supabase&return=${encodeURIComponent("/app?c=c1&resume=t1")}`);
    expect(screen.getByText("Needs a connection")).toBeInTheDocument();
  });

  it("chat renders a Connect card from the server's connect action", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ connectors: [{ id: "supabase", name: "Supabase", status: "not_connected", capabilities: [] }] })));
    const { actions } = splitActions('Need access.\n\n```actions\n[{"type":"connect","connector":"supabase","taskId":"44444444-4444-4444-8444-444444444444"}]\n```');
    render(<ActionButtons actions={actions} />);
    await waitFor(() => expect(screen.getByTestId("connect-btn")).toHaveTextContent("Connect Supabase"));
    expect(screen.getByTestId("connect-btn").getAttribute("href")).toMatch(/^\/app\/connectors\?connect=supabase&return=/);
    expect(sanitizeAction({ type: "connect", connector: "../evil" })).toBeNull();
  });
});
