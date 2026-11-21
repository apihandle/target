// @vitest-environment node
// /auth/app-return fallback page: rendered only when the Android App Link did not open the
// app. With a code it must offer an intent:// hand-off to the installed app (which claims the
// parked session in its WebView); it must never consume the code or reflect junk into the page.
import { describe, it, expect } from "vitest";
import { GET } from "@/app/auth/app-return/route";

const CODE = "abcDEF123-_abcDEF123-_abcDEF123-_abcDEF123"; // base64url, like randomToken(32)

describe("/auth/app-return fallback page", () => {
  it("offers an Open-the-app intent link carrying the code, targeted at the app package", async () => {
    const res = await GET(new Request(`https://gettarget.vercel.app/auth/app-return?code=${CODE}`));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`intent://gettarget.vercel.app/auth/app-return?code=${CODE}#Intent;scheme=https;package=app.target.assistant;action=android.intent.action.VIEW;`);
    expect(html).toContain("Open the TARGET app");
    expect(html).toContain("Continue on the web instead");
  });

  it("without a code, shows the plain go-back-to-the-app page and no intent link", async () => {
    const html = await (await GET(new Request("https://gettarget.vercel.app/auth/app-return"))).text();
    expect(html).not.toContain("intent://");
    expect(html).toContain("Continue on the web instead");
  });

  it("never reflects a malformed code into the page", async () => {
    const junk = '"><script>alert(1)</script>';
    const html = await (await GET(new Request(`https://gettarget.vercel.app/auth/app-return?code=${encodeURIComponent(junk)}`))).text();
    expect(html).not.toContain("intent://");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain(junk);
  });
});
