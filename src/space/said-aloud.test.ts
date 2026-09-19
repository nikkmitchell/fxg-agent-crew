import { beforeEach, describe, expect, it, vi } from "vitest";
import { readAloud, type Playable } from "./said-aloud";

/**
 * Hearing an agent's OWN voice, and never hearing nothing.
 *
 * The box makes the sound; the browser's synthesiser is the fallback. These
 * check which one speaks in each case, because the failure that matters is
 * silence with no reason: a box with no engine, a busy one, or a headset that
 * will not autoplay must all still say the words.
 */
const fakeAudio = () => {
  const played: string[] = [];
  let element: (Playable & { url: string }) | null = null;
  const makeAudio = (url: string) => {
    const audio: Playable & { url: string } = {
      url,
      volume: 1,
      onended: null,
      onerror: null,
      play: () => {
        played.push(url);
        return Promise.resolve();
      },
      pause: vi.fn(),
    };
    element = audio;
    return audio;
  };
  return { makeAudio, played, current: () => element };
};

const settle = () => new Promise((done) => setTimeout(done, 0));

beforeEach(() => {
  // speakSay needs these to exist to do anything; without them it returns null,
  // which is what a browser with no synthesiser does.
  (globalThis as { URL: typeof URL }).URL.revokeObjectURL ??= () => {};
});

describe("reading a line aloud", () => {
  it("plays the box's audio when there is some", async () => {
    const audio = fakeAudio();
    const phases: string[] = [];
    readAloud({
      utteranceId: 7,
      say: "Deployed and verified.",
      volume: 0.5,
      onPhase: (phase) => phases.push(phase),
      onFailure: () => {},
      fetchSaid: async () => "blob:said-7",
      makeAudio: audio.makeAudio,
    });
    await settle();
    expect(audio.played).toEqual(["blob:said-7"]);
    expect(audio.current()?.volume).toBe(0.5);
    expect(phases).toContain("speaking");
  });

  /**
   * BAIWEI'S QUEST 2, AND THE ONLY FAILURE THIS FILE EXISTS TO PREVENT.
   *
   * The headset refuses to autoplay, so it drops to the browser — which on
   * Quest has no speechSynthesis at all, so `speakSay` returns null. Both paths
   * gone, and until now nothing said so: no phase, no failure, no notice. The
   * room just went quiet, which from inside a headset is indistinguishable from
   * nobody talking.
   */
  it("says why when autoplay is refused and this device cannot speak either", async () => {
    delete (globalThis as { speechSynthesis?: unknown }).speechSynthesis;
    delete (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
    const failures: { code: string; message: string }[] = [];
    const refusing = (url: string): Playable => ({
      url,
      volume: 1,
      onended: null,
      onerror: null,
      play: () => Promise.reject(new Error("NotAllowedError")),
      pause: vi.fn(),
    }) as Playable & { url: string };
    readAloud({
      utteranceId: 7,
      say: "Deployed and verified.",
      onPhase: () => {},
      onFailure: (failure) => failures.push(failure as { code: string; message: string }),
      fetchSaid: async () => "blob:said-7",
      makeAudio: refusing,
    });
    await settle();
    expect(failures).toHaveLength(1);
    expect(failures[0].code).toBe("autoplay-refused");
    expect(failures[0].message).toMatch(/tap/i);
  });

  it("says why when there is no audio and no voice on the device", async () => {
    delete (globalThis as { speechSynthesis?: unknown }).speechSynthesis;
    delete (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
    const failures: { code: string }[] = [];
    readAloud({
      utteranceId: 7,
      say: "Deployed and verified.",
      onPhase: () => {},
      onFailure: (failure) => failures.push(failure as { code: string }),
      fetchSaid: async () => null,
      makeAudio: fakeAudio().makeAudio,
    });
    await settle();
    expect(failures.map((f) => f.code)).toEqual(["no-voice-here"]);
  });

  it("falls back to the browser when the box has no engine", async () => {
    // 501 or 503 both arrive here as null: not from here, not now.
    const audio = fakeAudio();
    const spoke = vi.fn();
    (globalThis as { speechSynthesis?: unknown }).speechSynthesis = { speak: spoke, cancel: () => {} };
    (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance = class {
      constructor(public text: string) {}
    };
    readAloud({
      utteranceId: 7,
      say: "Deployed and verified.",
      onPhase: () => {},
      onFailure: () => {},
      fetchSaid: async () => null,
      makeAudio: audio.makeAudio,
    });
    await settle();
    expect(audio.played, "nothing was played from the box").toEqual([]);
    expect(spoke, "the browser said it instead").toHaveBeenCalled();
  });

  it("falls back when the device refuses to play it", async () => {
    const spoke = vi.fn();
    (globalThis as { speechSynthesis?: unknown }).speechSynthesis = { speak: spoke, cancel: () => {} };
    readAloud({
      utteranceId: 7,
      say: "Deployed and verified.",
      onPhase: () => {},
      onFailure: () => {},
      fetchSaid: async () => "blob:said-7",
      makeAudio: () => ({
        volume: 1,
        onended: null,
        onerror: null,
        pause: () => {},
        // A headset that wants a tap before it makes noise.
        play: () => Promise.reject(new Error("NotAllowedError")),
      }),
    });
    await settle();
    await settle();
    expect(spoke, "a refused autoplay still leaves the words spoken").toHaveBeenCalled();
  });

  it("asks the box for nothing when the line is not a room utterance", async () => {
    // Chat messages are WebHarness's. The box has never heard of them.
    const asked = vi.fn();
    (globalThis as { speechSynthesis?: unknown }).speechSynthesis = { speak: () => {}, cancel: () => {} };
    readAloud({
      utteranceId: null,
      say: "Something said in chat.",
      onPhase: () => {},
      onFailure: () => {},
      fetchSaid: asked,
    });
    await settle();
    expect(asked).not.toHaveBeenCalled();
  });

  it("stops the audio when it is cancelled", async () => {
    const audio = fakeAudio();
    const phases: string[] = [];
    const output = readAloud({
      utteranceId: 7,
      say: "A long line that is still playing.",
      onPhase: (phase) => phases.push(phase),
      onFailure: () => {},
      fetchSaid: async () => "blob:said-7",
      makeAudio: audio.makeAudio,
    });
    await settle();
    output.cancel();
    expect(audio.current()?.pause).toHaveBeenCalled();
    expect(phases.at(-1)).toBe("idle");
  });

  it("drops audio that arrives after the cancel", async () => {
    const audio = fakeAudio();
    const output = readAloud({
      utteranceId: 7,
      say: "Cancelled before the fetch came back.",
      onPhase: () => {},
      onFailure: () => {},
      fetchSaid: async () => {
        await settle();
        return "blob:said-7";
      },
      makeAudio: audio.makeAudio,
    });
    output.cancel();
    await settle();
    await settle();
    expect(audio.played, "nothing starts playing after the listener left").toEqual([]);
  });
});
