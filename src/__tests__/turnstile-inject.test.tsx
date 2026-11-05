// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { injectToken } from "@/lib/server/autoSolve";

const page = { evaluate: async (fn: (a: unknown) => unknown, arg: unknown) => fn(arg) } as never;

describe("injectToken hands a solver token to the page like the widget would", () => {
  it("fills every response box and runs window.turnstileCallbacks (TimeBucks keeps Log In disabled until then)", async () => {
    document.body.innerHTML = `<form id="loginbox"><input type="hidden" name="cf-turnstile-response"><input type="button" id="go" disabled></form>`;
    const got: string[] = [];
    (window as unknown as Record<string, unknown>).turnstileCallbacks = { loginbox: (t: string) => { got.push(t); (document.getElementById("go") as HTMLInputElement).disabled = false; } };
    await injectToken(page, "1.TOKEN-abcdefghijklmnopqrstuvwxyz", null);
    expect((document.querySelector("input[name='cf-turnstile-response']") as HTMLInputElement).value).toBe("1.TOKEN-abcdefghijklmnopqrstuvwxyz");
    expect(got).toEqual(["1.TOKEN-abcdefghijklmnopqrstuvwxyz"]);
    expect((document.getElementById("go") as HTMLInputElement).disabled).toBe(false);
    delete (window as unknown as Record<string, unknown>).turnstileCallbacks;
  });
  it("runs the data-callback once even when it is also in the map", async () => {
    document.body.innerHTML = `<div class="cf-turnstile" data-sitekey="0x4AAAAAAAW9zqSPAlyOSMfO"></div>`;
    let n = 0;
    const cb = () => { n++; };
    Object.assign(window, { javascriptCallback: cb, turnstileCallbacks: { a: cb } });
    await injectToken(page, "1.TOKEN-abcdefghijklmnopqrstuvwxyz", "javascriptCallback");
    expect(n).toBe(1);
    expect((document.querySelector("input[name='cf-turnstile-response']") as HTMLInputElement).value).toMatch(/^1\.TOKEN/);
  });
});
