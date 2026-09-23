import { describe, expect, it } from "vitest";
import { GO_SIZES, defaultGoItem, type GoRoomItem } from "./room-items.js";
import { goDeckWidth, goSeat, goWorld } from "./go-layout.js";

const table = (size: number, seats: number, over: Partial<GoRoomItem> = {}): GoRoomItem => ({
  ...defaultGoItem("t"), size: size as GoRoomItem["size"], colours: Array.from({ length: seats }, (_, i) => `c${i}`), ...over,
});

/** The way an avatar with this yaw is looking, on the floor: it faces -Z. */
const looking = (facing: number) => ({ x: -Math.sin(facing), z: -Math.cos(facing) });

describe("where an agent playing a colour stands", () => {
  it("0.4 m off the desk, square to its edge, at every size and seating", () => {
    for (const size of GO_SIZES) {
      for (let seats = 2; seats <= 8; seats += 1) {
        const item = table(size, seats);
        const half = goDeckWidth(size, seats) / 2;
        for (let colour = 0; colour < seats; colour += 1) {
          const { at } = goSeat(item, colour);
          expect(Math.max(Math.abs(at.x - item.position.x), Math.abs(at.z - item.position.z)), `${size}x${size} ${seats} seats, colour ${colour}`)
            .toBeCloseTo(half + 0.4, 9);
        }
      }
    }
  });

  it("faces the middle of the table", () => {
    const item = table(9, 3, { position: { x: 2, y: 0, z: -1, rotationY: 0.7 }, scale: 1.4 });
    const centre = goWorld({ x: 0, y: 0, z: 0 }, item);
    for (let colour = 0; colour < 3; colour += 1) {
      const { at, facing } = goSeat(item, colour);
      const toward = { x: centre.x - at.x, z: centre.z - at.z };
      const length = Math.hypot(toward.x, toward.z);
      const look = looking(facing);
      expect(look.x * toward.x / length + look.z * toward.z / length).toBeCloseTo(1, 9);
    }
  });

  it("puts two players on opposite sides, left and right — leaving the near side to people", () => {
    const item = table(9, 2);
    const black = goSeat(item, 0).at, white = goSeat(item, 1).at;
    expect(black.x).toBeLessThan(item.position.x);
    expect(white.x).toBeGreaterThan(item.position.x);
    expect(black.z).toBeCloseTo(item.position.z, 9);
    expect(white.z).toBeCloseTo(item.position.z, 9);
  });

  it("follows the table when it is moved, turned or resized, and stands on the floor", () => {
    const moved = table(9, 2, { position: { x: 3, y: 0.4, z: 5, rotationY: Math.PI / 2 }, scale: 2 });
    const { at } = goSeat(moved, 0);
    expect(at.y).toBe(0);
    const still = goSeat(table(9, 2), 0).at;
    const reach = Math.hypot(still.x - (-1.15), still.z - 1.8);
    expect(Math.hypot(at.x - 3, at.z - 5)).toBeCloseTo(reach * 2, 6);
  });

  it("gives every seat its own place", () => {
    const item = table(19, 8);
    const places = Array.from({ length: 8 }, (_, colour) => goSeat(item, colour).at);
    for (let a = 0; a < 8; a += 1) {
      for (let b = a + 1; b < 8; b += 1) expect(Math.hypot(places[a].x - places[b].x, places[a].z - places[b].z)).toBeGreaterThan(0.5);
    }
  });
});
