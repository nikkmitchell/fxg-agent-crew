import { describe, expect, it } from "vitest";
import { Presence } from "../space/presence.js";
import type { Pose } from "../../shared/space-wire.js";

/**
 * What the room knows about a person's body.
 *
 * The distinction under test throughout is between "not tracked" and "at the
 * default position". A hand that is not tracked must not be drawn at all, and
 * the only way to keep that true at the far end is to keep it null all the way
 * through here.
 */

const pose = (x: number, y: number, z: number): Pose => ({
  p: { x, y, z },
  q: { x: 0, y: 0, z: 0, w: 1 },
});

describe("bodies in the registry", () => {
  it("knows nothing about a new arrival's head or hands", () => {
    const presence = new Presence();
    const occupant = presence.join("nikk", "human");
    // Not a head at the origin, and not hands by their sides. Nothing.
    expect(occupant.head).toBeNull();
    expect(occupant.hands).toEqual({ left: null, right: null });
  });

  it("records a head and hands when they are reported", () => {
    const presence = new Presence();
    presence.join("nikk", "human");
    presence.moveSelf("nikk", { x: 1, y: 0, z: 1 }, 0, {
      head: pose(1, 1.6, 1),
      hands: { left: pose(0.8, 1.1, 0.9), right: pose(1.2, 1.1, 0.9) },
    });

    const occupant = presence.find("nikk")!;
    expect(occupant.head?.p.y).toBe(1.6);
    expect(occupant.hands.right?.p.x).toBe(1.2);
  });

  it("drops a hand the moment it stops being tracked", () => {
    // Somebody sets a controller down. The hand must go, not hover where it was
    // abandoned — a hand left floating is a claim about where somebody's hand
    // is, and it is false.
    const presence = new Presence();
    presence.join("nikk", "human");
    presence.moveSelf("nikk", { x: 0, y: 0, z: 0 }, 0, {
      hands: { left: pose(0, 1, 0), right: pose(0, 1, 0) },
    });
    presence.moveSelf("nikk", { x: 0, y: 0, z: 0 }, 0, {
      hands: { left: null, right: pose(0, 1, 0) },
    });

    expect(presence.find("nikk")!.hands.left).toBeNull();
    expect(presence.find("nikk")!.hands.right).not.toBeNull();
  });

  it("leaves a known head alone when a client says nothing about it", () => {
    // Silence is not a correction. An older client that only sends a position
    // should not erase what a newer one already told us.
    const presence = new Presence();
    presence.join("nikk", "human");
    presence.moveSelf("nikk", { x: 0, y: 0, z: 0 }, 0, { head: pose(0, 1.6, 0) });
    presence.moveSelf("nikk", { x: 1, y: 0, z: 1 }, 0);

    expect(presence.find("nikk")!.head?.p.y).toBe(1.6);
  });

  it("gives an agent no head and no hands", () => {
    // An agent's position comes from the audit trail. It has no head to track,
    // and the renderer places one for it rather than the server inventing one.
    const presence = new Presence();
    presence.sendTo("Plumbline", "agent", { x: 0, y: 0, z: -1 }, "commented on a card");
    const occupant = presence.find("Plumbline")!;
    expect(occupant.head).toBeNull();
    expect(occupant.hands).toEqual({ left: null, right: null });
  });
});
