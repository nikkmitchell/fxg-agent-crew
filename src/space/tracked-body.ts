import * as THREE from "three";
import { elbowFor } from "./two-bone-ik";
import { aimSegment } from "./aim-bone";

/**
 * A whole body from a headset's three points: head, left hand, right hand.
 *
 * Nikk: "IK complete remake for users, make it really good, like VR chat level".
 *
 * WHAT THE OLD BODY DID. The model was scaled so its head met the headset's
 * height and placed with its feet under the head; the head bone turned and the
 * arms reached. So crouching SHRANK the person, leaning forward slid the whole
 * body, hands never turned at the wrist, and the legs stood straight whatever
 * happened above them.
 *
 * WHAT THIS DOES, in the order a frame runs it:
 *
 *   1. HEIGHT IS CALIBRATED, not measured each frame. `StandingHeight` keeps
 *      the tallest the head has recently been, so a crouch lowers the hips and
 *      bends the knees instead of scaling the whole avatar down.
 *   2. HIPS UNDER THE NECK. The neck sits a fixed distance below and a little
 *      behind the head; the hips hang below it, dropping when the head drops.
 *   3. THE SPINE LEANS so the neck reaches where the head put it — look down
 *      at a table and the body bends over it.
 *   4. THE HEAD turns to the headset's orientation.
 *   5. ARMS reach the hands with the elbows falling down, out and slightly
 *      back, the way elbows do; and each HAND turns to the tracked wrist.
 *   6. FEET STAY PLANTED. Each foot keeps its place on the floor until the body
 *      has moved or turned far enough to need a step, then steps — lifting,
 *      one foot at a time. Knees bend toward the way the body faces.
 *
 * Everything is measured off the model at rest (`measureRig`), so any humanoid
 * with the standard bones works without per-model numbers.
 *
 * WRIST CONVENTION. Hand orientations are expected in the WebXR hand-joint
 * convention: -Z runs toward the fingertips and -Y out of the palm. A
 * controller's grip space is different, so the sender converts it with
 * `gripToWristConvention` before it ever reaches the wire.
 */

export type BoneName =
  | "hips" | "spine" | "chest" | "neck" | "head"
  | "leftUpperArm" | "leftLowerArm" | "leftHand" | "rightUpperArm" | "rightLowerArm" | "rightHand"
  | "leftUpperLeg" | "leftLowerLeg" | "leftFoot" | "rightUpperLeg" | "rightLowerLeg" | "rightFoot"
  | "leftMiddleProximal" | "rightMiddleProximal" | "leftThumbProximal" | "rightThumbProximal";

export type Rig = { bone(name: BoneName): THREE.Object3D | null };
export type Side = "left" | "right";

type Limb = { upper: number; lower: number; upperRest: THREE.Vector3; lowerRest: THREE.Vector3 };

/** The model at rest, in its own units and its own frame. */
export type RigSpec = {
  hipsHeight: number;
  /** From the hips joint to the neck, at rest. */
  hipsToNeck: THREE.Vector3;
  /** From the spine bone to the neck, at rest: what the spine is aimed along. */
  spineToNeck: THREE.Vector3;
  neckToHead: number;
  arms: Record<Side, Limb>;
  legs: Record<Side, Limb>;
  /** Half the distance between the hip joints. */
  stanceHalfWidth: number;
  /** How high the ankle sits above the floor. */
  ankleHeight: number;
  /** Rest finger direction and palm normal of each hand. */
  hands: Record<Side, { finger: THREE.Vector3; palm: THREE.Vector3 }>;
};

/**
 * Measure a rig at rest. The model's root must be at its rest transform (no
 * scale, no rotation beyond its own facing) when this is called, which is how
 * a freshly loaded VRM arrives.
 */
export function measureRig(rig: Rig, scene: THREE.Object3D): RigSpec {
  scene.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const at = (name: BoneName, fallback: THREE.Vector3): THREE.Vector3 => {
    const bone = rig.bone(name);
    if (!bone) return fallback.clone();
    return bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(toLocal);
  };

  const hips = at("hips", new THREE.Vector3(0, 0.9, 0));
  const spine = at("spine", hips.clone().add(new THREE.Vector3(0, 0.1, 0)));
  const neck = at("neck", hips.clone().add(new THREE.Vector3(0, 0.55, 0)));
  const head = at("head", neck.clone().add(new THREE.Vector3(0, 0.12, 0)));

  const limb = (a: BoneName, b: BoneName, c: BoneName, out: number, down: boolean): Limb => {
    const p0 = at(a, new THREE.Vector3(out * 0.18, down ? 0.85 : 1.35, 0));
    const p1 = at(b, p0.clone().add(new THREE.Vector3(down ? 0 : out * 0.28, down ? -0.42 : 0, 0)));
    const p2 = at(c, p1.clone().add(new THREE.Vector3(down ? 0 : out * 0.26, down ? -0.42 : 0, 0)));
    const upper = Math.max(p0.distanceTo(p1), 0.01);
    const lower = Math.max(p1.distanceTo(p2), 0.01);
    return {
      upper,
      lower,
      upperRest: p1.clone().sub(p0).normalize(),
      lowerRest: p2.clone().sub(p1).normalize(),
    };
  };

  // Which way is "out" for each side, measured rather than assumed, so a model
  // facing either way along Z gets it right.
  const leftArmX = Math.sign(at("leftUpperArm", new THREE.Vector3(-0.2, 0, 0)).x - hips.x) || -1;
  const rightArmX = -leftArmX;
  const hand = (side: Side) => {
    const wrist = at(side === "left" ? "leftHand" : "rightHand", new THREE.Vector3((side === "left" ? leftArmX : rightArmX) * 0.72, 1.35, 0));
    const finger = at(side === "left" ? "leftMiddleProximal" : "rightMiddleProximal", wrist.clone().add(new THREE.Vector3((side === "left" ? leftArmX : rightArmX) * 0.08, 0, 0)))
      .sub(wrist)
      .normalize();
    const thumb = at(side === "left" ? "leftThumbProximal" : "rightThumbProximal", wrist.clone().add(new THREE.Vector3(0, -0.01, -0.04)))
      .sub(wrist)
      .normalize();
    // The palm faces the side of the hand the thumb folds across. The cross
    // product's order flips between the hands, because the thumb is on the
    // other side of the fingers. (Worked through for a T-pose facing either way
    // along Z: palm down both times, with no further correction.)
    const palm = (side === "left" ? new THREE.Vector3().crossVectors(finger, thumb) : new THREE.Vector3().crossVectors(thumb, finger));
    palm.sub(finger.clone().multiplyScalar(palm.dot(finger)));
    if (palm.lengthSq() < 1e-8) palm.set(0, -1, 0);
    return { finger, palm: palm.normalize() };
  };

  const leftUpperLeg = at("leftUpperLeg", hips.clone().add(new THREE.Vector3(leftArmX * 0.09, -0.05, 0)));
  const rightUpperLeg = at("rightUpperLeg", hips.clone().add(new THREE.Vector3(rightArmX * 0.09, -0.05, 0)));
  const leftFoot = at("leftFoot", new THREE.Vector3(leftArmX * 0.09, 0.08, 0));

  return {
    hipsHeight: hips.y,
    hipsToNeck: neck.clone().sub(hips),
    spineToNeck: neck.clone().sub(spine),
    neckToHead: Math.max(head.distanceTo(neck), 0.05),
    arms: {
      left: limb("leftUpperArm", "leftLowerArm", "leftHand", leftArmX, false),
      right: limb("rightUpperArm", "rightLowerArm", "rightHand", rightArmX, false),
    },
    legs: {
      left: limb("leftUpperLeg", "leftLowerLeg", "leftFoot", leftArmX, true),
      right: limb("rightUpperLeg", "rightLowerLeg", "rightFoot", rightArmX, true),
    },
    stanceHalfWidth: Math.max(leftUpperLeg.distanceTo(rightUpperLeg) / 2, 0.06),
    ankleHeight: Math.max(leftFoot.y, 0.03),
    hands: { left: hand("left"), right: hand("right") },
  };
}

/**
 * The standing height of the person, from the heads they have reported.
 *
 * The tallest recent head, sinking only slowly — about eighteen centimetres a
 * minute — so a crouch is a crouch for as long as anyone holds one.
 *
 * NEVER STARTS BELOW AN ADULT'S HEAD. Somebody whose first reading is a crouch,
 * or who put the headset on sitting down, would otherwise be taken to BE that
 * tall and drawn small, which is exactly the shrinking this replaces. Starting
 * no lower than 1.5 m draws them crouched instead; a genuinely shorter person
 * settles to their own height within a minute.
 */
export class StandingHeight {
  private value: number | null = null;
  constructor(
    private readonly sinkPerSecond = 0.003,
    private readonly min = 1.0,
    private readonly max = 2.2,
    private readonly startAtLeast = 1.5,
  ) {}

  update(headY: number, dt: number): number {
    const clamped = Math.max(this.min, Math.min(this.max, headY));
    this.value =
      this.value === null
        ? Math.max(clamped, this.startAtLeast)
        : Math.max(this.value - this.sinkPerSecond * dt, clamped);
    return this.value;
  }

  get current(): number | null {
    return this.value;
  }
}

/**
 * Turn a controller's grip orientation into the hand-joint convention.
 *
 * The grip space's -Z runs along the controller toward the thumb, and its X
 * axis is perpendicular to the palm: +X out of the back of a RIGHT hand, -X
 * out of the back of a LEFT one. The hand-joint convention wants -Y out of the
 * palm. A quarter turn about Z maps one onto the other, opposite ways per hand.
 */
export function gripToWristConvention(q: THREE.Quaternion, side: Side): THREE.Quaternion {
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), side === "right" ? -Math.PI / 2 : Math.PI / 2);
  return q.clone().multiply(turn);
}

export type TrackedInput = {
  head: { p: THREE.Vector3; q: THREE.Quaternion };
  hands: Record<Side, { p: THREE.Vector3; q: THREE.Quaternion } | null>;
  /** The body's own yaw, as the root is turned. */
  bodyYaw: number;
  /** The root's uniform scale: model units to metres. */
  scale: number;
  dt: number;
  /** When true, nothing eases: feet jump rather than step. */
  snap: boolean;
};

type FootState = {
  planted: THREE.Vector3;
  yaw: number;
  stepFrom: THREE.Vector3 | null;
  stepTo: THREE.Vector3;
  stepYawFrom: number;
  stepYawTo: number;
  t: number;
};

export const STEP_DISTANCE = 0.2;
export const STEP_TURN = (40 * Math.PI) / 180;
export const STEP_SECONDS = 0.26;
export const STEP_LIFT = 0.07;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Poses a rig from a TrackedInput every frame. One per person.
 *
 * `root` is the object the room places and turns (feet on the floor at the
 * person's position); `scene` is the model inside it.
 */
export class TrackedBody {
  private readonly feet: Record<Side, FootState | null> = { left: null, right: null };
  private readonly v = {
    neck: new THREE.Vector3(),
    hips: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    pole: new THREE.Vector3(),
    q: new THREE.Quaternion(),
    q2: new THREE.Quaternion(),
    m: new THREE.Matrix4(),
    m2: new THREE.Matrix4(),
  };

  constructor(
    private readonly rig: Rig,
    private readonly spec: RigSpec,
    private readonly scene: THREE.Object3D,
  ) {}

  pose(input: TrackedInput): void {
    const { rig, spec, v } = this;
    const s = input.scale;
    this.scene.updateMatrixWorld(true);
    v.forward.set(-Math.sin(input.bodyYaw), 0, -Math.cos(input.bodyYaw));
    v.right.set(Math.cos(input.bodyYaw), 0, -Math.sin(input.bodyYaw));

    // 2. HIPS. The neck is below the head along the world's up, a little behind
    // it — not along the head's own axis, or nodding would swing the hips.
    v.neck.copy(input.head.p).addScaledVector(v.forward, -0.04 * s);
    v.neck.y -= spec.neckToHead * s;
    const standingHips = spec.hipsHeight * s;
    // How far the head has come down from standing, as the hips see it.
    const drop = Math.max(0, standingHips - (v.neck.y - spec.hipsToNeck.y * s));
    // LOOKING DOWN IS PARTLY BENDING OVER. The more the head pitches down, the
    // more of a drop is taken by the spine bending rather than the knees; a
    // level head that drops is a crouch.
    const headForward = new THREE.Vector3(0, 0, -1).applyQuaternion(input.head.q);
    const pitchDown = Math.max(0, Math.asin(Math.max(-1, Math.min(1, -headForward.y))));
    const bend = Math.min(1, pitchDown / (Math.PI / 3)) * 0.6;
    const hipsY = Math.max(standingHips * 0.35, standingHips - drop * (1 - bend));
    v.hips.set(v.neck.x, hipsY, v.neck.z);
    // A body bending over pushes its hips back behind its head to balance.
    v.hips.addScaledVector(v.forward, -Math.min(drop * bend, 0.3 * s));

    const hips = rig.bone("hips");
    if (hips?.parent) {
      hips.parent.updateWorldMatrix(true, false);
      hips.position.copy(v.hips).applyMatrix4(v.m.copy(hips.parent.matrixWorld).invert());
      hips.updateMatrixWorld(true);
    }

    // 3. SPINE. Aim the spine so the neck lands where the head needs it.
    const spine = rig.bone("spine");
    if (spine) aimSegment(spine, spec.spineToNeck.clone().normalize(), v.neck);
    spine?.updateMatrixWorld(true);

    // 4. HEAD. The model's rest head looks the way the scene faces; a headset
    // at identity looks down -Z. So the head bone's world rotation is the
    // headset's, composed with the scene's own facing.
    const head = rig.bone("head");
    if (head?.parent) {
      this.scene.getWorldQuaternion(v.q2);
      const sceneFacing = v.q.copy(v.q2);
      // Remove the body's yaw from the scene's world rotation: that leaves only
      // the model's own facing correction.
      const yawOnly = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), input.bodyYaw);
      sceneFacing.premultiply(yawOnly.invert());
      const want = input.head.q.clone().multiply(sceneFacing);
      head.parent.getWorldQuaternion(v.q2);
      head.quaternion.copy(v.q2.invert().multiply(want));
      head.updateMatrixWorld(true);
    }

    // 5. ARMS AND HANDS.
    for (const side of ["left", "right"] as const) {
      const target = input.hands[side];
      if (!target) continue;
      this.poseArm(side, target, s);
    }

    // 6. LEGS AND FEET.
    for (const side of ["left", "right"] as const) {
      this.poseLeg(side, input, s);
    }
  }

  private poseArm(side: Side, target: { p: THREE.Vector3; q: THREE.Quaternion }, s: number): void {
    const { rig, spec, v } = this;
    const upper = rig.bone(side === "left" ? "leftUpperArm" : "rightUpperArm");
    const lower = rig.bone(side === "left" ? "leftLowerArm" : "rightLowerArm");
    const hand = rig.bone(side === "left" ? "leftHand" : "rightHand");
    if (!upper || !lower) return;
    const arm = spec.arms[side];
    const shoulder = upper.getWorldPosition(new THREE.Vector3());
    const out = side === "left" ? -1 : 1;
    // Elbows fall down, out to the side and a little back.
    v.pole
      .set(0, -1, 0)
      .addScaledVector(v.right, out * 0.7)
      .addScaledVector(v.forward, -0.45);
    const elbow = elbowFor(shoulder, target.p, arm.upper * s, arm.lower * s, v.pole);
    aimSegment(upper, arm.upperRest, new THREE.Vector3(elbow.x, elbow.y, elbow.z));
    upper.updateMatrixWorld(true);
    aimSegment(lower, arm.lowerRest, target.p);
    lower.updateMatrixWorld(true);

    if (!hand?.parent) return;
    // THE WRIST. Build the rotation that takes the hand's rest finger and palm
    // to the tracked ones, in world space, then express it in the forearm's.
    this.scene.getWorldQuaternion(v.q);
    const restFinger = spec.hands[side].finger.clone().applyQuaternion(v.q);
    const restPalm = spec.hands[side].palm.clone().applyQuaternion(v.q);
    const finger = new THREE.Vector3(0, 0, -1).applyQuaternion(target.q);
    const palm = new THREE.Vector3(0, -1, 0).applyQuaternion(target.q);
    const rotation = rotationBetweenFrames(restFinger, restPalm, finger, palm);
    const worldHand = rotation.multiply(v.q);
    hand.parent.getWorldQuaternion(v.q2);
    hand.quaternion.copy(v.q2.invert().multiply(worldHand));
    hand.updateMatrixWorld(true);
  }

  private poseLeg(side: Side, input: TrackedInput, s: number): void {
    const { rig, spec, v } = this;
    const upper = rig.bone(side === "left" ? "leftUpperLeg" : "rightUpperLeg");
    const lower = rig.bone(side === "left" ? "leftLowerLeg" : "rightLowerLeg");
    const foot = rig.bone(side === "left" ? "leftFoot" : "rightFoot");
    if (!upper || !lower) return;
    const leg = spec.legs[side];
    const out = side === "left" ? -1 : 1;

    // Where this foot would stand if the body were still.
    const ideal = new THREE.Vector3(v.hips.x, 0, v.hips.z).addScaledVector(v.right, out * spec.stanceHalfWidth * s);
    let state = this.feet[side];
    if (!state || input.snap) {
      state = { planted: ideal.clone(), yaw: input.bodyYaw, stepFrom: null, stepTo: ideal.clone(), stepYawFrom: input.bodyYaw, stepYawTo: input.bodyYaw, t: 0 };
      this.feet[side] = state;
    }

    const other = this.feet[side === "left" ? "right" : "left"];
    const otherStepping = other?.stepFrom !== null && other?.stepFrom !== undefined;
    if (state.stepFrom === null && !otherStepping) {
      const far = state.planted.distanceTo(ideal) > STEP_DISTANCE * s;
      const turned = Math.abs(wrap(input.bodyYaw - state.yaw)) > STEP_TURN;
      if (far || turned) {
        state.stepFrom = state.planted.clone();
        // Step a little past where the foot is wanted, in the direction of
        // travel, so a walking body is not always catching up.
        state.stepTo = ideal.clone().addScaledVector(ideal.clone().sub(state.planted).setY(0), 0.15);
        state.stepYawFrom = state.yaw;
        state.stepYawTo = input.bodyYaw;
        state.t = 0;
      }
    }

    let lift = 0;
    const current = state.planted.clone();
    let yaw = state.yaw;
    if (state.stepFrom !== null) {
      state.t = Math.min(1, state.t + input.dt / STEP_SECONDS);
      const e = state.t * state.t * (3 - 2 * state.t);
      current.lerpVectors(state.stepFrom, state.stepTo, e);
      yaw = state.stepYawFrom + wrap(state.stepYawTo - state.stepYawFrom) * e;
      lift = Math.sin(Math.PI * state.t) * STEP_LIFT * s;
      if (state.t >= 1) {
        state.planted.copy(state.stepTo);
        state.yaw = state.stepYawTo;
        state.stepFrom = null;
      }
    }

    const ankle = current.clone();
    ankle.y = spec.ankleHeight * s + lift;
    const hip = upper.getWorldPosition(new THREE.Vector3());
    // Knees bend forward, the way the body faces.
    v.pole.copy(v.forward).add(new THREE.Vector3(0, 0.15, 0));
    const knee = elbowFor(hip, ankle, leg.upper * s, leg.lower * s, v.pole);
    aimSegment(upper, leg.upperRest, new THREE.Vector3(knee.x, knee.y, knee.z));
    upper.updateMatrixWorld(true);
    aimSegment(lower, leg.lowerRest, ankle);
    lower.updateMatrixWorld(true);

    if (foot?.parent) {
      // Flat on the floor, pointing the way it was planted.
      this.scene.getWorldQuaternion(v.q);
      const bodyYawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), input.bodyYaw);
      const sceneFacing = bodyYawQ.clone().invert().multiply(v.q);
      const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(sceneFacing);
      foot.parent.getWorldQuaternion(v.q2);
      foot.quaternion.copy(v.q2.invert().multiply(want));
      foot.updateMatrixWorld(true);
    }
  }

  /** Where each foot is on the floor right now, for tests and debugging. */
  footState(side: Side): { planted: THREE.Vector3; stepping: boolean } | null {
    const state = this.feet[side];
    return state ? { planted: state.planted.clone(), stepping: state.stepFrom !== null } : null;
  }
}

/**
 * The rotation taking one (direction, normal) frame to another. Both pairs
 * are orthonormalised first, so slightly skewed inputs still give a rotation.
 */
export function rotationBetweenFrames(
  fromForward: THREE.Vector3,
  fromNormal: THREE.Vector3,
  toForward: THREE.Vector3,
  toNormal: THREE.Vector3,
): THREE.Quaternion {
  const basis = (forward: THREE.Vector3, normal: THREE.Vector3) => {
    const f = forward.clone().normalize();
    const n = normal.clone().sub(f.clone().multiplyScalar(normal.dot(f))).normalize();
    const side = new THREE.Vector3().crossVectors(f, n);
    return new THREE.Matrix4().makeBasis(f, n, side);
  };
  const from = basis(fromForward, fromNormal);
  const to = basis(toForward, toNormal);
  const rotation = to.multiply(from.transpose());
  return new THREE.Quaternion().setFromRotationMatrix(rotation);
}
