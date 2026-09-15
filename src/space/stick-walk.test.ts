import { describe, expect, it } from "vitest";
import { STICK_DEAD_ZONE, stickStep } from "./stick-walk";

const at = (yaw: number) => (axes: { x: number; y: number }, dt = 1) => stickStep(axes, yaw, 2, dt);

describe("walking with a thumbstick", () => {
  const facingBoards = at(0);

  /**
   * THE REASON THIS FILE EXISTS. `useXRControllerLocomotion` moves you for any
   * reading at all — `xAxis != 0 || yAxis != 0` — so a controller lying on a
   * desk with a worn stick walks you across the room, and a controller nobody
   * is holding is the normal state of a controller.
   */
  it("ignores a stick resting slightly off centre", () => {
    expect(facingBoards({ x: 0, y: 0 })).toEqual({ x: 0, z: 0 });
    expect(facingBoards({ x: 0.02, y: -0.03 })).toEqual({ x: 0, z: 0 });
    expect(facingBoards({ x: 0.1, y: 0.1 }), "0.14 of travel, still inside").toEqual({ x: 0, z: 0 });
  });

  it("moves for a push somebody meant", () => {
    const step = facingBoards({ x: 0, y: -1 });
    expect(step.z, "forward is −z when facing the boards").toBeLessThan(-0.1);
    expect(step.x).toBeCloseTo(0, 9);
  });

  it("starts from a standstill at the edge of the dead zone rather than jumping", () => {
    const edge = facingBoards({ x: 0, y: -(STICK_DEAD_ZONE + 0.001) });
    expect(Math.hypot(edge.x, edge.z), "barely moving").toBeLessThan(0.01);
    const half = facingBoards({ x: 0, y: -(STICK_DEAD_ZONE + (1 - STICK_DEAD_ZONE) / 2) });
    expect(Math.hypot(half.x, half.z), "half the usable travel, half the speed").toBeCloseTo(1, 2);
    const full = facingBoards({ x: 0, y: -1 });
    expect(Math.hypot(full.x, full.z), "full push, full speed").toBeCloseTo(2, 9);
  });

  it("does not exceed full speed in the corners, where a stick reads past 1", () => {
    const corner = facingBoards({ x: 0.95, y: -0.95 });
    expect(Math.hypot(corner.x, corner.z)).toBeCloseTo(2, 9);
  });

  it("scales with the frame, not with the frame rate", () => {
    const long = facingBoards({ x: 0, y: -1 }, 1 / 30);
    const short = facingBoards({ x: 0, y: -1 }, 1 / 60);
    expect(Math.hypot(long.x, long.z)).toBeCloseTo(2 * Math.hypot(short.x, short.z), 9);
  });

  describe("goes where the player is looking", () => {
    it("forward follows the head's heading", () => {
      // Turned a quarter left: forward is now −x.
      const step = at(Math.PI / 2)({ x: 0, y: -1 });
      expect(step.x).toBeCloseTo(-2, 9);
      expect(step.z).toBeCloseTo(0, 9);
    });

    it("sideways is sideways to the head, not to the room", () => {
      const step = at(Math.PI / 2)({ x: 1, y: 0 });
      // Facing −x, so the player's right is −z.
      expect(step.z).toBeCloseTo(-2, 9);
      expect(step.x).toBeCloseTo(0, 9);
    });

    it("pushing right steps right when facing the boards", () => {
      const step = facingBoards({ x: 1, y: 0 });
      expect(step.x).toBeCloseTo(2, 9);
      expect(step.z).toBeCloseTo(0, 9);
    });

    /**
     * The library applies the full camera quaternion — pitch and roll included
     * — and then throws away the y it produces, so looking at your feet
     * shortens a forward push and looking at the ceiling lengthens it. Heading
     * only here, which is why there is no pitch to pass in.
     */
    it("takes no pitch at all, so looking down does not change your speed", () => {
      const level = facingBoards({ x: 0, y: -1 });
      expect(Math.hypot(level.x, level.z)).toBeCloseTo(2, 9);
    });
  });
});
