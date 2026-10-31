import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import Markdown from "@/components/Markdown";
import WelcomeTour from "@/components/WelcomeTour";

afterEach(() => vi.unstubAllGlobals());

describe("Polish pack", () => {
  it("code blocks show a language label and copy their code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<Markdown>{"```js\nconst a = 1;\n```"}</Markdown>);
    expect(screen.getByText("js")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("code-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("const a = 1;"));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("tables sit in a scrollable wrapper and links open in a new tab", () => {
    const { container } = render(<Markdown>{"| a | b |\n|---|---|\n| 1 | 2 |\n\n[x](https://example.com)"}</Markdown>);
    expect(container.querySelector(".table-wrap table")).not.toBeNull();
    expect(screen.getByRole("link", { name: "x" })).toHaveAttribute("target", "_blank");
  });

  describe("welcome tour", () => {
    beforeEach(() => localStorage.clear());
    it("shows once, steps through, and remembers it was seen", () => {
      const { unmount } = render(<WelcomeTour />);
      expect(screen.getByTestId("welcome-tour")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("welcome-next"));
      fireEvent.click(screen.getByTestId("welcome-next"));
      fireEvent.click(screen.getByText("Get started"));
      expect(screen.queryByTestId("welcome-tour")).toBeNull();
      unmount();
      render(<WelcomeTour />);
      expect(screen.queryByTestId("welcome-tour")).toBeNull();
    });
  });
});
