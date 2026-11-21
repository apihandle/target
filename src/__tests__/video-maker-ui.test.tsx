// The Video Maker card on /app/social: 3–6 image-link + caption rows (add/remove bounded),
// Render posts the slides to /api/video/render and polls the job until the private download
// appears as a preview + download link; a failed job shows its error. Fetch is stubbed; the
// poll interval is driven with fake timers.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import VideoMakerCard from "@/components/admin/VideoMakerCard";

const JOB_ID = "66666666-6666-4666-8666-666666666666";

function stubFetch(pollResults: unknown[]) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  let polls = 0;
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (String(url) === "/api/video/render" && method === "POST") {
      return new Response(JSON.stringify({ job_id: JOB_ID, status: "queued" }), { status: 200 });
    }
    if (String(url).startsWith("/api/video/render?id=") && method === "GET") {
      const r = pollResults[Math.min(polls, pollResults.length - 1)];
      polls += 1;
      return new Response(JSON.stringify(r), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", f);
  return calls;
}

function fillSlides(n = 3) {
  for (let i = 0; i < n; i++) {
    fireEvent.change(screen.getByTestId(`vm-url-${i}`), { target: { value: `https://images.example.com/pic${i}.jpg` } });
    fireEvent.change(screen.getByTestId(`vm-caption-${i}`), { target: { value: `Caption ${i}` } });
  }
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Video Maker card", () => {
  it("starts with 3 slide rows and bounds add/remove to 6 and 3", () => {
    stubFetch([]);
    render(<VideoMakerCard />);
    expect(screen.getAllByTestId(/^vm-slide-\d+$/)).toHaveLength(3);
    expect(screen.queryByTestId("vm-remove-0")).toBeNull();
    fireEvent.click(screen.getByTestId("vm-add"));
    fireEvent.click(screen.getByTestId("vm-add"));
    fireEvent.click(screen.getByTestId("vm-add"));
    expect(screen.getAllByTestId(/^vm-slide-\d+$/)).toHaveLength(6);
    expect(screen.queryByTestId("vm-add")).toBeNull();
    fireEvent.click(screen.getByTestId("vm-remove-5"));
    expect(screen.getAllByTestId(/^vm-slide-\d+$/)).toHaveLength(5);
  });

  it("posts the slides, polls, and shows the finished video with a download link", async () => {
    vi.useFakeTimers();
    const calls = stubFetch([
      { status: "running" },
      { status: "done", video: { name: "video.mp4", url: "https://gettarget.vercel.app/api/files/abc" } },
    ]);
    render(<VideoMakerCard />);
    fillSlides();
    fireEvent.click(screen.getByTestId("vm-render"));
    await act(async () => {}); // let the POST resolve
    const postCall = calls.find((c) => c.method === "POST");
    expect(postCall?.url).toBe("/api/video/render");
    expect(postCall?.body).toEqual({
      slides: [0, 1, 2].map((i) => ({ url: `https://images.example.com/pic${i}.jpg`, caption: `Caption ${i}` })),
    });
    expect(screen.getByTestId("vm-render")).toHaveTextContent("Rendering…");
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); }); // first poll: still running
    expect(screen.queryByTestId("vm-result")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); }); // second poll: done
    const result = screen.getByTestId("vm-result");
    expect(result.querySelector("video")).toHaveAttribute("src", "https://gettarget.vercel.app/api/files/abc");
    expect(result.querySelector("a")).toHaveAttribute("href", "https://gettarget.vercel.app/api/files/abc");
    expect(result.querySelector("a")).toHaveTextContent("Download video.mp4");
  });

  it("a failed job shows its error and re-enables the form", async () => {
    vi.useFakeTimers();
    stubFetch([{ status: "failed", error: "ffmpeg could not render the video" }]);
    render(<VideoMakerCard />);
    fillSlides();
    fireEvent.click(screen.getByTestId("vm-render"));
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText("ffmpeg could not render the video")).toBeTruthy();
    expect(screen.getByTestId("vm-render")).toHaveTextContent("Render video");
    expect(screen.getByTestId("vm-render")).not.toBeDisabled();
  });

  it("a rejected start (400) shows the server's message and queues nothing", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "Slide 1: image links must start with https://" }), { status: 400 }));
    vi.stubGlobal("fetch", f);
    render(<VideoMakerCard />);
    fillSlides();
    fireEvent.click(screen.getByTestId("vm-render"));
    await act(async () => {});
    expect(screen.getByText("Slide 1: image links must start with https://")).toBeTruthy();
    expect(screen.queryByTestId("vm-result")).toBeNull();
  });
});
