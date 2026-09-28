import { describe, expect, it } from "vitest";
import { MOST_STONES, applyCairn, applyCairnEvent, emptyCairn, parseCairn, stoneHeights } from "./cairn.js";

const add = (cairn = emptyCairn(), seed = 0.3) => {
  const result = applyCairn(cairn, { action: "add", seed }, "Nikk2");
  if ("refused" in result) throw new Error(result.refused);
  return result;
};

describe("the cairn", () => {
  it("grows a stone at a time, tapering as it rises, and gives the top stone back", () => {
    let cairn = emptyCairn();
    for (let i = 0; i < 8; i += 1) cairn = add(cairn, i / 8).cairn;
    expect(cairn.stones).toHaveLength(8);
    const heights = stoneHeights(cairn.stones);
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
    const lifted = applyCairn(cairn, { action: "lift" }, "x");
    expect("cairn" in lifted && lifted.cairn.stones).toHaveLength(7);
  });
  it("stops at its tallest, and has nothing to lift when bare", () => {
    let cairn = emptyCairn();
    for (let i = 0; i < MOST_STONES; i += 1) cairn = add(cairn, i / 100).cairn;
    expect(applyCairn(cairn, { action: "add", seed: 0.5 }, "x")).toHaveProperty("refused");
    expect(applyCairn(emptyCairn(), { action: "lift" }, "x")).toHaveProperty("refused");
  });
  it("brings a client up to date, or asks it to read again", () => {
    const one = add();
    const two = add(one.cairn, 0.7);
    expect(applyCairnEvent(applyCairnEvent(emptyCairn(), one.event)!, two.event)).toEqual(two.cairn);
    expect(applyCairnEvent(emptyCairn(), two.event)).toBeNull();
    expect(parseCairn(JSON.parse(JSON.stringify(two.cairn)))).toEqual(two.cairn);
  });
});
