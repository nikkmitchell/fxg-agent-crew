import { describe, expect, it } from "vitest";
import { defaultGoItem } from "./room-items";
import { goBowl, GO_SURFACE } from "./go-layout";
import { goCarryPoint, heldStoneWorld, idleGoTouch, restOnBoard, stepGoTouch } from "./go-touch";
import { goTouchIntersection } from "./go-layout";

describe("Go hand/controller contacts", () => {
  const item = defaultGoItem("touch");
  const bowl = goBowl(0, 2), center = { x: 0, y: GO_SURFACE + 0.04, z: 0 };
  it("lifts exactly once on entering the active bowl", () => {
    const input = { item, point: bowl, holding: false, canLift: true, now: 0 };
    const first = stepGoTouch(idleGoTouch(), input);
    expect(first.action).toEqual({ action: "lift" });
    expect(stepGoTouch(first.state, { ...input, now: 100 }).action).toBeNull();
    expect(stepGoTouch(idleGoTouch(), { ...input, point: goBowl(1, 2) }).action).toBeNull();
    expect(stepGoTouch(idleGoTouch(), { ...input, canLift: false }).action).toBeNull();
  });
  it("keeps a stone airborne at the bowl, while travelling and while tracking is lost", () => {
    const input = { item, point: bowl, holding: true, canLift: false, now: 0 };
    const atBowl = stepGoTouch(idleGoTouch(), input);
    expect(atBowl.action).toBeNull(); expect(atBowl.state.armed).toBe(false);
    const above = stepGoTouch(atBowl.state, { ...input, point: { ...center, y: 1.3 }, now: 100 });
    expect(above.action).toBeNull(); expect(above.state.armed).toBe(true);
    expect(stepGoTouch(above.state, { ...input, point: null, now: 200 }).action).toBeNull();
  });
  it("requires stable legal contact and places only once until the hand moves away", () => {
    const input = { item, point: center, holding: true, canLift: false, now: 0 };
    let step = stepGoTouch(idleGoTouch(), input);
    expect(step.action).toBeNull();
    step = stepGoTouch(step.state, { ...input, now: 179 }); expect(step.action).toBeNull();
    step = stepGoTouch(step.state, { ...input, now: 181 }); expect(step.action).toEqual({ action: "place", x: 4, y: 4 });
    step = stepGoTouch(step.state, { ...input, now: 4000 }); expect(step.action).toBeNull();
  });
  it("cancels a dwell when tracking disappears and never places on an occupied point", () => {
    const input = { item, point: center, holding: true, canLift: false, now: 0 };
    let step = stepGoTouch(idleGoTouch(), input);
    step = stepGoTouch(step.state, { ...input, point: null, now: 100 });
    step = stepGoTouch(step.state, { ...input, now: 500 }); expect(step.action).toBeNull();
    const occupied = { ...item, stones: [{ x: 4, y: 4, colour: 1 }] };
    expect(stepGoTouch(step.state, { ...input, item: occupied, now: 1000 }).action).toBeNull();
  });
  it("aligns a carried stone with the normalized tracked palm, including rotation", () => {
    expect(goCarryPoint({ p: { x: 1, y: 2, z: 3 }, q: { x: 0, y: 0, z: 0, w: 1 } })).toEqual({ x: 1, y: 2.075, z: 2.92 });
    const half = Math.SQRT1_2;
    expect(goCarryPoint({ p: { x: 0, y: 0, z: 0 }, q: { x: 0, y: half, z: 0, w: half } }).x).toBeCloseTo(-0.08);
  });
  it("does not consume placement while the lift response is pending, then starts a fresh dwell", () => {
    const input = { item, point: center, holding: true, canLift: false, now: 0 };
    let step = stepGoTouch(idleGoTouch(), input);
    step = stepGoTouch(step.state, { ...input, pending: true, now: 500 });
    expect(step.action).toBeNull(); expect(step.state.target).toBeNull();
    step = stepGoTouch(step.state, { ...input, now: 700 }); expect(step.action).toBeNull();
    step = stepGoTouch(step.state, { ...input, now: 879 }); expect(step.action).toBeNull();
    step = stepGoTouch(step.state, { ...input, now: 880 }); expect(step.action).toEqual({ action: "place", x: 4, y: 4 });
  });
});

/**
 * Nikk (4452): "the touch position is not where the stone floats to ... the
 * stone should float out to the position of where the collider is, so you move
 * the stone that's floating down and you can place it".
 */
describe("where a lifted stone floats", () => {
  const wrist = { p: { x: 0.1, y: 1.0, z: 0.2 }, q: { x: 0, y: 0, z: 0, w: 1 } };
  const fingertip = { x: 0.12, y: 0.9, z: 0.05 };

  it("is at YOUR fingertip, the point that plays it, not your palm", () => {
    const at = heldStoneWorld({ yours: true, fingertip, theirWrist: wrist });
    expect(at).toEqual(fingertip);
    expect(at).not.toEqual(goCarryPoint(wrist));
  });

  it("so a stone held over an intersection is the stone that gets played there", () => {
    // The contact that places is the fingertip; the stone is drawn at the same
    // point, so what you see over the board is exactly where it will land.
    const over = { x: 0, y: GO_SURFACE + 0.03, z: 0 };
    const drawn = heldStoneWorld({ yours: true, fingertip: over, theirWrist: null });
    expect(goTouchIntersection(drawn!, 9)).toEqual(goTouchIntersection(over, 9));
  });

  it("follows somebody else's palm, because only a wrist crosses the socket", () => {
    expect(heldStoneWorld({ yours: false, fingertip, theirWrist: wrist })).toEqual(goCarryPoint(wrist));
  });

  it("stays where it was when there is no fresh hand, rather than a remembered one", () => {
    expect(heldStoneWorld({ yours: true, fingertip: null, theirWrist: wrist })).toBeNull();
    expect(heldStoneWorld({ yours: false, fingertip, theirWrist: null })).toBeNull();
  });

  it("rests ON the board as the finger reaches it, never sunk into it", () => {
    const half = 0.01;
    expect(restOnBoard({ x: 0, y: GO_SURFACE - 0.02, z: 0 }, half).y).toBe(GO_SURFACE + half);
    expect(restOnBoard({ x: 0, y: GO_SURFACE + 0.05, z: 0 }, half).y).toBe(GO_SURFACE + 0.05);
  });
});
