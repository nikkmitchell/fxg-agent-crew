import { describe, expect, it } from "vitest";
import { MAX_POINTS, MAX_STROKES, TRAY, applyGarden, applyGardenEvent, cleanStroke, emptyGarden, parseGarden, rakeTines, type Garden } from "./garden.js";

let n = 0;
const id = () => `s${(n += 1)}`;
const line = (count = 5): [number, number][] => Array.from({ length: count }, (_, i) => [-0.4 + i * 0.05, 0]);

function applied(garden: Garden, change: Parameters<typeof applyGarden>[1], by = "Nikk2") {
  const result = applyGarden(garden, change, by, id);
  if ("refused" in result) throw new Error(result.refused);
  return result;
}

describe("the zen sand garden (Nikk 5483, 5491)", () => {
  it("keeps a raked stroke, thinned, inside the tray", () => {
    expect(cleanStroke([[0, 0], [0.001, 0], [0.05, 0], ["x", 1], [5, 5], [0.1, 0]])).toEqual([[0, 0], [0.05, 0], [0.1, 0]]);
    expect(cleanStroke([[0, 0]])).toBeNull();
    expect(cleanStroke("sand")).toBeNull();
    expect(cleanStroke(Array.from({ length: 999 }, (_, i) => [-0.5 + (i % 90) * 0.012, 0]))!.length).toBeLessThanOrEqual(MAX_POINTS);
  });

  it("remembers every stroke until the sand is smoothed, and says who smoothed it", () => {
    let garden = emptyGarden();
    garden = applied(garden, { action: "stroke", points: line() }).garden;
    garden = applied(garden, { action: "stroke", points: line() }, "baiwei2").garden;
    expect(garden.strokes.map((stroke) => stroke.by)).toEqual(["Nikk2", "baiwei2"]);
    expect(garden.revision).toBe(2);
    garden = applied(garden, { action: "smooth" }, "Sill").garden;
    expect(garden.strokes).toEqual([]);
    expect(garden.smoothedBy).toBe("Sill");
  });

  it("rakes over the oldest strokes once it is full", () => {
    let garden: Garden = { ...emptyGarden(), strokes: Array.from({ length: MAX_STROKES }, (_, i) => ({ id: `old${i}`, by: "x", points: line() })) };
    const result = applied(garden, { action: "stroke", points: line() });
    garden = result.garden;
    expect(garden.strokes).toHaveLength(MAX_STROKES);
    expect(garden.strokes[0].id).toBe("old1");
    expect(result.event).toMatchObject({ kind: "stroke", dropped: 1 });
  });

  it("moves a stone within the sand and refuses one out of it", () => {
    const garden = applied(emptyGarden(), { action: "stone", index: 1, x: 0.1, z: -0.1 }).garden;
    expect(garden.stones[1]).toMatchObject({ x: 0.1, z: -0.1 });
    expect(applyGarden(garden, { action: "stone", index: 1, x: TRAY.width, z: 0 }, "a", id)).toHaveProperty("refused");
    expect(applyGarden(garden, { action: "stone", index: 9, x: 0, z: 0 }, "a", id)).toHaveProperty("refused");
  });

  it("brings a client up to date from the events, or asks it to read again when it missed one", () => {
    const start = emptyGarden();
    const first = applied(start, { action: "stroke", points: line() });
    const second = applied(first.garden, { action: "stone", index: 0, x: 0, z: 0 });
    const caughtUp = applyGardenEvent(applyGardenEvent(start, first.event)!, second.event)!;
    expect(caughtUp).toEqual(second.garden);
    expect(applyGardenEvent(start, second.event)).toBeNull();
    expect(applyGardenEvent(second.garden, first.event)).toBe(second.garden);
  });

  it("reads back what it stored, and mends a garden with the wrong number of stones", () => {
    const garden = applied(emptyGarden(), { action: "stroke", points: line() }).garden;
    expect(parseGarden(JSON.parse(JSON.stringify(garden)))).toEqual(garden);
    expect(parseGarden({ strokes: [], stones: [], revision: 3 })!.stones).toHaveLength(3);
    expect(parseGarden("nope")).toBeNull();
  });

  it("draws three parallel grooves for one path", () => {
    const tines = rakeTines([[0, 0], [0.1, 0]], 0.02);
    expect(tines).toHaveLength(3);
    expect(tines[0][0][1]).toBeCloseTo(-0.02);
    expect(tines[1][0][1]).toBeCloseTo(0);
    expect(tines[2][0][1]).toBeCloseTo(0.02);
  });
});
