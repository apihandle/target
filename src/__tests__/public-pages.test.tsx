import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import PrivacyPage from "@/app/privacy/page";

describe("public pages", () => {
  it("the footer has no ad-network line and no placeholder or ad-shortener links", () => {
    const { container } = render(<Footer />);
    expect(container.textContent).not.toMatch(/Monetag/i);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) {
      expect(h).not.toBe("#");
      expect(h).not.toMatch(/ouo\.io|uplcm\.com|bit\.ly|adf\.ly|linkvertise|shorte/i);
    }
  });

  it("the top navigation does not link to a paid-to-watch-ads page", () => {
    const { container } = render(<Navbar />);
    expect(Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"))).not.toContain("/work");
  });

  it("privacy keeps a generic third-party ads line without naming the network", () => {
    const { container } = render(<PrivacyPage />);
    expect(container.textContent).not.toMatch(/Monetag/i);
    expect(container.querySelector("#advertising")?.textContent).toMatch(/third-party ads/);
  });
});
