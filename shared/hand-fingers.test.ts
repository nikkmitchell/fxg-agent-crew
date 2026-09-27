import { describe, expect, it } from "vitest";
import { FINGER_ANGLES, FINGER_JOINT_NAMES, fingerAngles, fingersForWire, isBend, isSpread, parseFingers, type V3 } from "./hand-fingers.js";
import { parseClientMessage } from "./space-wire.js";

/**
 * Finger angles from tracked joints (Nikk: "so that hand movement is synced").
 * A hand is built here from known angles, in the WebXR wrist frame, and the
 * angles are read back out of its joints.
 */
const FINGER: V3 = { x: 0, y: 0, z: -1 };
const PALM: V3 = { x: 0, y: -1, z: 0 };
/** Across the hand: a bend toward the palm turns about this. */
const ACROSS: V3 = { x: -1, y: 0, z: 0 };

const add = (a: V3, b: V3, s = 1): V3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
/** Rodrigues: `v` turned by `angle` about the unit `axis`. */
function turn(v: V3, axis: V3, angle: number): V3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  const d = v.x * axis.x + v.y * axis.y + v.z * axis.z;
  const k = { x: axis.y * v.z - axis.z * v.y, y: axis.z * v.x - axis.x * v.z, z: axis.x * v.y - axis.y * v.x };
  return { x: v.x * c + k.x * s + axis.x * d * (1 - c), y: v.y * c + k.y * s + axis.y * d * (1 - c), z: v.z * c + k.z * s + axis.z * d * (1 - c) };
}
const unit = (v: V3): V3 => { const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/** A right hand's joints, in FINGER_JOINT_NAMES order, posed by `angles`. */
function hand(angles: number[]): V3[] {
  const joints: V3[] = [];
  // The thumb leaves the wrist on the index side (-X on a right hand), its
  // base bone pointing the way the first two angles say.
  let at: V3 = { x: -0.025, y: -0.01, z: -0.03 };
  const [out, down] = angles;
  let along = add(add(scale(FINGER, Math.cos(down) * Math.cos(out)), ACROSS, Math.cos(down) * Math.sin(out)), PALM, Math.sin(down));
  const lengths = [0.04, 0.032, 0.025];
  joints.push(at);
  for (let i = 0; i < 3; i++) {
    at = add(at, along, lengths[i]);
    joints.push(at);
    if (i < 2) along = turn(along, unit(cross(along, PALM)), angles[2 + i]);
  }
  for (let finger = 0; finger < 4; finger++) {
    const [spread, ...bends] = angles.slice(4 + finger * 4, 8 + finger * 4);
    let at: V3 = { x: -0.02 + finger * 0.015, y: 0, z: -0.02 };
    joints.push(at);
    at = add(at, FINGER, 0.07);
    joints.push(at);
    let bent = 0;
    for (let i = 0; i < 3; i++) {
      bent += bends[i];
      const direction = turn(turn(FINGER, ACROSS, bent), PALM, spread);
      at = add(at, direction, [0.045, 0.028, 0.022][i]);
      joints.push(at);
    }
  }
  return joints;
}

const flat = () => new Array(FINGER_ANGLES).fill(0);
/** Thumb swung across and down into the palm and bent; every finger curled. */
const fist = () => [1.0, 0.5, 0.6, 0.6, ...[0, 1, 2, 3].flatMap(() => [0, 1.3, 1.3, 1.3])];

describe("finger angles from tracked joints", () => {
  it("reads every joint the angles need, and twenty angles a hand", () => {
    expect(FINGER_JOINT_NAMES).toHaveLength(24);
    expect(fingerAngles(hand(flat()), FINGER, PALM)).toHaveLength(FINGER_ANGLES);
  });

  it("reads a flat hand as flat", () => {
    for (const angle of fingerAngles(hand(flat()), FINGER, PALM)!) expect(angle).toBeCloseTo(0, 6);
  });

  it("reads back the angles a hand was bent to: a fist, and a point", () => {
    const made = fist();
    const readFist = fingerAngles(hand(made), FINGER, PALM)!;
    made.forEach((angle, i) => expect(readFist[i], `slot ${i}`).toBeCloseTo(angle, 6));
    // Index straight, the rest curled: pointing.
    const point = fist().map((a, i) => (i >= 4 && i < 8 ? 0 : a));
    const read = fingerAngles(hand(point), FINGER, PALM)!;
    point.forEach((angle, i) => expect(read[i], `slot ${i}`).toBeCloseTo(angle, 6));
  });

  it("reads a spread hand: fingers fanned apart, each its own way", () => {
    const spread = flat();
    spread[4] = 0.25; spread[16] = -0.3;
    const read = fingerAngles(hand(spread), FINGER, PALM)!;
    expect(read[4]).toBeCloseTo(0.25, 6);
    expect(read[16]).toBeCloseTo(-0.3, 6);
  });

  it("does not read spread from a finger folded straight into the palm, where it is only noise", () => {
    const folded = flat();
    folded[4] = 0.3; folded[5] = Math.PI / 2;
    expect(Math.abs(fingerAngles(hand(folded), FINGER, PALM)![4])).toBeLessThan(0.05);
  });

  /**
   * Recorded from Nikk's headset (2026-09-27): his fists arrived with ring and
   * little spread at the 34° limit, and a curled finger turned that far about
   * the palm swings across its neighbours on everybody else's screen (5142).
   */
  it("reads no spread from a curled finger, however it drifts sideways, and full spread from a straight one", () => {
    const curledAndDrifting = fist();
    for (const finger of [0, 1, 2, 3]) curledAndDrifting[4 + finger * 4] = finger % 2 ? 0.5 : -0.5;
    const read = fingerAngles(hand(curledAndDrifting), FINGER, PALM)!;
    for (const finger of [0, 1, 2, 3]) expect(Math.abs(read[4 + finger * 4]), `finger ${finger}`).toBeLessThan(0.01);
    const splayed = flat();
    splayed[4] = 0.3;
    splayed[16] = -0.3;
    const open = fingerAngles(hand(splayed), FINGER, PALM)!;
    expect(open[4]).toBeCloseTo(0.3, 2);
    expect(open[16]).toBeCloseTo(-0.3, 2);
  });

  it("gives up on a hand with a joint missing, rather than posing half of one", () => {
    const joints: Array<V3 | null> = hand(flat());
    joints[7] = null;
    expect(fingerAngles(joints, FINGER, PALM)).toBeNull();
    expect(fingerAngles([], FINGER, PALM)).toBeNull();
  });

  it("does not depend on which frame the hand is in", () => {
    const made = fist();
    const yaw = (v: V3) => turn(v, { x: 0, y: 1, z: 0 }, 1.1);
    const read = fingerAngles(hand(made).map(yaw), yaw(FINGER), yaw(PALM))!;
    made.forEach((angle, i) => expect(read[i]).toBeCloseTo(angle, 6));
  });
});

describe("finger angles on the wire", () => {
  it("lays out four a finger: the thumb's direction and bends, then each finger's spread and bends", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 16, 19].map((i) => (isSpread(i) ? "s" : isBend(i) ? "b" : "t")).join("")).toBe("ttbbsbbbsb");
  });

  it("rounds to a hundredth of a radian", () => {
    expect(fingersForWire([0.123456, -1.005])).toEqual([0.12, -1]);
  });

  it("keeps a hand's fingers through the socket, and drops only what is unreadable", () => {
    const f = fingersForWire(fist());
    const q = { x: 0, y: 0, z: 0, w: 1 };
    const move = parseClientMessage(
      JSON.stringify({ type: "move", at: { x: 0, y: 0, z: 0 }, facing: 0, hands: { left: { p: { x: 0, y: 1, z: 0 }, q, f }, right: { p: { x: 0, y: 1, z: 0 }, q, f: [1, 2] } } }),
    );
    expect(move?.type === "move" && move.hands?.left?.f).toEqual(f);
    // A malformed finger list loses the fingers and keeps the wrist.
    expect(move?.type === "move" && move.hands?.right).toEqual({ p: { x: 0, y: 1, z: 0 }, q });
  });

  it("clamps an angle past what a knuckle can do, and refuses anything but numbers", () => {
    const wild = flat();
    wild[0] = 9; wild[1] = -9; wild[4] = 3; wild[5] = 9; wild[6] = -9;
    const parsed = parseFingers(wild)!;
    expect(parsed[0]).toBe(Math.PI);
    expect(parsed[1]).toBe(-Math.PI / 2);
    expect(parsed[4]).toBe(0.6);
    expect(parsed[5]).toBe(2);
    expect(parsed[6]).toBe(-0.6);
    expect(parseFingers([...flat().slice(1), "1"])).toBeUndefined();
    expect(parseFingers([...flat().slice(1), 1e999])).toBeUndefined();
    expect(parseFingers({})).toBeUndefined();
  });
});
