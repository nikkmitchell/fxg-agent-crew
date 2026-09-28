import { describe, expect, it } from "vitest";
import { THOUSAND, applyCraneEvent, applyCranes, craneAt, noCranes, type Cranes } from "./cranes";

describe("a thousand cranes", () => {
  it("folds one at a time, and keeps the paper", () => {
    const result = applyCranes(noCranes(), { action: "fold", paper: 3 }, "Nikk");
    expect("cranes" in result && result.cranes.cranes).toEqual([{ paper: 3, by: "Nikk" }]);
  });
  it("refuses the 1001st, and releases only at a thousand", () => {
    const full: Cranes = { cranes: Array.from({ length: THOUSAND }, () => ({ paper: 0, by: "x" })), revision: 5 };
    expect("refused" in applyCranes(full, { action: "fold", paper: 0 }, "x")).toBe(true);
    expect("refused" in applyCranes(noCranes(), { action: "release" }, "x")).toBe(true);
    const released = applyCranes(full, { action: "release" }, "x");
    expect("cranes" in released && released.cranes.cranes).toEqual([]);
  });
  it("applies events in order and asks to re-read on a gap", () => {
    const one = applyCraneEvent(noCranes(), { kind: "fold", crane: { paper: 1, by: "a" }, revision: 1 });
    expect(one?.cranes).toHaveLength(1);
    expect(applyCraneEvent(noCranes(), { kind: "fold", crane: { paper: 1, by: "a" }, revision: 3 })).toBeNull();
  });
  it("gives every one of the thousand its own place overhead", () => {
    const seen = new Set<string>();
    for (let i = 0; i < THOUSAND; i += 1) {
      const at = craneAt(i);
      expect(at.y).toBeGreaterThan(1.8);
      seen.add(`${at.x.toFixed(3)},${at.y.toFixed(3)},${at.z.toFixed(3)}`);
    }
    expect(seen.size).toBe(THOUSAND);
  });
});
