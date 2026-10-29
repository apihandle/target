import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

export const pushMock = vi.fn();
export const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));
afterEach(() => { cleanup(); pushMock.mockReset(); refreshMock.mockReset(); });
