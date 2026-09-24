import { describe, expect, it, vi } from "vitest";
import { endSessionThenReturn, XR_END_TIMEOUT_MS } from "./end-session-to-lobby";

describe("returning to the lobby from immersive mode", () => {
  it("ends the headset session before navigating", async () => {
    const calls: string[] = [];
    await endSessionThenReturn(
      { end: async () => { calls.push("end"); } },
      () => calls.push("lobby"),
    );
    expect(calls).toEqual(["end", "lobby"]);
  });

  it("still navigates when the headset session already ended", async () => {
    const returnToLobby = vi.fn();
    await endSessionThenReturn({ end: async () => { throw new Error("already ended"); } }, returnToLobby);
    expect(returnToLobby).toHaveBeenCalledOnce();
  });

  it("navigates when XR teardown never settles", async () => {
    vi.useFakeTimers();
    try {
      const returnToLobby = vi.fn();
      const neverEnds = new Promise<void>(() => {});
      const returning = endSessionThenReturn({ end: () => neverEnds }, returnToLobby);
      await vi.advanceTimersByTimeAsync(XR_END_TIMEOUT_MS);
      await returning;
      expect(returnToLobby).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("navigates directly when there is no active headset session", async () => {
    const returnToLobby = vi.fn();
    await endSessionThenReturn(null, returnToLobby);
    expect(returnToLobby).toHaveBeenCalledOnce();
  });

  it("navigates directly before the XR session hook has initialized", async () => {
    const returnToLobby = vi.fn();
    await endSessionThenReturn(undefined, returnToLobby);
    expect(returnToLobby).toHaveBeenCalledOnce();
  });
});
