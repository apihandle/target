// A failed browser job always says exactly why and the next step that exists; the admin page lists what works.
import { describe, it, expect } from "vitest";
import { failureHint, failureLine } from "@/lib/jobFailure";
import { capabilities } from "@/lib/server/providerStatus";

describe("failure reason + next step", () => {
  it("names the exact blocker and a real next step for each case", () => {
    expect(failureHint("CLOUDFLARE_BLOCKED: Cloudflare Turnstile check on the form has not passed on timebucks.com")).toMatchObject({ code: "CLOUDFLARE_BLOCKED", next: expect.stringMatching(/Take control/) });
    expect(failureHint("GOOGLE_BLOCKED: Google refused")).toMatchObject({ code: "GOOGLE_BLOCKED", next: expect.stringMatching(/Take control/) });
    expect(failureHint("No cloud browser available (steel: HTTP 402 Insufficient credits)")).toMatchObject({ code: "NO_BROWSER", next: expect.stringMatching(/credit|provider/) });
    expect(failureHint("EARN_TASK_REFUSED: I don't do paid-to-click")).toMatchObject({ code: "EARN_TASK_REFUSED", reason: expect.stringMatching(/click fraud/) });
    expect(failureHint("PAUSE_TIMEOUT: The check wasn't completed within 5 minutes")).toMatchObject({ code: "PAUSE_TIMEOUT", reason: expect.stringMatching(/5 minutes/) });
    expect(failureHint("Gmail isn't connected, so the emailed link can't be opened")).toMatchObject({ code: "NEEDS_GMAIL", next: expect.stringMatching(/Connect Gmail/) });
  });
  it("is never the vague 'The browser task failed'", () => {
    for (const e of [null, "", "boom"]) {
      const l = failureLine(e);
      expect(l).not.toBe("The browser task failed");
      expect(l).toMatch(/Next: /);
    }
  });
});

describe("admin capabilities", () => {
  it("lists Works / Not available with a reason, never key values", () => {
    const c = capabilities({ STEEL_API_KEY: "FAKE-steel-not-a-real-token" });
    const by = Object.fromEntries(c.map((x) => [x.name, x]));
    expect(by["Live view + Take control"].works).toBe(true);
    expect(by["Paid captcha solver"]).toMatchObject({ works: false, reason: expect.stringMatching(/CapSolver \$1\.20/) });
    expect(by["Google sign-in by the bot"].works).toBe(false);
    expect(by["Earn tasks (paid-to-click, ads, surveys)"].works).toBe(false);
    expect(capabilities({ CAPSOLVER_API_KEY: "FAKE" }).find((x) => x.name === "Paid captcha solver")).toMatchObject({ works: true, reason: "On: CapSolver." });
    expect(JSON.stringify(c)).not.toContain("FAKE-steel");
    for (const x of c) expect(x.reason.length).toBeGreaterThan(10);
  });
});
