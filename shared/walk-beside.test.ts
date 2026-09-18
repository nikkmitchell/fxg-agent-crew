import { describe, expect, it } from "vitest";
import {
  WALK_BESIDE,
  apparentVelocity,
  besideSpot,
  defaultSide,
  forwardOf,
  leftOf,
} from "./walk-beside.js";

/**
 * Walking beside somebody, and the two ways it goes wrong.
 *
 * The chase: aim where they were and you arrive after they have gone. The
 * throw: treat a teleport as speed and you fling the follower across the room.
 */

const close = (actual: number, expected: number, within = 1e-9) =>
  expect(Math.abs(actual - expected)).toBeLessThan(within);

describe("the facing convention", () => {
  it("faces -Z at facing 0, as shared/agent-home.ts documents", () => {
    const forward = forwardOf(0);
    close(forward.x, 0);
    close(forward.z, -1);
  });

  it("puts left at -X when facing -Z, which is left for a right-handed Y-up frame", () => {
    const left = leftOf(0);
    close(left.x, -1);
    close(left.z, 0);
  });

  it("keeps left perpendicular to forward at every angle", () => {
    for (const facing of [0, 0.3, 1, Math.PI / 2, Math.PI, -2.2, 5.7]) {
      const forward = forwardOf(facing);
      const left = leftOf(facing);
      close(forward.x * left.x + forward.z * left.z, 0, 1e-12);
      close(Math.hypot(left.x, left.z), 1, 1e-12);
    }
  });
});

describe("where to stand", () => {
  const still = { at: { x: 0, y: 0, z: 0 }, facing: 0 };

  it("stands one gap to the side and slightly back", () => {
    const spot = besideSpot(still, "left");
    close(spot.x, -WALK_BESIDE.gap);
    // Facing -Z means "slightly back" is +Z.
    close(spot.z, WALK_BESIDE.behind);
  });

  it("puts left and right on opposite sides of the same person", () => {
    const left = besideSpot(still, "left");
    const right = besideSpot(still, "right");
    close(left.x, -right.x);
    close(left.z, right.z);
  });

  it("never aims at the target's own feet", () => {
    for (const facing of [0, 1.1, Math.PI, -0.7]) {
      for (const side of ["left", "right"] as const) {
        const spot = besideSpot({ at: { x: 2, y: 0, z: -3 }, facing }, side);
        expect(Math.hypot(spot.x - 2, spot.z + 3)).toBeGreaterThan(0.5);
      }
    }
  });

  it("stays flat on the floor", () => {
    expect(besideSpot(still, "left", { x: 1, y: 99, z: 1 }).y).toBe(0);
  });
});

describe("leading a moving target", () => {
  /**
   * THE CHASE, stated as an assertion. Somebody walking away from the follower
   * must be aimed at ahead of where they are, or every leg of the walk ends
   * behind them.
   */
  it("aims ahead of somebody who is moving", () => {
    const walking = { at: { x: 0, y: 0, z: 0 }, facing: 0 };
    const velocity = { x: 0, y: 0, z: -WALK_BESIDE.jumpSpeed / 2 };
    const led = besideSpot(walking, "left", velocity);
    const standing = besideSpot(walking, "left");
    expect(led.z).toBeLessThan(standing.z);
    close(led.z, standing.z + velocity.z * WALK_BESIDE.lead);
  });

  it("does not lead somebody standing still", () => {
    const still = { at: { x: 1, y: 0, z: 1 }, facing: 2 };
    expect(besideSpot(still, "right", { x: 0, y: 0, z: 0 }))
      .toEqual(besideSpot(still, "right"));
  });
});

describe("apparent velocity", () => {
  const at = (x: number, z: number, atMs: number) => ({ at: { x, y: 0, z }, atMs });

  it("is null with nothing to compare against", () => {
    expect(apparentVelocity(null, at(0, 0, 1000))).toBeNull();
  });

  it("measures an ordinary walk", () => {
    const velocity = apparentVelocity(at(0, 0, 1000), at(0, -1.4, 2000));
    close(velocity!.z, -1.4);
    close(velocity!.x, 0);
  });

  /**
   * WAFFLE'S MEASUREMENT, as a test. A person who jumps several metres between
   * samples is not moving at 30 m/s, and leading that number would throw the
   * follower far past them — the failure that made a re-computed home a chase.
   */
  it("refuses to call a teleport a speed", () => {
    expect(apparentVelocity(at(0, 0, 1000), at(0, -30, 2000))).toBeNull();
  });

  it("treats a jitter as standing still rather than a direction", () => {
    const velocity = apparentVelocity(at(0, 0, 1000), at(0.001, 0.001, 2000));
    expect(velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("is null for a zero or backwards interval, rather than infinite", () => {
    expect(apparentVelocity(at(0, 0, 1000), at(1, 1, 1000))).toBeNull();
    expect(apparentVelocity(at(0, 0, 2000), at(1, 1, 1000))).toBeNull();
  });

  it("carries no Infinity or NaN into a position", () => {
    const velocity = apparentVelocity(at(0, 0, 1000), at(0.5, 0.5, 1016));
    const spot = besideSpot({ at: { x: 0, y: 0, z: 0 }, facing: 0.4 }, "left", velocity);
    expect(Number.isFinite(spot.x) && Number.isFinite(spot.z)).toBe(true);
  });
});

describe("which side, when nobody says", () => {
  it("is stable for the same pair, so a follower does not swap shoulders", () => {
    expect(defaultSide("Nightjar", "Nikk2")).toBe(defaultSide("Nightjar", "Nikk2"));
  });

  it("ignores case, because the room does", () => {
    expect(defaultSide("nightjar", "nikk2")).toBe(defaultSide("Nightjar", "Nikk2"));
  });

  it("does not put every follower on one side", () => {
    const followers = ["Nightjar", "Sill", "Plumbline", "Inkstone", "Lumenfold", "Waffle", "Corvid"];
    const sides = new Set(followers.map((who) => defaultSide(who, "Nikk2")));
    expect(sides.size).toBe(2);
  });
});
