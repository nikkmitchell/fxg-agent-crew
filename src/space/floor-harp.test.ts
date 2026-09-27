import { describe, expect, it } from "vitest";
import { HARP_AT, HARP_NOTES, stripAt } from "./FloorHarp";

describe("the floor harp", () => {
  it("knows which strip a foot is on, and the gaps and the floor around it are silent", () => {
    const width = HARP_NOTES.length * 0.23 - 0.03;
    expect(stripAt(HARP_AT.x - width / 2 + 0.1, HARP_AT.z)).toBe(0);
    expect(stripAt(HARP_AT.x + width / 2 - 0.1, HARP_AT.z)).toBe(HARP_NOTES.length - 1);
    expect(stripAt(HARP_AT.x - width / 2 + 0.215, HARP_AT.z)).toBeNull();
    expect(stripAt(HARP_AT.x, HARP_AT.z + 2)).toBeNull();
    expect(stripAt(HARP_AT.x + 5, HARP_AT.z)).toBeNull();
  });
});
