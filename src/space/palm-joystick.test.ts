import { describe, expect, it } from "vitest";
import * as THREE from "three";

/**
 * Three joints of Meta's recorded relaxed LEFT hand, copied (rounded) from the
 * WebXR emulator's `iwer/lib/device/configs/hand/relaxed.js`, which is
 * © Meta Platforms, Inc. and affiliates, MIT licensed. Column-major, as WebXR
 * and three.js store matrices.
 */
const RELAXED_LEFT = {
  wrist: [0.9617, -0.13805, 0.23681, 0, 0.00053, 0.86486, 0.50201, 0, -0.27411, -0.48265, 0.83181, 0, -0.04914, 0.00215, 0.11702, 1],
  thumbMetacarpal: [-0.07536, -0.99597, -0.04867, 0, 0.58771, -0.0838, 0.80472, 0, -0.80556, 0.03204, 0.59165, 0, -0.01064, 0.00069, 0.08737, 1],
  middleMetacarpal: [0.9617, -0.13805, 0.23681, 0, 0.00053, 0.86486, 0.50201, 0, -0.27411, -0.48265, 0.83181, 0, -0.03628, 0.01158, 0.0855, 1],
};
import {
  DEAD_ZONE,
  HOLD_TO_SHOW_MS,
  IDLE,
  LET_GO_GRACE_MS,
  MAX_TURN_RATE,
  MAX_WALK_SPEED,
  ballAbove,
  palmUpness,
  rotate,
  stepJoystick,
  turnAbout,
  turnRate,
  walkSpeedFor,
  walkVelocity,
  type Quat,
} from "./palm-joystick";

const q = (euler: THREE.Euler): Quat => {
  const r = new THREE.Quaternion().setFromEuler(euler);
  return { x: r.x, y: r.y, z: r.z, w: r.w };
};
/** A joint with its -Y (the palm side) pointing up: turned half over about Z. */
const PALM_UP = q(new THREE.Euler(0, 0, Math.PI));
/** A relaxed hand, palm down. */
const PALM_DOWN = q(new THREE.Euler(0, 0, 0));
const at = (x: number, y: number, z: number) => ({ p: { x, y, z }, q: PALM_UP });

describe("the palm joystick", () => {
  it("rotates vectors the way three.js does", () => {
    const quat = q(new THREE.Euler(0.3, -1.1, 0.7));
    const mine = rotate({ x: 0.2, y: -1, z: 0.5 }, quat);
    const theirs = new THREE.Vector3(0.2, -1, 0.5).applyQuaternion(new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w));
    expect(mine.x).toBeCloseTo(theirs.x, 9);
    expect(mine.y).toBeCloseTo(theirs.y, 9);
    expect(mine.z).toBeCloseTo(theirs.z, 9);
  });

  it("reads the palm's direction the way a real Quest hand reports it", () => {
    // Meta's captured relaxed LEFT hand points its fingers forward with the
    // thumb to the right, so its palm faces DOWN. If the joint axes meant
    // something else, this would call it palm-up and the joystick would appear
    // on every relaxed hand.
    const m = new THREE.Matrix4().fromArray(RELAXED_LEFT.middleMetacarpal);
    const wrist = new THREE.Matrix4().fromArray(RELAXED_LEFT.wrist);
    const thumb = new THREE.Matrix4().fromArray(RELAXED_LEFT.thumbMetacarpal);
    const toTip = new THREE.Vector3().setFromMatrixPosition(m).sub(new THREE.Vector3().setFromMatrixPosition(wrist));
    const toThumb = new THREE.Vector3().setFromMatrixPosition(thumb).sub(new THREE.Vector3().setFromMatrixPosition(wrist));
    expect(toTip.z, "fingers forward").toBeLessThan(0);
    expect(toThumb.x, "thumb on the right of a left hand").toBeGreaterThan(0);
    const rotation = new THREE.Quaternion().setFromRotationMatrix(m);
    expect(palmUpness({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })).toBeLessThan(-0.5);
  });

  it("knows a palm facing up from one facing down", () => {
    expect(palmUpness(PALM_UP)).toBeCloseTo(1, 6);
    expect(palmUpness(PALM_DOWN)).toBeCloseTo(-1, 6);
  });

  it("shows the ball only after the palm has faced up for a second", () => {
    // Nikk: "if you put your palm facing upwards for over one second a ball appears".
    let state = IDLE;
    let result = stepJoystick(state, at(0, 1, -0.3), 0);
    state = result.state;
    result = stepJoystick(state, at(0, 1, -0.3), HOLD_TO_SHOW_MS - 1);
    expect(result.ball).toBeNull();
    result = stepJoystick(result.state, at(0, 1, -0.3), HOLD_TO_SHOW_MS);
    expect(result.ball).not.toBeNull();
    expect(result.state.phase).toBe("active");
  });

  it("puts the ball above the palm, and the shadow ball where it first appeared", () => {
    let result = stepJoystick(IDLE, at(0, 1, -0.3), 0);
    result = stepJoystick(result.state, at(0, 1, -0.3), HOLD_TO_SHOW_MS);
    expect(result.ball!.y).toBeGreaterThan(1);
    const anchor = result.state.phase === "active" ? result.state.anchor : null;
    result = stepJoystick(result.state, at(0.1, 1, -0.5), HOLD_TO_SHOW_MS + 500);
    expect(result.state.phase === "active" && result.state.anchor).toEqual(anchor);
    expect(result.ball!.x).toBeCloseTo(0.1, 6);
  });

  it("starts the second over if the palm turns down before it is up", () => {
    let result = stepJoystick(IDLE, at(0, 1, 0), 0);
    result = stepJoystick(result.state, { p: { x: 0, y: 1, z: 0 }, q: PALM_DOWN }, 600);
    result = stepJoystick(result.state, at(0, 1, 0), 700);
    result = stepJoystick(result.state, at(0, 1, 0), 1500);
    expect(result.ball, "only 800 ms up since it came back").toBeNull();
  });

  it("lets go when the palm turns over, but not for a moment's wobble", () => {
    let result = stepJoystick(IDLE, at(0, 1, 0), 0);
    result = stepJoystick(result.state, at(0, 1, 0), HOLD_TO_SHOW_MS);
    const down = { p: { x: 0, y: 1, z: 0 }, q: PALM_DOWN };
    result = stepJoystick(result.state, down, HOLD_TO_SHOW_MS + LET_GO_GRACE_MS - 50);
    expect(result.state.phase, "a wobble").toBe("active");
    result = stepJoystick(result.state, down, HOLD_TO_SHOW_MS + LET_GO_GRACE_MS + 10);
    expect(result.state.phase).toBe("idle");
    expect(result.ball).toBeNull();
  });

  it("ignores hand shake inside the dead zone", () => {
    const anchor = { x: 0, y: 1, z: 0 };
    expect(walkVelocity(anchor, { x: DEAD_ZONE * 0.9, y: 1, z: 0 })).toEqual({ x: 0, z: 0 });
    expect(turnRate(anchor, { x: DEAD_ZONE * 0.9, y: 1, z: 0 }, 0)).toBeCloseTo(0, 9);
  });

  it("LEFT HAND walks the way the ball is pushed, forward, back, left and right", () => {
    const anchor = { x: 0, y: 1, z: 0 };
    const forward = walkVelocity(anchor, { x: 0, y: 1, z: -0.1 });
    expect(forward.z).toBeLessThan(0);
    expect(forward.x).toBeCloseTo(0, 9);
    expect(walkVelocity(anchor, { x: 0, y: 1, z: 0.1 }).z).toBeGreaterThan(0);
    expect(walkVelocity(anchor, { x: -0.1, y: 1, z: 0 }).x).toBeLessThan(0);
    expect(walkVelocity(anchor, { x: 0.1, y: 1, z: 0 }).x).toBeGreaterThan(0);
  });

  it("does not walk when the ball only goes up or down", () => {
    expect(walkVelocity({ x: 0, y: 1, z: 0 }, { x: 0, y: 1.3, z: 0 })).toEqual({ x: 0, z: 0 });
  });

  it("starts slow and gets faster the further the ball goes, up to a cap", () => {
    // Nikk: "have these values be very small but allow for moving the sphere a
    // significant amount so you can increase the speed".
    const small = walkSpeedFor(DEAD_ZONE + 0.03);
    const medium = walkSpeedFor(DEAD_ZONE + 0.1);
    const large = walkSpeedFor(DEAD_ZONE + 0.2);
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(0.3);
    expect(medium).toBeGreaterThan(small * 2);
    expect(large).toBeGreaterThan(medium * 2);
    expect(walkSpeedFor(2)).toBe(MAX_WALK_SPEED);
  });

  it("RIGHT HAND turns right for a push right, left for a push left, and nothing for forward or back", () => {
    const anchor = { x: 0, y: 1, z: 0 };
    // Head facing down -Z (yaw 0): right is +X. Pushed right turns right, a negative yaw.
    expect(turnRate(anchor, { x: 0.1, y: 1, z: 0 }, 0)).toBeLessThan(0);
    expect(turnRate(anchor, { x: -0.1, y: 1, z: 0 }, 0)).toBeGreaterThan(0);
    expect(turnRate(anchor, { x: 0, y: 1, z: -0.2 }, 0)).toBeCloseTo(0, 9);
    expect(turnRate(anchor, { x: 0, y: 1, z: 0.2 }, 0)).toBeCloseTo(0, 9);
    expect(Math.abs(turnRate(anchor, { x: 5, y: 1, z: 0 }, 0))).toBe(MAX_TURN_RATE);
  });

  it("judges right and left by where the head faces, not by the room's axes", () => {
    const anchor = { x: 0, y: 1, z: 0 };
    // Facing +X (yaw -90 degrees): the person's right is +Z.
    const yaw = -Math.PI / 2;
    expect(turnRate(anchor, { x: 0, y: 1, z: 0.1 }, yaw)).toBeLessThan(0);
    expect(turnRate(anchor, { x: 0.2, y: 1, z: 0 }, yaw), "that is forward for them").toBeCloseTo(0, 9);
  });

  it("turns the player on the spot, about their head, rather than swinging them round the origin", () => {
    const origin = new THREE.Group();
    origin.position.set(2, 0, 5);
    origin.rotation.y = 0.4;
    const head = new THREE.Object3D();
    head.position.set(0.6, 1.6, -0.8); // stood a step away from where the session began
    origin.add(head);
    origin.updateMatrixWorld(true);
    const before = head.getWorldPosition(new THREE.Vector3());

    const turned = turnAbout({ x: 2, z: 5, yaw: 0.4 }, { x: before.x, z: before.z }, -0.7);
    origin.position.set(turned.x, 0, turned.z);
    origin.rotation.y = turned.yaw;
    origin.updateMatrixWorld(true);
    const after = head.getWorldPosition(new THREE.Vector3());
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.z).toBeCloseTo(before.z, 9);
  });

  it("floats the ball a few centimetres out of the palm", () => {
    const ball = ballAbove(at(0, 1, 0));
    expect(ball.y - 1).toBeGreaterThan(0.03);
    expect(ball.y - 1).toBeLessThan(0.12);
  });
});
