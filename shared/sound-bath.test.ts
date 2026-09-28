import { describe, expect, it } from "vitest";
import { BATH_SECONDS, bathScore, notesBetween } from "./sound-bath.js";

describe("the sound bath", () => {
  it("is the same score every time, inside its six minutes, in order", () => {
    const score = bathScore();
    expect(score).toEqual(bathScore());
    expect(score.length).toBeGreaterThan(25);
    for (const note of score) expect(note.at).toBeLessThan(BATH_SECONDS);
    expect(score.map((note) => note.at)).toEqual([...score.map((note) => note.at)].sort((a, b) => a - b));
  });
  it("is fuller in the middle than at the edges", () => {
    const score = bathScore();
    const edge = notesBetween(score, 0, 60).length;
    const middle = notesBetween(score, 150, 210).length;
    expect(middle).toBeGreaterThan(edge);
  });
});
