import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { pushMock } from "../../vitest.setup";

const signUp = vi.fn();
const signInWithPassword = vi.fn();
const signInWithOAuth = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signUp, signInWithPassword, signInWithOAuth } }),
}));

import AuthForm from "@/components/AuthForm";
import SignupCard from "@/components/SignupCard";
import { validateCredentials } from "@/lib/validate";

beforeEach(() => { signUp.mockReset(); signInWithPassword.mockReset(); signInWithOAuth.mockReset(); });

function fill(email: string, password: string) {
  fireEvent.change(screen.getByTestId("auth-email"), { target: { value: email } });
  fireEvent.change(screen.getByTestId("auth-password"), { target: { value: password } });
  fireEvent.click(screen.getByTestId("auth-submit"));
}

describe("Feature 3: Auth", () => {
  it("validateCredentials rules", () => {
    expect(validateCredentials("bad", "12345678")).toMatch(/valid email/);
    expect(validateCredentials("a@b.co", "short")).toMatch(/8 characters/);
    expect(validateCredentials("a@b.co", "longenough")).toBeNull();
  });

  it("blocks invalid input without calling Supabase", () => {
    render(<AuthForm />);
    fill("nope", "x");
    expect(screen.getByTestId("auth-error")).toHaveTextContent("valid email");
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("signs in and redirects to /app", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    render(<AuthForm />);
    fill("vikash@example.com", "supersecret");
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/app"));
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "vikash@example.com", password: "supersecret" });
  });

  it("shows Supabase sign-in error", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    render(<AuthForm />);
    fill("vikash@example.com", "wrongpass1");
    expect(await screen.findByTestId("auth-error")).toHaveTextContent("Invalid login credentials");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("sign up asks to confirm email when no session", async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: null });
    render(<AuthForm />);
    fireEvent.click(screen.getByTestId("tab-signup"));
    fill("new@example.com", "newpassword");
    expect(await screen.findByTestId("auth-info")).toHaveTextContent("confirm your email");
    expect(signUp.mock.calls[0][0].options.emailRedirectTo).toContain("/auth/callback?next=%2Fapp");
  });

  it("prefills email and opens sign up from landing", () => {
    render(<AuthForm initialEmail="pre@example.com" />);
    expect(screen.getByTestId("auth-email")).toHaveValue("pre@example.com");
    expect(screen.getByTestId("auth-submit")).toHaveTextContent("Create account");
  });

  it("landing email Continue goes to /login with email", () => {
    render(<SignupCard />);
    fireEvent.change(screen.getByTestId("email-input"), { target: { value: "v@example.com" } });
    fireEvent.click(screen.getByTestId("email-submit"));
    expect(pushMock).toHaveBeenCalledWith("/login?email=v%40example.com");
  });

  it("Google button starts Supabase OAuth with callback redirect", async () => {
    signInWithOAuth.mockResolvedValue({ error: null });
    render(<SignupCard />);
    fireEvent.click(screen.getByTestId("google-btn"));
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalled());
    const arg = signInWithOAuth.mock.calls[0][0];
    expect(arg.provider).toBe("google");
    expect(arg.options.redirectTo).toBe(`${window.location.origin}/auth/callback?next=%2Fapp`);
  });

  it("Google error is shown", async () => {
    signInWithOAuth.mockResolvedValue({ error: { message: "provider is not enabled" } });
    render(<AuthForm next="/app" />);
    fireEvent.click(screen.getByTestId("google-btn"));
    expect(await screen.findByTestId("google-error")).toHaveTextContent("provider is not enabled");
  });

  it("no fake Apple button", () => {
    render(<SignupCard />);
    expect(screen.queryByText(/Apple/)).toBeNull();
  });
});
