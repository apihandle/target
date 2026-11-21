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
  BLOGGER_OAUTH_CLIENT_ID: "i", BLOGGER_OAUTH_CLIENT_SECRET: "j",
  META_APP_ID: "k", META_APP_SECRET: "l",
  CANVA_OAUTH_CLIENT_ID: "m", CANVA_OAUTH_CLIENT_SECRET: "n",
  FIGMA_OAUTH_CLIENT_ID: "o", FIGMA_OAUTH_CLIENT_SECRET: "p",
  NOTION_OAUTH_CLIENT_ID: "q", NOTION_OAUTH_CLIENT_SECRET: "r",
  SLACK_OAUTH_CLIENT_ID: "s", SLACK_OAUTH_CLIENT_SECRET: "t",
  YOUTUBE_OAUTH_CLIENT_ID: "u", YOUTUBE_OAUTH_CLIENT_SECRET: "v",
};
const shownViews = (env: Record<string, string> = ENV, conns = []) => SHOWN_CONNECTORS.map((id) => connectorViews(env, conns).find((v) => v.id === id)!);
const card = (id: string) => screen.getAllByTestId("connector-card").find((c) => c.getAttribute("data-id") === id)!;

describe("Connectors page: OAuth connectors, no token inputs", () => {
  it("lists all twelve connectors in order: GitHub, Google, Supabase, Vercel, Blogger, Facebook, Instagram, YouTube, Canva, Figma, Notion, Slack", () => {
    expect([...SHOWN_CONNECTORS]).toEqual(["github", "google", "supabase", "vercel", "blogger", "facebook", "instagram", "youtube", "canva", "figma", "notion", "slack"]);
    for (const id of SHOWN_CONNECTORS) expect(getConnector(id)?.auth).toBe(id === "figma" ? "api_key" : "oauth");
    render(<ConnectorsGrid initial={shownViews()} />);
    expect(screen.getAllByTestId("connector-card").map((c) => c.getAttribute("data-id"))).toEqual(["github", "google", "supabase", "vercel", "blogger", "facebook", "instagram", "youtube", "canva", "figma", "notion", "slack"]);
    expect(screen.queryByText("Figma")).not.toBeNull();
  });

  it.each(["canva", "figma", "notion", "slack", "youtube"])("%s: Connect is a link to the OAuth start route", (id) => {
    render(<ConnectorsGrid initial={shownViews()} returnTo="/app/chat" />);
    const a = card(id).querySelector('[data-testid="connector-oauth"]')!;
    expect(a).toHaveAttribute("href", `/api/connectors/${id}/connect?return=${encodeURIComponent("/app/chat")}`);
    expect(a).toHaveTextContent("Connect");
    expect(card(id).querySelector('[data-testid="connector-connect"]')).toBeNull();
    expect(card(id).querySelector('[data-testid="connector-key"]')).toBeNull();
  });

  it.each(["canva", "notion", "slack", "youtube"])("%s: OAuth only — the connector defines no token fallback", (id) => {
    expect(getConnector(id)!.apiKey).toBeUndefined();
  });

  it("figma: without OAuth app env vars the card still renders, offering its personal-access-token connect", () => {
    const env: Record<string, string> = { ...ENV };
    delete env.FIGMA_OAUTH_CLIENT_ID; delete env.FIGMA_OAUTH_CLIENT_SECRET;
    render(<ConnectorsGrid initial={shownViews(env)} />);
    expect(card("figma").querySelector('[data-testid="connector-oauth"]')).toBeNull();
    expect(card("figma").querySelector('[data-testid="connector-connect"]')).not.toBeNull();
    expect(getConnector("figma")!.apiKey).toBeDefined();
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
    expect(screen.getAllByTestId("connector-card").map((c) => c.getAttribute("data-id"))).toEqual(["github", "google", "blogger", "facebook", "instagram", "youtube", "canva", "figma", "notion", "slack"]);
  });

  it("without a new connector's OAuth app env vars its card is hidden too", () => {
    const env: Record<string, string> = { ...ENV };
    delete env.CANVA_OAUTH_CLIENT_SECRET; delete env.SLACK_OAUTH_CLIENT_ID;
    render(<ConnectorsGrid initial={shownViews(env)} />);
    expect(screen.getAllByTestId("connector-card").map((c) => c.getAttribute("data-id"))).toEqual(["github", "google", "supabase", "vercel", "blogger", "facebook", "instagram", "youtube", "figma", "notion"]);
  });

  it("a connected Supabase shows its account and Disconnect", () => {
    render(<ConnectorsGrid initial={shownViews(ENV, [{ connector_id: "supabase", status: "connected", scopes: [], account_label: "Acme org" }] as never)} />);
    expect(card("supabase").querySelector('[data-testid="connector-oauth"]')).toBeNull();
    expect(card("supabase").querySelector('[data-testid="connector-disconnect"]')).not.toBeNull();
    expect(card("supabase")).toHaveTextContent("Acme org");
  });
});
