import { beforeEach, describe, expect, it, vi } from "vitest";
import { LONGEST_TURN_MS, NO_ENGINE, clearAloudQueue, queueAloud, readAloud, type Playable } from "./said-aloud";

/**
 * Hearing an agent's OWN voice, and never hearing nothing.
 *
 * The box makes the sound; the browser's synthesiser is the fallback. These
 * check which one speaks in each case, because the failure that matters is
 * silence with no reason: a box with no engine, or a headset that will not
 * autoplay, must still say the words.
 *
 * AND WHICH ONE MUST NOT. Nikk (2026-09-24): "we don't want them to fall back
 * to robot voices". A box that tried and failed is not read by the robot any
 * more; it says so. The robot is only for a box with no voice at all.
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
      fetchSaid: async () => NO_ENGINE,
      makeAudio: fakeAudio().makeAudio,
    });
    await settle();
    expect(failures.map((f) => f.code)).toEqual(["no-voice-here"]);
  });

  it("falls back to the browser when the box has no engine", async () => {
    // 501: the browser's voice is the only one there is.
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
      fetchSaid: async () => NO_ENGINE,
      makeAudio: audio.makeAudio,
    });
    await settle();
    expect(audio.played, "nothing was played from the box").toEqual([]);
    expect(spoke, "the browser said it instead").toHaveBeenCalled();
  });

  it("does NOT use the robot when the box tried and failed; it says so", async () => {
    const spoke = vi.fn();
    (globalThis as { speechSynthesis?: unknown }).speechSynthesis = { speak: spoke, cancel: () => {} };
    (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance = class {
      constructor(public text: string) {}
    };
    const failures: { code: string }[] = [];
    const phases: string[] = [];
    readAloud({
      utteranceId: 7,
      say: "Deployed and verified.",
      onPhase: (phase) => phases.push(phase),
      onFailure: (failure) => failures.push(failure as { code: string }),
      fetchSaid: async () => null,
      makeAudio: fakeAudio().makeAudio,
    });
    await settle();
    expect(spoke, "no robot voice").not.toHaveBeenCalled();
    expect(failures.map((f) => f.code)).toEqual(["not-voiced"]);
    expect(phases, "and it finished, so the next line can start").toEqual(["idle"]);
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

/**
 * Nikk: "we also don't want them speaking at the same time, so it's very fine
 * to have it wait until the previous one's finished before it begins the next
 * one". A new line used to CANCEL the one playing.
 */
describe("lines said close together", () => {
  beforeEach(() => clearAloudQueue());

  /** Several audio elements, each ended by the test. */
  const box = () => {
    const asked: number[] = [];
    const elements: (Playable & { url: string })[] = [];
    const fetchSaid = async (id: number) => {
      asked.push(id);
      return `blob:said-${id}`;
    };
    const makeAudio = (url: string) => {
      const audio: Playable & { url: string } = {
        url, volume: 1, onended: null, onerror: null,
        play: () => Promise.resolve(), pause: vi.fn(),
      };
      elements.push(audio);
      return audio;
    };
    const end = (index: number) => elements[index].onended?.();
    return { asked, elements, fetchSaid, makeAudio, end };
  };
  const line = (id: number, b: ReturnType<typeof box>, failures: string[] = []) =>
    queueAloud({
      utteranceId: id, say: `line ${id}`, onPhase: () => {},
      onFailure: (f) => failures.push(f.code), fetchSaid: b.fetchSaid, makeAudio: b.makeAudio,
    });

  it("plays the second after the first ends, in its own voice, never over it", async () => {
    const b = box();
    line(1, b);
    line(2, b);
    await settle();
    expect(b.elements.map((e) => e.url), "only the first is playing").toEqual(["blob:said-1"]);
    expect(b.elements[0].pause, "and nothing cut it off").not.toHaveBeenCalled();

    b.end(0);
    await settle();
    expect(b.elements.map((e) => e.url)).toEqual(["blob:said-1", "blob:said-2"]);
  });

  it("keeps the order they were said in", async () => {
    const b = box();
    [1, 2, 3].forEach((id) => line(id, b));
    for (let i = 0; i < 3; i += 1) {
      await settle();
      b.end(i);
    }
    await settle();
    expect(b.asked).toEqual([1, 2, 3]);
  });

  it("takes a cancelled line out of the queue without touching the one playing", async () => {
    const b = box();
    line(1, b);
    const second = line(2, b);
    line(3, b);
    second.cancel();
    await settle();
    b.end(0);
    await settle();
    expect(b.asked, "2 was never asked for").toEqual([1, 3]);
  });

  it("moves on when the line playing is cancelled", async () => {
    const b = box();
    const first = line(1, b);
    line(2, b);
    await settle();
    first.cancel();
    await settle();
    expect(b.elements[0].pause).toHaveBeenCalled();
    expect(b.asked).toEqual([1, 2]);
  });

  it("moves on past a line that failed, without the robot", async () => {
    const b = box();
    const failures: string[] = [];
    queueAloud({
      utteranceId: 1, say: "line 1", onPhase: () => {}, onFailure: (f) => failures.push(f.code),
      fetchSaid: async () => null, makeAudio: b.makeAudio,
    });
    line(2, b);
    await settle();
    await settle();
    expect(failures).toEqual(["not-voiced"]);
    expect(b.elements.map((e) => e.url), "the next line still played").toEqual(["blob:said-2"]);
  });

  it("gives up on a line that never says it finished, rather than silencing the rest", async () => {
    vi.useFakeTimers();
    try {
      const b = box();
      line(1, b);
      line(2, b);
      await vi.advanceTimersByTimeAsync(10);
      expect(b.asked).toEqual([1]);
      await vi.advanceTimersByTimeAsync(LONGEST_TURN_MS);
      expect(b.asked).toEqual([1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });
});
