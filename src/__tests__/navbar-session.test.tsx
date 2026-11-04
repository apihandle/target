import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

let session: object | null = null;
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  }),
}));

import Navbar from "@/components/Navbar";
import FinalCta from "@/components/FinalCta";

beforeEach(() => { cleanup(); session = null; });

describe("landing when already signed in", () => {
  it("signed out: shows Log in and Sign up", async () => {
    render(<Navbar />);
    expect(screen.getByTestId("nav-signup")).toHaveTextContent("Sign up");
    expect(screen.queryByTestId("nav-open-app")).toBeNull();
  });
  it("signed in: shows Open app instead of Sign up / Log in / Get started", async () => {
    session = { user: { id: "u" } };
    render(<Navbar />);
    await waitFor(() => expect(screen.getByTestId("nav-open-app")).toHaveAttribute("href", "/app/home"));
    expect(screen.queryByTestId("nav-signup")).toBeNull();
    expect(screen.queryByTestId("nav-login")).toBeNull();
    expect(screen.queryByText("Get started")).toBeNull();
  });
  it("signed in: closing CTA opens the app", async () => {
    session = { user: { id: "u" } };
    render(<FinalCta />);
    await waitFor(() => expect(screen.getByTestId("cta-signup")).toHaveTextContent("Open app"));
    expect(screen.getByTestId("cta-signup")).toHaveAttribute("href", "/app/home");
  });
});
