import { describe, expect, it } from "vitest";
import { isFree, PERSONAL_SPACE, standingRoomNear } from "./standing-room";

const at = (x: number, z: number) => ({ x, y: 0, z });
const apart = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe("finding somewhere to stand", () => {
  it("leaves somebody where they were asked to go when it is empty", () => {
    // Nothing moves without cause. An agent that shuffles sideways for no
    // reason is motion the audit trail cannot explain.
    const target = at(1, 3.6);
    expect(standingRoomNear(target, [])).toEqual(target);
  });

  it("stands the arrival clear of somebody already there", () => {
    // The actual bug: `atPanel` hands every actor the same point, so two
    // agents at the task board were given identical coordinates.
    const board = at(0.21, 3.9);
    const spot = standingRoomNear(board, [board], "Sill");
    expect(apart(spot, board)).toBeGreaterThanOrEqual(PERSONAL_SPACE);
  });

  it("does not move the person already standing there", () => {
    // The rule the room is built on: a connected person's position comes from
    // their own headset. The newcomer goes around; the occupant is untouched.
    // Asserted by the shape of the call — `taken` is read, never returned —
    // so a future version that "tidied" both would have to change this test.
    const board = at(0.21, 3.9);
    const taken = [board];
    const before = { ...taken[0] };
    standingRoomNear(board, taken, "Sill");
    expect(taken[0]).toEqual(before);
  });

  it("keeps three agents and a human all clear of each other", () => {
    // The case Nikk actually saw, plus the human. Placed one at a time, each
    // seeing everybody already placed, which is how `sendTo` calls it.
    const board = at(0.21, 3.9);
    const placed: { x: number; z: number }[] = [at(0.3, 4.0)]; // a person, standing there first
    for (const who of ["Sill", "Plumbline", "Inkstone"]) {
      placed.push(standingRoomNear(board, [...placed], who));
    }
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(apart(placed[i], placed[j]), `${i} vs ${j}`).toBeGreaterThanOrEqual(PERSONAL_SPACE);
      }
    }
  });

  it("stays put across repeated asks, so nobody jitters", () => {
    // The audit poller asks again on every row. If the answer wandered, an
    // agent would drift sideways each time it commented on a card.
    const board = at(0.21, 3.9);
    const others = [board];
    const first = standingRoomNear(board, others, "Sill");
    for (let i = 0; i < 5; i += 1) {
      expect(standingRoomNear(board, others, "Sill")).toEqual(first);
    }
  });

  it("keeps two actors apart even when they prefer the SAME alternative", () => {
    // "Sill" and "Plumbline" hash to the same slot, which is unavoidable: eight
    // slots, unbounded names. So the seed is not what makes this safe — being
    // told where the other one is going is. Placed in sequence, as `sendTo`
    // does, the second sees the first's claim and moves on.
    const board = at(0.21, 3.9);
    const first = standingRoomNear(board, [board], "Sill");
    const second = standingRoomNear(board, [board, first], "Plumbline");
    expect(apart(first, second)).toBeGreaterThanOrEqual(PERSONAL_SPACE);
    expect(apart(second, board)).toBeGreaterThanOrEqual(PERSONAL_SPACE);
  });

  it("stays near the panel rather than wandering off to find space", () => {
    // Being displaced should read as standing beside the board, not as having
    // left the room. Three rings is the cap, so 2.7 m is the worst case.
    const board = at(0.21, 3.9);
    const spot = standingRoomNear(board, [board], "Sill");
    expect(apart(spot, board)).toBeLessThanOrEqual(2.8);
  });

  it("checks against the clamped candidate, not the unclamped one", () => {
    // The ROOM comment records a clamp that "pulled every idle figure onto the
    // same point on the boundary and they stood inside one another". A clamp
    // applied after the free check would reintroduce exactly that.
    const pinned = at(5, 5);
    const clamp = () => pinned; // a clamp that sends everything to one place
    const spot = standingRoomNear(at(0, 0), [pinned], "Sill", clamp);
    // Every candidate clamps onto an occupied point, so none is free and the
    // target comes back — rather than the occupied clamped point being handed
    // out as if it were free.
    expect(spot).toEqual(at(0, 0));
  });

  it("gives up on the target rather than teleporting somebody somewhere empty", () => {
    // A ring of occupied space all round. Standing too close is a problem
    // somebody can see and report; being moved across the room silently is not.
    const target = at(0, 0);
    const crowd: { x: number; z: number }[] = [];
    for (let r = 0; r <= 3; r += 1) {
      for (let a = 0; a < 24; a += 1) {
        const angle = (a / 24) * Math.PI * 2;
        crowd.push({ x: Math.cos(angle) * 0.9 * r, z: Math.sin(angle) * 0.9 * r });
      }
    }
    expect(standingRoomNear(target, crowd, "Sill")).toEqual(target);
  });
});

describe("whether a spot is free", () => {
  it("counts nobody as free", () => {
    expect(isFree(at(0, 0), [])).toBe(true);
  });

  it("treats exactly PERSONAL_SPACE apart as far enough", () => {
    expect(isFree(at(0, 0), [{ x: PERSONAL_SPACE, z: 0 }])).toBe(true);
    expect(isFree(at(0, 0), [{ x: PERSONAL_SPACE - 0.01, z: 0 }])).toBe(false);
  });

  it("ignores height, because two people cannot stand on each other", () => {
    expect(isFree(at(0, 0), [{ x: 0, z: 0 }])).toBe(false);
  });
});
