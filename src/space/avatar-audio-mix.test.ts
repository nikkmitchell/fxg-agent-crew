import { afterEach, describe, expect, it, vi } from "vitest";
import { avatarAudioMix } from "./avatar-audio-mix";
import { offerRecordedSpeech } from "./room-recording-audio";

const started: Array<{ offset: number; to: unknown }> = [];
class FakeContext {
  destination = { name: "speakers" };
  createMediaStreamDestination() { return { name: "recording", stream: { getTracks: () => [] } }; }
  createMediaStreamSource() { return { connect: () => {}, disconnect: () => {} }; }
  createMediaElementSource() { throw new Error("this headset will not tap an element"); }
  decodeAudioData() { return Promise.resolve({ duration: 4 }); }
  createBufferSource() {
    const node = { buffer: null, onended: null, to: null as unknown, connect(to: unknown) { node.to = to; }, disconnect() {}, stop() {}, start(_when: number, offset: number) { started.push({ offset, to: node.to }); } };
    return node;
  }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

class FakeElement extends EventTarget {
  src = "blob:line";
  paused = true;
  ended = false;
  currentTime = 0;
}

afterEach(() => {
  vi.unstubAllGlobals();
  started.length = 0;
});

describe("the recording hears an agent's spoken line (Nikk, 6253)", () => {
  it("copies the line in from its file, into the recording only, even where tapping the element fails", async () => {
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("HTMLAudioElement", FakeElement);
    vi.stubGlobal("fetch", () => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }));
    const agent = { actorId: "Nightjar", kind: "agent" } as never;
    const mix = avatarAudioMix({} as MediaStream, false, true, () => [agent], () => new Set());

    const element = new FakeElement();
    offerRecordedSpeech("nightjar", element);
    element.paused = false;
    element.currentTime = 0.25;
    element.dispatchEvent(new Event("playing"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(started).toEqual([{ offset: 0.25, to: expect.objectContaining({ name: "recording" }) }]);
    mix.stop();
  });

  it("leaves out an agent the recorder did not include", async () => {
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("HTMLAudioElement", FakeElement);
    vi.stubGlobal("fetch", () => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }));
    const mix = avatarAudioMix({} as MediaStream, true, false, () => [{ actorId: "Nightjar", kind: "agent" } as never], () => new Set());
    const element = new FakeElement();
    offerRecordedSpeech("Nightjar", element);
    element.paused = false;
    element.dispatchEvent(new Event("playing"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual([]);
    mix.stop();
  });
});
