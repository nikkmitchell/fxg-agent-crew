import { describe, expect, it, vi } from "vitest";
import { registerRoomAudioContext, resumeRoomAudio } from "./room-audio";

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
