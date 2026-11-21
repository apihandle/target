import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GoogleButton from "@/components/GoogleButton";
import { detectInApp, isTargetApp } from "@/lib/browser";

// The TARGET app's WebView UA: a stock Android WebView UA ("; wv)") plus the marker
// MainActivity appends. detectInApp matches it as a generic in-app browser — which is why
// GoogleButton needs the isTargetApp exception, or sign-in gets diverted into Chrome and the
// session never comes back to the app.
const TARGET_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 TargetAndroid/0.1.14";
const INSTAGRAM_UA = "Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 Instagram 300.0";
const CHROME_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

function setUa(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}

function mockLocation() {
  const assign = vi.fn();
  const orig = window.location;
  const loc = { assign, href: orig.href, origin: orig.origin };
  Object.defineProperty(window, "location", { configurable: true, value: loc });
  return { assign, loc, restore: () => Object.defineProperty(window, "location", { configurable: true, value: orig }) };
}

afterEach(() => { setUa(CHROME_UA); });

describe("TARGET app WebView detection", () => {
  it("recognises the app's UA marker, and only that", () => {
    expect(isTargetApp(TARGET_UA)).toBe(true);
    expect(isTargetApp(INSTAGRAM_UA)).toBe(false);
    expect(isTargetApp(CHROME_UA)).toBe(false);
    // The app's WebView also matches the generic in-app rule — the exception is load-bearing.
    expect(detectInApp(TARGET_UA)?.android).toBe(true);
  });
});

describe("GoogleButton inside the TARGET app", () => {
  it("starts /auth/google (which the app shell intercepts) instead of diverting to Chrome", () => {
    setUa(TARGET_UA);
    const { assign, loc, restore } = mockLocation();
    render(<GoogleButton />);
    // No "sign-in doesn't work inside this app" warning: in TARGET's app it does work.
    expect(screen.queryByTestId("inapp-warning")).toBeNull();
    fireEvent.click(screen.getByTestId("google-btn"));
    expect(assign).toHaveBeenCalledWith("/auth/google?next=%2Fapp");
    expect(loc.href).not.toContain("intent://");
    restore();
  });
});

describe("GoogleButton in other in-app browsers (unchanged)", () => {
  it("still diverts an Android in-app browser to the real browser via intent", () => {
    setUa(INSTAGRAM_UA);
    const { assign, loc, restore } = mockLocation();
    render(<GoogleButton />);
    expect(screen.getByTestId("inapp-warning")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("google-btn"));
    expect(assign).not.toHaveBeenCalled();
    expect(loc.href).toContain("intent://");
    restore();
  });

  it("plain Chrome goes straight to /auth/google", () => {
    setUa(CHROME_UA);
    const { assign, restore } = mockLocation();
    render(<GoogleButton />);
    expect(screen.queryByTestId("inapp-warning")).toBeNull();
    fireEvent.click(screen.getByTestId("google-btn"));
    expect(assign).toHaveBeenCalledWith("/auth/google?next=%2Fapp");
    restore();
  });
});
