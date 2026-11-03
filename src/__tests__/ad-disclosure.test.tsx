import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import LegalPage from "@/components/LegalPage";
import PrivacyPage from "@/app/privacy/page";
import { AD_DISCLOSURE } from "@/components/AdDisclosure";

describe("ad disclosure on public pages", () => {
  it("the landing footer says plainly which ad network the site uses", () => {
    render(<Footer />);
    const line = screen.getByTestId("ad-disclosure");
    expect(line.textContent).toContain("This site shows ads from Monetag.");
    expect(within(line).getByRole("link", { name: "Learn more" }).getAttribute("href")).toBe("/privacy#advertising");
  });

  it("the footer has no placeholder, hidden or ad-shortener links", () => {
    const { container } = render(<Footer />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) {
      expect(h).not.toBe("#");
      expect(h).not.toBe("");
      expect(h).not.toMatch(/ouo\.io|uplcm\.com|bit\.ly|adf\.ly|linkvertise|shorte/i);
    }
  });

  it("the top navigation no longer links to a paid-to-watch-ads page", () => {
    const { container } = render(<Navbar />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/work");
  });

  it("legal pages carry the same disclosure line", () => {
    render(<LegalPage title="Terms" sections={[{ h: "A", p: "B" }]} />);
    expect(screen.getByTestId("ad-disclosure").textContent).toContain(AD_DISCLOSURE);
  });

  it("the privacy page has an Advertising section with the network, the /app rule and push opt-out", () => {
    const { container } = render(<PrivacyPage />);
    const section = container.querySelector("#advertising");
    expect(section).not.toBeNull();
    const text = section!.textContent ?? "";
    expect(text).toContain("Advertising");
    expect(text).toContain("Monetag");
    expect(text).toMatch(/never load inside the signed-in TARGET app/);
    expect(text).toMatch(/push notifications/i);
    expect(text).toMatch(/browser settings/i);
    expect(container.textContent).not.toMatch(/coins/i);
  });
});
