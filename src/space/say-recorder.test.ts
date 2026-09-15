import { describe, expect, it, vi } from "vitest";
import { createSayRecorder } from "./say-recorder";

/**
 * Only the part that can be tested without a microphone, and it is the part
 * that matters most: THE MICROPHONE IS LET GO OF, on every path out.
 *
 * A stream left open in a headset is a light on somebody's face and a room
 * listening to them, and the code reaching `release` is not obvious — it sits
 * behind an await, a throw, and three different exits.
 */

const fakeStream = () => {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop };
};

const scopeFor = (stream: MediaStream) => ({
  mediaDevices: { getUserMedia: async () => stream },
});

// `bestFormat` asks the global MediaRecorder which types it supports.
const withMediaRecorder = (supported = true) => {
  vi.stubGlobal("MediaRecorder", { isTypeSupported: () => supported });
};

describe("letting go of the microphone", () => {
  it("closes the stream when the recorder cannot be built", async () => {
    // An unsupported mime type accepted by isTypeSupported and refused by the
    // constructor. The first version left the stream open for ever here: the
    // room believed nothing was recording, so it offered no control that would
    // have closed it.
    withMediaRecorder();
    const { stream, stop } = fakeStream();
    const recorder = createSayRecorder({
      scope: scopeFor(stream),
      makeRecorder: () => {
        throw new Error("NotSupportedError");
      },
    });

    await expect(recorder.start()).rejects.toThrow("NotSupportedError");
    expect(stop, "the microphone was let go of").toHaveBeenCalled();
    expect(recorder.recording()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("does not leak a second microphone when a failed start is retried", async () => {
    withMediaRecorder();
    const first = fakeStream();
    const second = fakeStream();
    const streams = [first.stream, second.stream];
    const recorder = createSayRecorder({
      scope: { mediaDevices: { getUserMedia: async () => streams.shift()! } },
      makeRecorder: () => {
        throw new Error("NotSupportedError");
      },
    });

    await expect(recorder.start()).rejects.toThrow();
    await expect(recorder.start()).rejects.toThrow();
    expect(first.stop).toHaveBeenCalled();
    expect(second.stop).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("closes the stream when the recording is cancelled", () => {
    withMediaRecorder();
    const { stream, stop } = fakeStream();
    const recorder = createSayRecorder({ scope: scopeFor(stream) });
    recorder.cancel();
    // Nothing was started, so there is nothing to stop — but cancel must never
    // throw, because it is the control somebody presses when something is wrong.
    expect(stop).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("refuses a browser that will not record, before asking for a microphone", async () => {
    withMediaRecorder(false);
    const { stream, stop } = fakeStream();
    const recorder = createSayRecorder({ scope: scopeFor(stream) });

    await expect(recorder.start()).rejects.toThrow(/cannot record audio/);
    expect(stop, "and never opened one to find out").not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("says plainly when a browser gives a page no microphone at all", async () => {
    withMediaRecorder();
    const recorder = createSayRecorder({ scope: {} });
    await expect(recorder.start()).rejects.toThrow(/will not give a page a microphone/);
    vi.unstubAllGlobals();
  });
});
