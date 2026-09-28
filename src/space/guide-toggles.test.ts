import { describe, expect, it } from "vitest";
import { rowAt } from "./RoomGuideSign";
import { TOGGLEABLE } from "../../shared/room-pieces";

describe("tapping the guide board's toggle list", () => {
  it("finds the row under the tap, top-left first, then down the second column", () => {
    const rows = Math.ceil(TOGGLEABLE.length / 2);
    expect(rowAt(0.1, 0.999)).toBe(0);
    expect(rowAt(0.1, 1 - 1.5 / rows)).toBe(1);
    expect(rowAt(0.6, 0.999)).toBe(rows);
    expect(rowAt(0.9, 0.001)).toBe(TOGGLEABLE.length - 1 >= 2 * rows - 1 ? 2 * rows - 1 : null);
  });
  it("finds nothing past the last entry", () => {
    const rows = Math.ceil(TOGGLEABLE.length / 2);
    if (TOGGLEABLE.length % 2 === 1) expect(rowAt(0.9, 0.001)).toBeNull();
    expect(rows * 2).toBeGreaterThanOrEqual(TOGGLEABLE.length);
  });
});
