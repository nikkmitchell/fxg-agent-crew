import { describe, expect, it } from "vitest";
import { BOWL_NOTES, SOUNDSCAPES, SOUNDSCAPE_LABEL, isSoundscape, nextSoundscape } from "./soundscape";

describe("ambient soundscapes", () => {
  it("cycles through every one and back to off, each with a label", () => {
    let at = nextSoundscape("off");
    const seen = ["off"];
    while (at !== "off") { seen.push(at); at = nextSoundscape(at); }
    expect(seen).toEqual([...SOUNDSCAPES]);
    for (const one of SOUNDSCAPES) expect(SOUNDSCAPE_LABEL[one].length).toBeGreaterThan(0);
  });

  it("reads back only a soundscape it knows, from storage", () => {
    expect(isSoundscape("rain")).toBe(true);
    expect(isSoundscape("thunder")).toBe(false);
    expect(isSoundscape(null)).toBe(false);
  });

  it("strikes bowls on notes that sit in one low, gentle range", () => {
    for (const note of BOWL_NOTES) expect(note).toBeGreaterThan(150), expect(note).toBeLessThan(320);
  });
});
