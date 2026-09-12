import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPEN_PANELS,
  DESK_CAPACITY,
  ROOM,
  STATIONS,
  deskFor,
  facingFor,
} from "./space-layout";

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

describe("the panel arc", () => {
  it("spaces panels far enough apart that they do not overlap", () => {
    const places = Object.values(STATIONS).map((station) => station.surface.position);
    for (let i = 1; i < places.length; i += 1) {
      const gap = Math.hypot(places[i].x - places[i - 1].x, places[i].z - places[i - 1].z);
      // Centre to centre must clear the panel width, or two panels intersect
      // and the room shows you a seam instead of a board.
      expect(gap).toBeGreaterThan(4.2);
    }
  });

  it("turns every panel to face the person standing in front of it", () => {
    for (const station of Object.values(STATIONS)) {
      const { position, rotationY } = station.surface;
      // A plane with no rotation faces +z, so its normal is (sin ry, cos ry).
      const normal = { x: Math.sin(rotationY), z: Math.cos(rotationY) };
      const toStand = {
        x: station.stand.x - position.x,
        z: station.stand.z - position.z,
      };
      const length = Math.hypot(toStand.x, toStand.z);
      const alignment = (normal.x * toStand.x + normal.z * toStand.z) / length;
      expect(alignment).toBeCloseTo(1, 5);
    }
  });

  it("puts the place you stand between the panel and the spawn point", () => {
    for (const station of Object.values(STATIONS)) {
      const panelToSpawn = Math.hypot(
        ROOM.spawn.x - station.surface.position.x,
        ROOM.spawn.z - station.surface.position.z,
      );
      const standToSpawn = Math.hypot(
        ROOM.spawn.x - station.stand.x,
        ROOM.spawn.z - station.stand.z,
      );
      expect(standToSpawn).toBeLessThan(panelToSpawn);
    }
  });

  it("offers every catalogue panel by default", () => {
    expect([...DEFAULT_OPEN_PANELS].sort()).toEqual(Object.keys(STATIONS).sort());
  });
});

describe("which way you face on arrival", () => {
  it("looks up the middle of the arc when everything is open", () => {
    expect(facingFor(DEFAULT_OPEN_PANELS)).toBeCloseTo(0, 6);
  });

  it("turns toward a single panel rather than leaving it off the edge", () => {
    for (const id of Object.keys(STATIONS)) {
      const yaw = facingFor([id]);
      // Face the panel: rotating the -Z axis by this yaw should point at it.
      const heading = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
      const toPanel = {
        x: STATIONS[id].surface.position.x - ROOM.spawn.x,
        z: STATIONS[id].surface.position.z - ROOM.spawn.z,
      };
      const length = Math.hypot(toPanel.x, toPanel.z);
      expect((heading.x * toPanel.x + heading.z * toPanel.z) / length).toBeCloseTo(1, 5);
    }
  });

  it("faces forward rather than anywhere arbitrary when nothing is open", () => {
    expect(facingFor([])).toBe(0);
  });

  it("ignores a panel id it does not recognise instead of steering by it", () => {
    expect(facingFor(["people", "whiteboard"])).toBeCloseTo(facingFor(["people"]), 6);
  });
});

describe("which panel you are looking at when you arrive", () => {
  it("puts the Board in the middle of the arc", () => {
    /**
     * This was a comment for a day and the comment went stale the moment it
     * mattered: adding the fifth panel pushed the Board off centre and nothing
     * noticed, because spacing and facing were tested and position in the row
     * was not. A claim about what somebody sees deserves a mechanism.
     */
    const spawn = ROOM.spawn;
    const bearing = (id: string) => {
      const p = STATIONS[id].surface.position;
      return Math.abs(Math.atan2(p.x - spawn.x, -(p.z - spawn.z)));
    };
    const nearest = Object.keys(STATIONS).reduce((best, id) =>
      bearing(id) < bearing(best) ? id : best,
    );
    expect(nearest).toBe("taskBoard");
  });

  it("keeps the two conversation panels next to each other", () => {
    // Said and Chat are both places words go. Splitting them across the arc
    // would mean turning your head one way to speak and the other to check it
    // arrived.
    const order = Object.keys(STATIONS);
    expect(Math.abs(order.indexOf("said") - order.indexOf("chat"))).toBe(1);
  });
});
