import { describe, expect, it } from "vitest";
import { DESK_CAPACITY, ROOM, STATIONS, deskFor } from "./space-layout";

/**
 * The layout has to agree with itself.
 *
 * `Presence.clampToRoom` pulls anybody outside ROOM back inside it. So a
 * position defined in this file that falls outside ROOM does not produce an
 * error — it produces figures silently stacked on the boundary, standing inside
 * one another, which is exactly what happened when the resting places were put
 * at z = 7 inside a room only 14 deep.
 */

/** The same margin `clampToRoom` uses, so "inside" means the same thing here. */
const MARGIN = 0.5;

const insideTheRail = (at: { x: number; z: number }) =>
  Math.abs(at.x) <= ROOM.width / 2 - MARGIN && Math.abs(at.z) <= ROOM.depth / 2 - MARGIN;

describe("every fixed position is somewhere a person can actually stand", () => {
  it("puts the spawn point inside the rail", () => {
    expect(insideTheRail(ROOM.spawn), `spawn ${JSON.stringify(ROOM.spawn)}`).toBe(true);
  });

  it("puts every panel and its standing spot inside the rail", () => {
    for (const station of Object.values(STATIONS)) {
      expect(insideTheRail(station.stand), `${station.id} stand`).toBe(true);
      expect(insideTheRail(station.surface.position), `${station.id} surface`).toBe(true);
    }
  });

  it("puts every resting place inside the rail", () => {
    // Every slot the hash can produce, not just the ones today's actors land on.
    const seen = new Set<string>();
    for (let i = 0; i < 4_000 && seen.size < DESK_CAPACITY; i += 1) {
      const at = deskFor(`actor-${i}`);
      seen.add(`${at.x},${at.z}`);
      expect(insideTheRail(at), `desk for actor-${i}: ${JSON.stringify(at)}`).toBe(true);
    }
    // And the hash really does reach all of them — a desk grid that only ever
    // hands out two slots would pass the check above while stacking everyone.
    expect(seen.size).toBe(DESK_CAPACITY);
  });

  it("keeps resting places clear of the spawn point", () => {
    // Somebody arriving must not appear inside a figure that is already there.
    for (let i = 0; i < 200; i += 1) {
      const at = deskFor(`actor-${i}`);
      const gap = Math.hypot(at.x - ROOM.spawn.x, at.z - ROOM.spawn.z);
      expect(gap, `desk for actor-${i} is ${gap.toFixed(2)}m from the spawn point`).toBeGreaterThan(0.8);
    }
  });
});
