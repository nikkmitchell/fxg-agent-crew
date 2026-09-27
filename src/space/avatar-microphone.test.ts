import { afterEach, describe, expect, it, vi } from "vitest";
import { avatarMicrophone } from "./avatar-microphone";

afterEach(() => vi.unstubAllGlobals());

describe("avatar microphone", () => {
  it("clones the call track instead of opening another microphone", async () => {
    const clone = { readyState: "live", stop: vi.fn() };
    const source = { readyState: "live", clone: vi.fn(() => clone), stop: vi.fn() };
    const call = { getAudioTracks: () => [source] } as unknown as MediaStream;
    class FakeMediaStream {
      constructor(private tracks: unknown[]) {}
      getAudioTracks() { return this.tracks; }
      getTracks() { return this.tracks; }
    }
    vi.stubGlobal("MediaStream", FakeMediaStream);
    const getUserMedia = vi.fn();
    const recorded = await avatarMicrophone(() => call, true, { getUserMedia } as unknown as MediaDevices);
    expect(source.clone).toHaveBeenCalledOnce();
    expect(getUserMedia).not.toHaveBeenCalled();
    recorded.getTracks().forEach((track) => track.stop());
    expect(clone.stop).toHaveBeenCalledOnce();
    expect(source.stop).not.toHaveBeenCalled();
  });

  it("refuses a second request while a call microphone is unavailable", async () => {
    const getUserMedia = vi.fn();
    await expect(avatarMicrophone(() => null, true, { getUserMedia } as unknown as MediaDevices)).rejects.toThrow(/not ready/);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("opens the microphone when there is no call", async () => {
    const stream = {} as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    expect(await avatarMicrophone(() => null, false, { getUserMedia } as unknown as MediaDevices)).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
  });
});
