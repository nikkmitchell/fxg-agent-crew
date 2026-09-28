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

describe("nothing stands on anything else", () => {
  // Checked side by side in the test room and fine: a small pot beside a plinth.
  const neighbours = new Set(["Stillness tree / Reading stone"]);
  it("keeps pieces 0.6 m apart, which would have caught the panel landing on the incense (0.3 m) and the prayer wheel (0.5 m)", () => {
    const tooClose: string[] = [];
    ROOM_GUIDE.forEach((a, i) => ROOM_GUIDE.slice(i + 1).forEach((b) => {
      const pair = `${a.name} / ${b.name}`;
      if (neighbours.has(pair)) return;
      const apart = Math.hypot(a.x - b.x, a.z - b.z);
      // The labyrinth is a drawing on the floor that people walk on: only its path matters.
      const labyrinth = a.name === "Labyrinth" || b.name === "Labyrinth";
      const gap = labyrinth ? apart - 1.45 : apart;
      if (gap < (labyrinth ? 0.15 : 0.6)) tooClose.push(`${pair}: ${gap.toFixed(2)} m`);
    }));
    expect(tooClose).toEqual([]);
  });
});
