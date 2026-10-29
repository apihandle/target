import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Home from "@/app/page";

describe("Feature 2: Sections + footer", () => {
  it("shows 5 feature cards", () => {
    render(<Home />);
    expect(screen.getAllByTestId("feature-card")).toHaveLength(5);
  });
  it("CTA and nav point to the right anchors", () => {
    render(<Home />);
    expect(screen.getByTestId("cta-signup")).toHaveAttribute("href", "#signup");
    expect(screen.getByText("Features").closest("a")).toHaveAttribute("href", "#features");
    expect(document.getElementById("features")).not.toBeNull();
    expect(document.getElementById("signup")).not.toBeNull();
  });
  it("footer has 4 columns and copyright", () => {
    render(<Home />);
    expect(document.querySelectorAll("footer h4")).toHaveLength(4);
    expect(screen.getByTestId("copyright")).toHaveTextContent(`TARGET © ${new Date().getFullYear()}`);
  });
});

import Privacy from "@/app/privacy/page";
import Terms from "@/app/terms/page";
import FooterL from "@/components/Footer";
describe("Legal pages", () => {
  it("footer links to /terms and /privacy, pages render", () => {
    render(<FooterL />);
    expect(screen.getByText("Terms of Service").closest("a")).toHaveAttribute("href", "/terms");
    expect(screen.getByText("Privacy Policy").closest("a")).toHaveAttribute("href", "/privacy");
    cleanup();
    render(<Privacy />);
    expect(screen.getByRole("heading", { name: "Privacy Policy" })).toBeInTheDocument();
    cleanup();
    render(<Terms />);
    expect(screen.getByRole("heading", { name: "Terms of Service" })).toBeInTheDocument();
  });
});
