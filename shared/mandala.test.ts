import { describe, expect, it } from "vitest";
import { FOLDS, MAX_POURS, SANDS, applyMandala, applyMandalaEvent, cleanPour, emptyMandala, mirrored, parseMandala, type Mandala } from "./mandala.js";

let n = 0;
const id = () => `p${(n += 1)}`;
const arc: [number, number][] = [[0.5, 0.1], [0.5, 0.2], [0.55, 0.3]];

function applied(mandala: Mandala, change: Parameters<typeof applyMandala>[1], by = "Nikk2") {
  const result = applyMandala(mandala, change, by, id);
  if ("refused" in result) throw new Error(result.refused);
  return result;
}

describe("the sand mandala", () => {
  it("keeps a pour's points on the plate, thinned, with a known sand", () => {
    expect(cleanPour([[0.5, 0], [0.5, 0.001], [2, 1], ["x", 0], [0.5, 0.2]])).toEqual([[0.5, 0], [0.5, 0.2]]);
    expect(cleanPour([[5, 5]])).toBeNull();
    expect(applyMandala(emptyMandala(), { action: "pour", colour: SANDS.length, points: arc }, "a", id)).toHaveProperty("refused");
  });

  it("builds up pour by pour, and a sweep clears it for everyone and remembers its colours", () => {
    let mandala = applied(emptyMandala(), { action: "pour", colour: 1, points: arc }).mandala;
    mandala = applied(mandala, { action: "pour", colour: 3, points: arc }, "baiwei2").mandala;
    expect(mandala.pours).toHaveLength(2);
    const swept = applied(mandala, { action: "sweep" }, "Sill");
    expect(swept.mandala.pours).toEqual([]);
    expect(swept.mandala.sweeps).toBe(1);
    expect(swept.mandala.lastSwept).toEqual({ by: "Sill", colours: [1, 3] });
    expect(applyMandala(swept.mandala, { action: "sweep" }, "a", id)).toHaveProperty("refused");
  });

  it("lets the oldest pours sink once the plate is full", () => {
    const full: Mandala = { ...emptyMandala(), pours: Array.from({ length: MAX_POURS }, (_, i) => ({ id: `o${i}`, by: "x", colour: 0, points: arc })) };
    const result = applied(full, { action: "pour", colour: 2, points: arc });
    expect(result.mandala.pours).toHaveLength(MAX_POURS);
    expect(result.event).toMatchObject({ kind: "pour", dropped: 1 });
  });

  it("brings a client up to date from the events, or asks it to read again", () => {
    const start = emptyMandala();
    const one = applied(start, { action: "pour", colour: 0, points: arc });
    const two = applied(one.mandala, { action: "sweep" });
    expect(applyMandalaEvent(applyMandalaEvent(start, one.event)!, two.event)).toEqual(two.mandala);
    expect(applyMandalaEvent(start, two.event)).toBeNull();
    expect(parseMandala(JSON.parse(JSON.stringify(two.mandala)))).toEqual(two.mandala);
  });

  it("repeats every grain round the plate and mirrors it within each fold", () => {
    const places = mirrored([0.5, 0.1]);
    expect(places).toHaveLength(FOLDS * 2);
    for (const [x, y] of places) expect(Math.hypot(x, y)).toBeCloseTo(0.5);
  });
});
