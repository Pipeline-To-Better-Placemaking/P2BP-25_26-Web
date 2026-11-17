import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.hoisted(() => vi.fn());

vi.mock("../../../auth/apiClient", () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { api: { post }, ApiError };
});

vi.mock("../../../auth/authStore", () => ({
  subscribe: () => () => {},
  getState: () => ({ User: { Id: "user-1" } }),
}));

import {
  deleteWorkstationProject,
  isDownloadable,
  isVideoPath,
  listProjectFiles,
  parseRetryAfter,
  WorkstationError,
} from "./amcApi";

const BASE = "http://workstation:8090";

function ticket(name: string) {
  return { Ticket: name, ExpiresAt: new Date(Date.now() + 300_000).toISOString(), WorkstationUrl: BASE };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

// A fake clock whose sleep advances time, so retries run instantly
function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
  };
}

describe("parseRetryAfter", () => {
  it("reads whole seconds and ignores anything else", () => {
    expect(parseRetryAfter("15")).toBe(15);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT")).toBeNull();
  });
});

describe("isVideoPath", () => {
  it("treats everything under footage/ as video", () => {
    expect(isVideoPath("footage/manifest.json")).toBe(true);
    expect(isVideoPath("footage/previous/cam1.mp4")).toBe(true);
  });

  it("matches the video suffixes case-insensitively", () => {
    for (const path of ["a.mp4", "b.MKV", "c/d.mov", "e.avi", "f.ts", "g.h264", "h.H265"]) {
      expect(isVideoPath(path)).toBe(true);
    }
  });

  it("leaves other files downloadable", () => {
    expect(isVideoPath("floorplan.png")).toBe(false);
    expect(isVideoPath("calibration/20261117T120000Z/results.json")).toBe(false);
    expect(isVideoPath("notes.tsx")).toBe(false);
  });
});

describe("isDownloadable", () => {
  it("honors the workstation's flag when present", () => {
    expect(isDownloadable({ Path: "layout.png", Size: 1, ModifiedAt: 0, Downloadable: false })).toBe(false);
    expect(isDownloadable({ Path: "x.mp4", Size: 1, ModifiedAt: 0, Downloadable: true })).toBe(true);
  });

  it("falls back to the video rule when the flag is missing", () => {
    expect(isDownloadable({ Path: "footage/cam1.mp4", Size: 1, ModifiedAt: 0 })).toBe(false);
    expect(isDownloadable({ Path: "layout.png", Size: 1, ModifiedAt: 0 })).toBe(true);
  });
});

describe("deleteWorkstationProject", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("window", { location: { protocol: "http:" } });
    vi.stubGlobal("fetch", fetchMock);
    post.mockReset();
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends DELETE /projects/current with the delete ticket", async () => {
    post.mockResolvedValueOnce(ticket("delete-ticket"));
    const result = { Folder: "plaza", AmcProjectId: "amc-1", AmcProjectDeleted: true, Leftover: null };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, result));

    await expect(deleteWorkstationProject("p1")).resolves.toEqual(result);
    expect(post).toHaveBeenCalledWith("/api/workstation/project/p1/delete-ticket");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/projects/current`);
    expect(init.method).toBe("DELETE");
    expect(init.headers.Authorization).toBe("Bearer delete-ticket");
  });

  it("treats 404 as already clean", async () => {
    post.mockResolvedValueOnce(ticket("delete-ticket"));
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { detail: "No folder for this project" }));

    await expect(deleteWorkstationProject("p2")).resolves.toBeNull();
  });

  it("rejects with the workstation's reason on other failures", async () => {
    post.mockResolvedValueOnce(ticket("delete-ticket"));
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { detail: "Cancel this project's run first" }));

    const err = await deleteWorkstationProject("p3").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkstationError);
    expect((err as WorkstationError).status).toBe(409);
    expect((err as WorkstationError).message).toBe("Cancel this project's run first");
  });

  it("rejects an unreachable workstation", async () => {
    post.mockResolvedValueOnce(ticket("delete-ticket"));
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const err = await deleteWorkstationProject("p4").catch((e: unknown) => e);
    expect((err as WorkstationError).kind).toBe("unreachable");
  });

  it("refuses an http workstation from an https page without calling it", async () => {
    vi.stubGlobal("window", { location: { protocol: "https:" } });
    post.mockResolvedValueOnce(ticket("delete-ticket"));

    const err = await deleteWorkstationProject("p5").catch((e: unknown) => e);
    expect((err as WorkstationError).kind).toBe("unreachable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries after Retry-After while the workstation starts AMC", async () => {
    post.mockResolvedValueOnce(ticket("delete-ticket"));
    const result = { Folder: "plaza", AmcProjectId: "amc-1", AmcProjectDeleted: true, Leftover: null };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(503, { detail: "Starting AMC" }, { "Retry-After": "10" }))
      .mockResolvedValueOnce(jsonResponse(503, { detail: "Starting AMC" }))
      .mockResolvedValueOnce(jsonResponse(200, result));
    const clock = fakeClock();
    const onStartingAmc = vi.fn();

    await expect(deleteWorkstationProject("p7", { ...clock, onStartingAmc })).resolves.toEqual(result);
    // The second 503 has no readable Retry-After, so it waits the 15 second default
    expect(clock.sleeps).toEqual([10_000, 15_000]);
    expect(onStartingAmc).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("gives up when AMC is still not ready after three minutes", async () => {
    post.mockResolvedValueOnce(ticket("delete-ticket"));
    fetchMock.mockImplementation(async () => jsonResponse(503, { detail: "Starting AMC" }, { "Retry-After": "15" }));
    const clock = fakeClock();

    const err = await deleteWorkstationProject("p8", clock).catch((e: unknown) => e);
    expect((err as WorkstationError).status).toBe(503);
    expect(clock.sleeps.reduce((a, b) => a + b, 0)).toBe(180_000);
  });

  it("drops the project's cached amc ticket after a delete", async () => {
    post.mockResolvedValueOnce(ticket("amc-ticket-1"));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    await listProjectFiles("p6");

    post.mockResolvedValueOnce(ticket("delete-ticket"));
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { detail: "gone" }));
    await deleteWorkstationProject("p6");

    post.mockResolvedValueOnce(ticket("amc-ticket-2"));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    await listProjectFiles("p6");

    expect(post).toHaveBeenLastCalledWith("/api/workstation/project/p6/ticket");
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer amc-ticket-2");
  });
});
