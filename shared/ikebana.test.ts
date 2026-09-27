import { describe, expect, it } from "vitest";
import { MOST_STEMS, REACH, applyVase, applyVaseEvent, emptyVase, parseVase } from "./ikebana.js";

const placed = (vase = emptyVase(), y = 0.3) => {
  const result = applyVase(vase, { action: "place", flower: 1, x: 0.1, y, z: 0 }, "Nikk2");
  if ("refused" in result) throw new Error(result.refused);
  return result;
};

describe("ikebana", () => {
  it("places a stem above the vase, within reach", () => {
    expect(placed().vase.stems).toEqual([{ flower: 1, x: 0.1, y: 0.3, z: 0, by: "Nikk2" }]);
    expect(applyVase(emptyVase(), { action: "place", flower: 1, x: 0, y: REACH + 0.1, z: 0 }, "a")).toHaveProperty("refused");
    expect(applyVase(emptyVase(), { action: "place", flower: 1, x: 0, y: -0.2, z: 0 }, "a")).toHaveProperty("refused");
    expect(applyVase(emptyVase(), { action: "place", flower: 99, x: 0, y: 0.2, z: 0 }, "a")).toHaveProperty("refused");
  });
  it("keeps few stems, and empties for everyone", () => {
    let vase = emptyVase();
    for (let i = 0; i < MOST_STEMS + 3; i += 1) vase = placed(vase).vase;
    expect(vase.stems).toHaveLength(MOST_STEMS);
    const emptied = applyVase(vase, { action: "empty" }, "Sill");
    expect("vase" in emptied && emptied.vase.stems).toEqual([]);
  });
  it("brings a client up to date, or asks it to read again", () => {
    const one = placed();
    const two = placed(one.vase, 0.2);
    expect(applyVaseEvent(applyVaseEvent(emptyVase(), one.event)!, two.event)).toEqual(two.vase);
    expect(applyVaseEvent(emptyVase(), two.event)).toBeNull();
    expect(parseVase(JSON.parse(JSON.stringify(two.vase)))).toEqual(two.vase);
  });
});
