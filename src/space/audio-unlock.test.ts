import { beforeEach, describe, expect, it } from "vitest";
import { primeAudioOnFirstGesture, resetAudioUnlockForTests, type Primeable } from "./audio-unlock";

/**
 * What can be checked here, and what cannot.
 *
 * The autoplay policy this works around is per-device and enforced by the
 * browser, so no test can prove that a Quest starts making sound. These cover
 * the MECHANISM: that a gesture is what triggers it, that it happens once, that
 * the primer is silent, and that a refusal is swallowed rather than surfacing as
 * a failure somebody has to read. The effect needs baiwei's headset.
 */
const fakeTarget = () => {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener(type: string, listener: () => void) {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    fire(type: string) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    count() {
      return [...listeners.values()].reduce((total, set) => total + set.size, 0);
    },
  };
};

const fakePrimer = () => {
  const played: Primeable[] = [];
  const makeAudio = (): Primeable => {
    const audio: Primeable = { volume: 1, muted: false, play: () => { played.push(audio); return Promise.resolve(); } };
    return audio;
  };
  return { makeAudio, played };
};

beforeEach(() => resetAudioUnlockForTests());

describe("buying permission to make a sound", () => {
  it("plays nothing until somebody does something", () => {
    const target = fakeTarget();
    const primer = fakePrimer();
    primeAudioOnFirstGesture({ on: target, makeAudio: primer.makeAudio });
    expect(primer.played).toHaveLength(0);
    expect(target.count()).toBeGreaterThan(0);
  });

  it("primes on the first tap, silently", () => {
    const target = fakeTarget();
    const primer = fakePrimer();
    primeAudioOnFirstGesture({ on: target, makeAudio: primer.makeAudio });
    target.fire("pointerdown");
    expect(primer.played).toHaveLength(1);
    // NOBODY HEARS THE THING THAT BUYS THE PERMISSION.
    expect(primer.played[0].volume).toBe(0);
    expect(primer.played[0].muted).toBe(true);
  });

  it("takes its listeners off once it has worked", () => {
    const target = fakeTarget();
    const primer = fakePrimer();
    primeAudioOnFirstGesture({ on: target, makeAudio: primer.makeAudio });
    target.fire("pointerdown");
    expect(target.count()).toBe(0);
    target.fire("pointerdown");
    expect(primer.played).toHaveLength(1);
  });

  it("a keypress or a touch counts, not only a pointer", () => {
    for (const gesture of ["keydown", "touchstart"]) {
      resetAudioUnlockForTests();
      const target = fakeTarget();
      const primer = fakePrimer();
      primeAudioOnFirstGesture({ on: target, makeAudio: primer.makeAudio });
      target.fire(gesture);
      expect(primer.played).toHaveLength(1);
    }
  });

  it("arms once however many times it is called", () => {
    const target = fakeTarget();
    const primer = fakePrimer();
    primeAudioOnFirstGesture({ on: target, makeAudio: primer.makeAudio });
    const armed = target.count();
    primeAudioOnFirstGesture({ on: target, makeAudio: primer.makeAudio });
    primeAudioOnFirstGesture({ on: target, makeAudio: primer.makeAudio });
    expect(target.count()).toBe(armed);
  });

  /**
   * A REFUSED PRIMER IS NOT A FAILURE ANYBODY SHOULD READ. It was not a line
   * somebody asked to hear, and the line that WAS asked for reports itself.
   */
  it("says nothing when the primer is itself refused", () => {
    const target = fakeTarget();
    const refused = (): Primeable => ({ volume: 1, muted: false, play: () => Promise.reject(new Error("NotAllowedError")) });
    primeAudioOnFirstGesture({ on: target, makeAudio: refused });
    expect(() => target.fire("pointerdown")).not.toThrow();
  });

  it("does nothing at all where there is no event target, rather than throwing", () => {
    expect(() => primeAudioOnFirstGesture({ on: undefined as never })).not.toThrow();
  });
});
