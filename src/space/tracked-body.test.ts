import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  STEP_SECONDS,
  StandingHeight,
  TrackedBody,
  gripToWristConvention,
  measureRig,
  rotationBetweenFrames,
  type BoneName,
  type Rig,
} from "./tracked-body";

/**
 * A plain humanoid in a T-pose, facing -Z, 1.62 m to the head — built from
 * bones rather than loaded, so the solver can be checked joint by joint.
 */
function makeRig() {
  const scene = new THREE.Group();
  const bones = new Map<BoneName, THREE.Object3D>();
  const add = (name: BoneName, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const bone = new THREE.Bone();
    bone.position.set(x, y, z);
    parent.add(bone);
    bones.set(name, bone);
    return bone;
  };
  const hips = add("hips", scene, 0, 0.95, 0);
  const spine = add("spine", hips, 0, 0.1, 0);
  const chest = add("chest", spine, 0, 0.15, 0);
  const neck = add("neck", chest, 0, 0.3, 0);
  add("head", neck, 0, 0.12, 0);
  for (const [side, x] of [["left", -1], ["right", 1]] as const) {
    const upperArm = add(`${side}UpperArm`, chest, x * 0.18, 0.22, 0);
    const lowerArm = add(`${side}LowerArm`, upperArm, x * 0.28, 0, 0);
    const hand = add(`${side}Hand`, lowerArm, x * 0.26, 0, 0);
    add(`${side}MiddleProximal`, hand, x * 0.09, 0, 0);
    add(`${side}ThumbProximal`, hand, x * 0.02, -0.01, -0.04);
    const upperLeg = add(`${side}UpperLeg`, hips, x * 0.09, -0.05, 0);
    const lowerLeg = add(`${side}LowerLeg`, upperLeg, 0, -0.42, 0);
    add(`${side}Foot`, lowerLeg, 0, -0.4, 0);
  }
  const root = new THREE.Group();
  root.add(scene);
  const rig: Rig = { bone: (name) => bones.get(name) ?? null };
  const spec = measureRig(rig, scene);
  const body = new TrackedBody(rig, spec, scene);
  const world = (name: BoneName) => bones.get(name)!.getWorldPosition(new THREE.Vector3());
  const pose = (options: {
    head?: THREE.Vector3;
    headQ?: THREE.Quaternion;
    hands?: { left?: { p: THREE.Vector3; q: THREE.Quaternion }; right?: { p: THREE.Vector3; q: THREE.Quaternion } };
    dt?: number;
    snap?: boolean;
  } = {}) => {
    const head = options.head ?? new THREE.Vector3(0, 1.62, 0);
    root.position.set(head.x, 0, head.z);
    root.updateMatrixWorld(true);
    body.pose({
      head: { p: head, q: options.headQ ?? new THREE.Quaternion() },
      hands: { left: options.hands?.left ?? null, right: options.hands?.right ?? null },
      bodyYaw: 0,
      scale: 1,
      dt: options.dt ?? 1 / 60,
      snap: options.snap ?? false,
    });
    root.updateMatrixWorld(true);
  };
  return { rig, spec, body, world, pose, bones };
}

describe("a body from a headset's three points", () => {
  it("measures the rig at rest: limbs, stance and hands", () => {
    const { spec } = makeRig();
    expect(spec.arms.left.upper).toBeCloseTo(0.28, 6);
    expect(spec.legs.right.lower).toBeCloseTo(0.4, 6);
    expect(spec.hipsHeight).toBeCloseTo(0.95, 6);
    expect(spec.hands.left.palm.y, "a T-pose palm faces down").toBeLessThan(-0.9);
    expect(spec.hands.right.palm.y).toBeLessThan(-0.9);
  });

  it("stands with feet on the floor under the hips when the head is at standing height", () => {
    const { world, pose } = makeRig();
    pose({ snap: true });
    expect(world("hips").y).toBeCloseTo(0.95, 2);
    expect(world("leftFoot").y).toBeCloseTo(0.08, 2);
    expect(world("rightFoot").y).toBeCloseTo(0.08, 2);
  });

  it("CROUCHES rather than shrinking: the hips drop, the feet stay put, the knees bend forward", () => {
    // The old body scaled the whole avatar down when the head came down.
    const { world, pose } = makeRig();
    pose({ snap: true });
    const footBefore = world("leftFoot");
    pose({ head: new THREE.Vector3(0, 1.22, 0) });
    expect(world("hips").y).toBeLessThan(0.62);
    const foot = world("leftFoot");
    expect(foot.distanceTo(footBefore)).toBeLessThan(0.01);
    const knee = world("leftLowerLeg");
    expect(knee.z, "knee forward of the leg").toBeLessThan(-0.1);
  });

  it("BENDS OVER when the drop comes with looking down, keeping the hips higher than a crouch", () => {
    const crouch = makeRig();
    crouch.pose({ snap: true });
    crouch.pose({ head: new THREE.Vector3(0, 1.3, 0) });
    const bend = makeRig();
    bend.pose({ snap: true });
    const lookingDown = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 3);
    bend.pose({ head: new THREE.Vector3(0, 1.3, 0), headQ: lookingDown });
    expect(bend.world("hips").y).toBeGreaterThan(crouch.world("hips").y + 0.1);
  });

  it("reaches the hands, with elbows below the shoulders", () => {
    const { world, pose } = makeRig();
    const target = new THREE.Vector3(0.35, 1.15, -0.35);
    pose({ snap: true, hands: { right: { p: target, q: new THREE.Quaternion() } } });
    expect(world("rightHand").distanceTo(target)).toBeLessThan(0.01);
    expect(world("rightLowerArm").y).toBeLessThan(world("rightUpperArm").y);
  });

  it("turns the wrist to the tracked hand: fingers forward, palm down", () => {
    const { world, pose } = makeRig();
    // Identity in the hand-joint convention: fingers toward -Z, palm toward -Y.
    pose({ snap: true, hands: { left: { p: new THREE.Vector3(-0.25, 1.1, -0.45), q: new THREE.Quaternion() } } });
    const finger = world("leftMiddleProximal").sub(world("leftHand")).normalize();
    expect(finger.z).toBeLessThan(-0.95);
    const thumb = world("leftThumbProximal").sub(world("leftHand"));
    expect(thumb.y, "palm down puts the thumb slightly below... or level").toBeLessThan(0.02);
  });

  it("turns the head to the headset", () => {
    const { bones, pose } = makeRig();
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
    pose({ snap: true, headQ: yaw });
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(bones.get("head")!.getWorldQuaternion(new THREE.Quaternion()));
    const wanted = new THREE.Vector3(0, 0, -1).applyQuaternion(yaw);
    expect(forward.dot(wanted)).toBeGreaterThan(0.999);
  });

  it("keeps the feet planted for a small shift, and steps them to follow a bigger move", () => {
    const { body, world, pose } = makeRig();
    pose({ snap: true });
    const start = world("rightFoot");
    pose({ head: new THREE.Vector3(0.08, 1.62, 0) });
    expect(world("rightFoot").distanceTo(start), "a sway is not a step").toBeLessThan(0.01);
    const destination = new THREE.Vector3(0.6, 1.62, 0);
    pose({ head: destination });
    expect(body.footState("left")!.stepping || body.footState("right")!.stepping).toBe(true);
    for (let frame = 0; frame < Math.ceil((STEP_SECONDS * 6) * 60); frame += 1) pose({ head: destination });
    expect(world("rightFoot").x).toBeGreaterThan(0.55);
    expect(world("leftFoot").x).toBeGreaterThan(0.4);
    expect(world("leftFoot").y).toBeCloseTo(0.08, 2);
  });
});

describe("the parts underneath", () => {
  it("remembers standing height through a crouch, and corrects a low first reading", () => {
    const height = new StandingHeight();
    expect(height.update(1.7, 0)).toBeCloseTo(1.7, 9);
    expect(height.update(1.2, 1)).toBeGreaterThan(1.69);
    const seated = new StandingHeight();
    expect(seated.update(1.05, 0), "a crouched first reading is not a small person").toBe(1.5);
    expect(seated.update(1.72, 0.1)).toBeCloseTo(1.72, 9);
    const shorter = new StandingHeight();
    shorter.update(1.4, 0);
    for (let second = 0; second < 60; second += 1) shorter.update(1.4, 1);
    expect(shorter.current!, "a shorter person settles to their own height").toBeCloseTo(1.4, 2);
  });

  it("maps a controller's grip to the hand convention: palm facing in toward the body", () => {
    // Right hand: the back of the hand is +X in grip space, so the palm is -X.
    const right = gripToWristConvention(new THREE.Quaternion(), "right");
    expect(new THREE.Vector3(0, -1, 0).applyQuaternion(right).x).toBeCloseTo(-1, 6);
    expect(new THREE.Vector3(0, 0, -1).applyQuaternion(right).z).toBeCloseTo(-1, 6);
    const left = gripToWristConvention(new THREE.Quaternion(), "left");
    expect(new THREE.Vector3(0, -1, 0).applyQuaternion(left).x).toBeCloseTo(1, 6);
  });

  it("finds the rotation between two frames", () => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, -0.9, 0.2));
    const f = new THREE.Vector3(1, 0.2, 0).normalize();
    const n = new THREE.Vector3(0, 1, 0);
    const r = rotationBetweenFrames(f, n, f.clone().applyQuaternion(q), n.clone().applyQuaternion(q));
    expect(Math.abs(r.dot(q))).toBeCloseTo(1, 5);
  });
});
