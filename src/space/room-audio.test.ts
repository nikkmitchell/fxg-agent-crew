import { describe, expect, it, vi } from "vitest";
import { registerRoomAudioContext, resumeRoomAudio, unlockRoomAudioFromXR } from "./room-audio";

describe("room audio playback unlock", () => {
  it("resumes a suspended context from an explicit call gesture", () => {
    const context = {
      state: "suspended",
      resume: vi.fn().mockResolvedValue(undefined),
    } as unknown as AudioContext;
    const unregister = registerRoomAudioContext(context);

    resumeRoomAudio();

    expect(context.resume).toHaveBeenCalledOnce();
    unregister();
  });

  it("does not resume a running or closed context", () => {
    const running = {
      state: "running",
      resume: vi.fn(),
    } as unknown as AudioContext;
    const unregisterRunning = registerRoomAudioContext(running);
    resumeRoomAudio();
    expect(running.resume).not.toHaveBeenCalled();
    unregisterRunning();

    const closed = {
      state: "closed",
      resume: vi.fn(),
    } as unknown as AudioContext;
    const unregisterClosed = registerRoomAudioContext(closed);
    resumeRoomAudio();
    expect(closed.resume).not.toHaveBeenCalled();
    unregisterClosed();
  });
});

function setupXrUnlock() {
  const listeners = new Set<(event: XRInputSourceEvent) => void>();
  const session = {
    addEventListener: vi.fn(
      (_type: "select", listener: (event: XRInputSourceEvent) => void) => listeners.add(listener),
    ),
    removeEventListener: vi.fn(
      (_type: "select", listener: (event: XRInputSourceEvent) => void) => listeners.delete(listener),
    ),
  } as unknown as Pick<XRSession, "addEventListener" | "removeEventListener">;
  const context = {
    state: "suspended",
    resume: vi.fn().mockResolvedValue(undefined),
  } as unknown as AudioContext;
  const unregister = registerRoomAudioContext(context);
  const cleanup = unlockRoomAudioFromXR(session);
  const fire = (targetRayMode: XRTargetRayMode, isTrusted = true) => {
    const event = { isTrusted, inputSource: { targetRayMode } } as XRInputSourceEvent;
    for (const listener of [...listeners]) listener(event);
  };
  return {
    cleanup,
    context,
    fire,
    listeners,
    session,
    unregister,
  };
}

describe("XR room audio playback unlock", () => {
  it("resumes a suspended context on a trusted controller or hand selection", () => {
    const xr = setupXrUnlock();

    xr.fire("tracked-pointer");

    expect(xr.context.resume).toHaveBeenCalledOnce();
    xr.cleanup();
    xr.unregister();
  });

  it("resumes on visionOS hand-tracked pinch selections", () => {
    const xr = setupXrUnlock();

    xr.fire("transient-pointer");

    expect(xr.context.resume).toHaveBeenCalledOnce();
    xr.cleanup();
    xr.unregister();
  });

  it("ignores gaze and synthetic selections", () => {
    const xr = setupXrUnlock();

    xr.fire("gaze");
    xr.fire("tracked-pointer", false);

    expect(xr.context.resume).not.toHaveBeenCalled();
    xr.cleanup();
    xr.unregister();
  });

  it("removes the listener when the XR session effect is cleaned up", () => {
    const xr = setupXrUnlock();

    xr.cleanup();
    xr.fire("tracked-pointer");

    expect(xr.listeners.size).toBe(0);
    expect(xr.session.removeEventListener).toHaveBeenCalledOnce();
    expect(xr.context.resume).not.toHaveBeenCalled();
    xr.unregister();
  });
});
