import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BACK_THICKNESS, lyingPose, shouldLieDown } from "./sleep-pose";

/** A stand-in body facing -Z: feet at the origin, hips and head above, a nose in front. */
const body = (hipHeight: number) => {
  const pose = new THREE.Group();
  const hips = new THREE.Object3D();
  hips.position.set(0, hipHeight, 0);
  const head = new THREE.Object3D();
  head.position.set(0, hipHeight * 1.9, 0);
  const nose = new THREE.Object3D();
  nose.position.set(0, hipHeight * 1.9, -0.1);
  pose.add(hips, head, nose);
  return { pose, hips, head, nose };
};

const place = (pose: THREE.Group, lie: number, hipHeight: number) => {
  const p = lyingPose(lie, hipHeight);
  pose.rotation.x = p.rotationX;
  pose.position.set(0, p.y, p.z);
  pose.updateMatrixWorld(true);
};

const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

describe("a sleeping agent lies down", () => {
  // Nikk: "the best is if they lie down on the ground and just sleep".
  it("stands exactly as before when not asleep", () => {
    expect(lyingPose(0, 0.7)).toEqual({ rotationX: 0, y: 0, z: -0 });
  });

  it("lies flat on its back, face up, with its hips over the spot it stood on", () => {
    const hipHeight = 0.7;
    const { pose, hips, head, nose } = body(hipHeight);
    place(pose, 1, hipHeight);
    const h = world(hips);
    expect(h.x).toBeCloseTo(0, 9);
    expect(h.z).toBeCloseTo(0, 9);
    expect(h.y).toBeCloseTo(BACK_THICKNESS, 9);
    // The head is level with the hips: lying, not leaning.
    expect(world(head).y).toBeCloseTo(BACK_THICKNESS, 9);
    // And the face points at the ceiling, not into the floor.
    expect(world(nose).y).toBeGreaterThan(world(head).y);
  });

  it("goes down gradually, never below the floor on the way", () => {
    const hipHeight = 0.7;
    const { pose, head } = body(hipHeight);
    let previous = Infinity;
    for (let lie = 0; lie <= 1; lie += 0.05) {
      place(pose, lie, hipHeight);
      const y = world(head).y;
      expect(y).toBeGreaterThanOrEqual(BACK_THICKNESS - 1e-9);
      expect(y).toBeLessThanOrEqual(previous + 1e-9);
      previous = y;
    }
  });

  it("is for a sleeping agent standing still, and nobody else", () => {
    const agent = (over: Record<string, unknown> = {}) => ({ kind: "agent", moving: false, avatar: { posture: "sleeping" }, ...over });
    expect(shouldLieDown(agent())).toBe(true);
    expect(shouldLieDown(agent({ moving: true })), "walking somewhere is not asleep").toBe(false);
    expect(shouldLieDown(agent({ avatar: { posture: "thinking" } }))).toBe(false);
    expect(shouldLieDown(agent({ kind: "human" })), "a person has a body of their own").toBe(false);
  });
});
