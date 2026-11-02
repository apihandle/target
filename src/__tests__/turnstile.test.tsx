import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Turnstile from "@/components/Turnstile";

describe("Turnstile bot check", () => {
  it("renders nothing without a site key", () => {
    const { container } = render(<Turnstile onToken={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
  it("renders a box and loads Cloudflare's script with a site key", () => {
    render(<Turnstile siteKey="1x00000000000000000000AA" onToken={() => {}} />);
    expect(screen.getByTestId("turnstile")).toBeInTheDocument();
    expect(document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')).not.toBeNull();
  });
});
