import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));

import Hero, { CHIPS } from "@/components/Hero";
import Navbar from "@/components/Navbar";
import SignupCard from "@/components/SignupCard";
import WaterBackground from "@/components/WaterBackground";

beforeEach(() => { push.mockReset(); cleanup(); });

describe("Feature 1: Hero (water redesign)", () => {
  it("renders cursive brand and glass sign up", () => {
    render(<Navbar />);
    expect(screen.getByLabelText("TARGET home")).toHaveTextContent("Target");
    expect(screen.getByTestId("nav-signup")).toHaveAttribute("href", "/login?mode=signup");
    expect(screen.getByTestId("nav-signup")).toHaveTextContent("Sign up");
  });
  it("renders headline, search bar and four chips", () => {
    render(<Hero />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ask anything");
    expect(screen.getByPlaceholderText("Ask me anything privately...")).toBeInTheDocument();
    expect(screen.getAllByTestId("hero-chip")).toHaveLength(4);
    expect(CHIPS.map((c) => c.label)).toEqual(["Learn about the World", "Create Anything", "Create Websites", "Surprise Me"]);
  });
  it("submit is disabled when empty and routes the question to the app", () => {
    render(<Hero />);
    expect(screen.getByTestId("hero-submit")).toBeDisabled();
    fireEvent.change(screen.getByTestId("hero-input"), { target: { value: "plan a goa trip" } });
    fireEvent.submit(screen.getByTestId("hero-search"));
    expect(push).toHaveBeenCalledWith("/app?q=plan%20a%20goa%20trip&send=1");
  });
  it("chips fill the search bar", () => {
    render(<Hero />);
    fireEvent.click(screen.getByText("Create Websites"));
    expect(screen.getByTestId("hero-input")).toHaveValue("Build me a website for ");
    fireEvent.click(screen.getByText("Surprise Me"));
    expect((screen.getByTestId("hero-input") as HTMLInputElement).value.length).toBeGreaterThan(0);
  });
  it("water toggle pauses and plays (falls back without WebGL)", () => {
    render(<WaterBackground />);
    const t = screen.getByTestId("water-toggle");
    expect(t).toHaveAttribute("aria-label", "Pause water motion");
    fireEvent.click(t);
    expect(t).toHaveAttribute("aria-label", "Play water motion");
  });
  it("validates email in signup card", () => {
    render(<SignupCard />);
    const input = screen.getByTestId("email-input");
    fireEvent.change(input, { target: { value: "bad" } });
    fireEvent.click(screen.getByTestId("email-submit"));
    expect(screen.getByTestId("email-error")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "vikash@example.com" } });
    fireEvent.click(screen.getByTestId("email-submit"));
    expect(screen.getByTestId("email-ok")).toBeInTheDocument();
  });
});
