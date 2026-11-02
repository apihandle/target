import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ConnectorsGrid from "@/components/ConnectorsGrid";
import { connectorViews, getConnector } from "@/lib/connectors/registry";
import { SHOWN_CONNECTORS } from "@/lib/connectors/shown";

const ENV = {
  CONNECTOR_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), SUPABASE_SERVICE_ROLE_KEY: "x",
  GITHUB_OAUTH_CLIENT_ID: "a", GITHUB_OAUTH_CLIENT_SECRET: "b", GOOGLE_OAUTH_CLIENT_ID: "c", GOOGLE_OAUTH_CLIENT_SECRET: "d",
  SUPABASE_OAUTH_CLIENT_ID: "e", SUPABASE_OAUTH_CLIENT_SECRET: "f",
  VERCEL_OAUTH_CLIENT_ID: "g", VERCEL_OAUTH_CLIENT_SECRET: "h", VERCEL_INTEGRATION_SLUG: "target",
};
const shownViews = (env: Record<string, string> = ENV, conns = []) => SHOWN_CONNECTORS.map((id) => connectorViews(env, conns).find((v) => v.id === id)!);
const card = (id: string) => screen.getAllByTestId("connector-card").find((c) => c.getAttribute("data-id") === id)!;

describe("Connectors page: four OAuth connectors, no token inputs", () => {
  it("lists GitHub, Google, Supabase, Vercel in that order; Figma is hidden", () => {
    expect([...SHOWN_CONNECTORS]).toEqual(["github", "google", "supabase", "vercel"]);
    for (const id of SHOWN_CONNECTORS) expect(getConnector(id)?.auth).toBe("oauth");
    render(<ConnectorsGrid initial={shownViews()} />);
    expect(screen.getAllByTestId("connector-card").map((c) => c.getAttribute("data-id"))).toEqual(["github", "google", "supabase", "vercel"]);
    expect(screen.queryByText("Figma")).toBeNull();
  });

  it.each(["supabase", "vercel"])("%s: Connect is a link to the OAuth start route; there is no token field", (id) => {
    render(<ConnectorsGrid initial={shownViews()} returnTo="/app/chat" />);
    const a = card(id).querySelector('[data-testid="connector-oauth"]')!;
    expect(a).toHaveAttribute("href", `/api/connectors/${id}/connect?return=${encodeURIComponent("/app/chat")}`);
    expect(a).toHaveTextContent("Connect");
    expect(card(id).querySelector('[data-testid="connector-connect"]')).toBeNull();
    expect(document.querySelector('[data-testid="connector-key"], input[type="password"]')).toBeNull();
    expect(getConnector(id)!.apiKey).toBeUndefined();
  });

  it("without the OAuth app env vars the row is hidden instead of asking for a token", () => {
    const env: Record<string, string> = { ...ENV };
    delete env.VERCEL_INTEGRATION_SLUG; delete env.SUPABASE_OAUTH_CLIENT_SECRET;
    render(<ConnectorsGrid initial={shownViews(env)} />);
    expect(screen.getAllByTestId("connector-card").map((c) => c.getAttribute("data-id"))).toEqual(["github", "google"]);
  });

  it("a connected Supabase shows its account and Disconnect", () => {
    render(<ConnectorsGrid initial={shownViews(ENV, [{ connector_id: "supabase", status: "connected", scopes: [], account_label: "Acme org" }] as never)} />);
    expect(card("supabase").querySelector('[data-testid="connector-oauth"]')).toBeNull();
    expect(card("supabase").querySelector('[data-testid="connector-disconnect"]')).not.toBeNull();
    expect(card("supabase")).toHaveTextContent("Acme org");
  });
});
