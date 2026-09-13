import { describe, expect, it } from "vitest";
import { elbowFor, length } from "./two-bone-ik";

const at = (x: number, y: number, z: number) => ({ x, y, z });
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  length({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

const UPPER = 0.28;
const LOWER = 0.26;
const DOWN = at(0, -1, 0);

describe("placing an elbow", () => {
  it("keeps both bones exactly their own length", () => {
    // The whole point: if this drifts, the arm stretches, which is the most
    // obvious possible rendering fault.
    const shoulder = at(0.2, 1.4, 0);
    for (const hand of [at(0.4, 1.2, -0.2), at(0.2, 1.0, -0.3), at(0.5, 1.4, 0.1)]) {
      const elbow = elbowFor(shoulder, hand, UPPER, LOWER, DOWN);
      expect(dist(shoulder, elbow)).toBeCloseTo(UPPER, 6);
      expect(dist(elbow, hand)).toBeCloseTo(LOWER, 6);
    }
  });

  it("bends the elbow toward the pole, not away from it", () => {
    // An arm held out in front bends DOWNWARD. Bending up is the thing that
    // makes a body look broken, and it is one sign flip away.
    const shoulder = at(0, 1.4, 0);
    const hand = at(0, 1.4, -0.4);
    const elbow = elbowFor(shoulder, hand, UPPER, LOWER, DOWN);
    expect(elbow.y).toBeLessThan(shoulder.y);
  });

  it("straightens the arm when the hand is further away than the arm is long", () => {
    // An arm that cannot reach should look like an arm that cannot reach,
    // rather than snapping the elbow somewhere to pretend it can.
    const shoulder = at(0, 1.4, 0);
    const hand = at(0, 1.4, -5);
    const elbow = elbowFor(shoulder, hand, UPPER, LOWER, DOWN);
    expect(dist(shoulder, elbow)).toBeCloseTo(UPPER, 6);
    // On the straight line between them.
    expect(dist(shoulder, elbow) + dist(elbow, hand)).toBeCloseTo(dist(shoulder, hand), 6);
  });

  it("gives a real answer when the hand is at the shoulder", () => {
    const shoulder = at(0, 1.4, 0);
    const elbow = elbowFor(shoulder, shoulder, UPPER, LOWER, DOWN);
    for (const v of [elbow.x, elbow.y, elbow.z]) expect(Number.isFinite(v)).toBe(true);
  });

  it("gives a real answer when the pole points straight along the arm", () => {
    // Degenerate input: the projection leaves nothing to pick a direction
    // with. It must fall back rather than produce NaN, which would spread into
    // every matrix it touches.
    const shoulder = at(0, 1.4, 0);
    const hand = at(0, 1.0, 0);
    const elbow = elbowFor(shoulder, hand, UPPER, LOWER, at(0, -1, 0));
    for (const v of [elbow.x, elbow.y, elbow.z]) expect(Number.isFinite(v)).toBe(true);
    expect(dist(shoulder, elbow)).toBeCloseTo(UPPER, 6);
  });

  it("reaches a hand exactly at full stretch without breaking", () => {
    const shoulder = at(0, 1.4, 0);
    const hand = at(0, 1.4 - (UPPER + LOWER), 0);
    const elbow = elbowFor(shoulder, hand, UPPER, LOWER, at(0, 0, -1));
    expect(dist(shoulder, elbow)).toBeCloseTo(UPPER, 5);
    expect(dist(elbow, hand)).toBeCloseTo(LOWER, 5);
  });
});
