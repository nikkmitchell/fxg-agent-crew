import { describe, expect, it } from "vitest";
import { ROOM_GUIDE, arrowTo, stepsTo } from "./room-guide.js";

describe("the room guide", () => {
  it("points the right way from where people arrive, facing the orb", () => {
    expect(arrowTo({ x: 0, z: 4.7 })).toBe("ahead");
    expect(arrowTo({ x: 0, z: 8.6 })).toBe("behind");
    expect(arrowTo({ x: 3, z: 6.2 })).toBe("right");
    expect(arrowTo({ x: -3, z: 6.2 })).toBe("left");
    expect(arrowTo({ x: 2, z: 4.2 })).toBe("ahead right");
  });

  it("gives a short, readable distance", () => {
    expect(stepsTo({ x: 0, z: 4.7 })).toBe(2);
    expect(stepsTo({ x: 0, z: 6.2 })).toBe(1);
  });

  it("lists each place once, with a short line about it", () => {
    const names = ROOM_GUIDE.map((one) => one.name);
    expect(new Set(names).size).toBe(names.length);
    for (const one of ROOM_GUIDE) expect(one.what.length).toBeLessThanOrEqual(40);
  });
});
