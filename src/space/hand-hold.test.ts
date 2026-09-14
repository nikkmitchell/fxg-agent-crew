import { describe, it, expect } from "vitest";
import { GIVE_UP_REACH, heldHand, HOLD_MS, NO_HAND } from "./hand-hold";
import type { Pose } from "../../shared/space-wire";

const pose = (x: number): Pose => ({
  p: { x, y: 1.1, z: 0 },
  q: { x: 0, y: 0, z: 0, w: 1 },
});

describe("heldHand", () => {
  it("reports a tracked hand as it is", () => {
    const held = heldHand(NO_HAND, pose(0.3), 1_000);
    expect(held.pose).toEqual(pose(0.3));
    expect(held.at).toBe(1_000);
  });

  it("holds the last measured pose through a dropout", () => {
    const tracked = heldHand(NO_HAND, pose(0.3), 1_000);
    const lost = heldHand(tracked, null, 3_000);
    expect(lost.pose).toEqual(pose(0.3));
    // The TIMESTAMP does not move. Holding refreshes nothing — otherwise a hand
    // lost once would be held for ever, one frame at a time.
    expect(lost.at).toBe(1_000);
  });

  it("keeps holding from the moment tracking was lost, not from the last frame", () => {
    let held = heldHand(NO_HAND, pose(0.3), 0);
    for (let now = 100; now < HOLD_MS; now += 100) held = heldHand(held, null, now);
    expect(held.pose).toEqual(pose(0.3));
    held = heldHand(held, null, HOLD_MS);
    expect(held.pose).toBeNull();
  });

  it("gives the hand up once the hold expires", () => {
    const tracked = heldHand(NO_HAND, pose(0.3), 1_000);
    expect(heldHand(tracked, null, 1_000 + HOLD_MS).pose).toBeNull();
  });

  it("never resurrects a hand that was already given up", () => {
    const gone = heldHand(heldHand(NO_HAND, pose(0.3), 0), null, HOLD_MS);
    expect(heldHand(gone, null, HOLD_MS + 1).pose).toBeNull();
  });

  it("takes a new measurement over a held one", () => {
    const held = heldHand(heldHand(NO_HAND, pose(0.3), 0), null, 500);
    const again = heldHand(held, pose(0.9), 600);
    expect(again.pose).toEqual(pose(0.9));
    expect(again.at).toBe(600);
  });
});

describe("a held hand moves with its owner", () => {
  // Board card saha-ing-fcaa774d: a right hand 3.3 m from its own head, frozen
  // in the room while its owner moved away from it.
  const head = (x: number, z: number): Pose => ({ p: { x, y: 1.6, z }, q: { x: 0, y: 0, z: 0, w: 1 } });
  const hand = (x: number, z: number): Pose => ({ p: { x, y: 1.1, z }, q: { x: 0, y: 0, z: 0, w: 1 } });

  it("keeps the hand where it was relative to the head when the person walks during a dropout", () => {
    const tracked = heldHand(NO_HAND, hand(0.3, -0.2), 0, HOLD_MS, head(0, 0));
    const held = heldHand(tracked, null, 500, HOLD_MS, head(2, 3));
    expect(held.pose!.p.x).toBeCloseTo(2.3, 9);
    expect(held.pose!.p.z).toBeCloseTo(2.8, 9);
    expect(Math.hypot(held.pose!.p.x - 2, held.pose!.p.z - 3)).toBeLessThan(1);
  });

  it("gives up a hand that was already implausibly far from the head", () => {
    const far = heldHand(NO_HAND, hand(GIVE_UP_REACH + 1, 0), 0, HOLD_MS, head(0, 0));
    expect(heldHand(far, null, 100, HOLD_MS, head(0, 0)).pose).toBeNull();
  });
});
