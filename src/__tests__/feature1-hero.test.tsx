import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Hero from "@/components/Hero";
import Navbar from "@/components/Navbar";
import { PROMPTS } from "@/components/RotatingPrompts";

describe("Feature 1: Hero", () => {
  it("renders navbar brand and sign up", () => {
    render(<Navbar />);
    expect(screen.getByLabelText("TARGET home")).toBeInTheDocument();
    expect(screen.getByTestId("nav-signup")).toHaveAttribute("href", "#signup");
  });
  it("renders headline and signup card", () => {
    render(<Hero />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("TARGET handles it");
    expect(screen.getByText("Continue with Google")).toBeInTheDocument();
  });
  it("rotates prompts every 3s", () => {
    vi.useFakeTimers();
    render(<Hero />);
    expect(screen.getByTestId("rotating-prompt")).toHaveTextContent(PROMPTS[0]);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByTestId("rotating-prompt")).toHaveTextContent(PROMPTS[1]);
    vi.useRealTimers();
  });
  it("validates email", () => {
    render(<Hero />);
    const input = screen.getByTestId("email-input");
    fireEvent.change(input, { target: { value: "bad" } });
    fireEvent.click(screen.getByTestId("email-submit"));
    expect(screen.getByTestId("email-error")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "vikash@example.com" } });
    fireEvent.click(screen.getByTestId("email-submit"));
    expect(screen.getByTestId("email-ok")).toBeInTheDocument();
  });
});
