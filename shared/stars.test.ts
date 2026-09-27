import { describe, expect, it } from "vitest";
import { STAR_COUNT, applyStarEvent, applyStars, emptySky, parseSky, stars } from "./stars.js";

const joined = (sky: ReturnType<typeof emptySky>, a: number, b: number) => {
  const result = applyStars(sky, { a, b }, "Nikk2");
  if ("refused" in result) throw new Error(result.refused);
  return result;
};

describe("the star map", () => {
  it("is the same sky every time", () => {
    expect(stars()).toHaveLength(STAR_COUNT);
    expect(stars()).toEqual(stars());
  });
  it("joins two stars, and joining them again takes the line away", () => {
    const one = joined(emptySky(), 5, 2);
    expect(one.sky.links).toEqual([{ a: 2, b: 5, by: "Nikk2" }]);
    const two = joined(one.sky, 2, 5);
    expect(two.sky.links).toEqual([]);
    expect(two.event.kind).toBe("unlink");
  });
  it("refuses a star to itself, or one that is not there", () => {
    expect(applyStars(emptySky(), { a: 3, b: 3 }, "x")).toHaveProperty("refused");
    expect(applyStars(emptySky(), { a: 3, b: STAR_COUNT }, "x")).toHaveProperty("refused");
  });
  it("brings a client up to date, or asks it to read again", () => {
    const one = joined(emptySky(), 1, 2);
    const two = joined(one.sky, 3, 4);
    expect(applyStarEvent(applyStarEvent(emptySky(), one.event)!, two.event)).toEqual(two.sky);
    expect(applyStarEvent(emptySky(), two.event)).toBeNull();
    expect(parseSky(JSON.parse(JSON.stringify(two.sky)))).toEqual(two.sky);
  });
});
