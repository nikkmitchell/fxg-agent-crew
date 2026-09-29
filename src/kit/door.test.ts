import { describe, expect, it } from "vitest";
import { DOOR_WIDTH, doorAddress, inDoorway, WALK_THROUGH } from "./door";

describe("a door between spaces (Sill's plan for spaces, C)", () => {
  it("leads only into a space, by its name, through saha.ing so your ticket comes too", () => {
    expect(doorAddress("xr.instruments", "https://saha.ing")).toBe("https://saha.ing/go/xr.instruments");
    expect(doorAddress("Meditation.AR", "https://saha.ing/")).toBe("https://saha.ing/go/meditation.ar");
    expect(doorAddress("lobby", "https://saha.ing")).toBe("https://saha.ing/");
    for (const bad of ["", "../../bff/x", "https://evil.example", "a b", "x/y"]) {
      expect(() => doorAddress(bad, "https://saha.ing")).toThrow(/space's name/);
    }
  });

  it("counts you as walking through only in the doorway, whichever way it faces", () => {
    const at: [number, number, number] = [2, 0, -3];
    expect(inDoorway(2, -3, at, 0)).toBe(true);
    expect(inDoorway(2 + DOOR_WIDTH / 2 - 0.01, -3, at, 0)).toBe(true);
    expect(inDoorway(2 + DOOR_WIDTH / 2 + 0.05, -3, at, 0)).toBe(false);
    expect(inDoorway(2, -3 + WALK_THROUGH + 0.05, at, 0)).toBe(false);
    // Turned a quarter: the doorway now runs along z, and you pass through along x.
    expect(inDoorway(2, -3 + DOOR_WIDTH / 2 - 0.01, at, Math.PI / 2)).toBe(true);
    expect(inDoorway(2 + WALK_THROUGH + 0.05, -3, at, Math.PI / 2)).toBe(false);
  });
});
