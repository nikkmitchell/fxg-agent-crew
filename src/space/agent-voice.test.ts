import { describe, expect, it } from "vitest";
import { FAR_VOLUME, volumeAt, voiceFor } from "./agent-voice";

const voices = [
  { lang: "en-US" }, { lang: "en-GB" }, { lang: "fr-FR" }, { lang: "en-AU" }, { lang: "de-DE" }, { lang: "en-IN" },
];

describe("each agent sounds like itself", () => {
  // Nikk: "allow for agents to have different voices".
  it("gives the same agent the same voice every time, under any spelling", () => {
    expect(voiceFor("Sill", voices)).toEqual(voiceFor(" sill ", voices));
  });

  it("gives different agents different voices", () => {
    const names = ["Sill", "Inkstone", "Plumbline", "claude-nikk2mbp"];
    const choices = names.map((name) => JSON.stringify(voiceFor(name, voices)));
    expect(new Set(choices).size).toBe(names.length);
  });

  it("speaks the page's language when the system has a voice for it", () => {
    for (const name of ["Sill", "Inkstone", "Plumbline", "a", "b", "c"]) {
      expect(voices[voiceFor(name, voices, "en-GB").voiceIndex!].lang.startsWith("en")).toBe(true);
    }
  });

  it("still varies pitch and pace when the system offers no voices to choose from", () => {
    const a = voiceFor("Sill", []);
    const b = voiceFor("Inkstone", []);
    expect(a.voiceIndex).toBeNull();
    expect([a.pitch, a.rate]).not.toEqual([b.pitch, b.rate]);
    for (const choice of [a, b]) {
      expect(choice.pitch).toBeGreaterThanOrEqual(0.8);
      expect(choice.pitch).toBeLessThanOrEqual(1.25);
      expect(choice.rate).toBeGreaterThanOrEqual(0.92);
      expect(choice.rate).toBeLessThanOrEqual(1.08);
    }
  });
});

describe("as loud as it is near", () => {
  it("is full volume up close, fades with distance, and never quite disappears", () => {
    expect(volumeAt(1)).toBe(1);
    expect(volumeAt(8)).toBeLessThan(1);
    expect(volumeAt(8)).toBeGreaterThan(FAR_VOLUME);
    expect(volumeAt(50)).toBe(FAR_VOLUME);
    expect(volumeAt(null), "no position known: full volume rather than silence").toBe(1);
  });
});
