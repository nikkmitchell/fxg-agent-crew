import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ROOM } from "../../shared/space-layout";
import { frameAt, type AvatarFrame } from "./avatar-recording";
import { stagedFrames } from "./AvatarReplay";
import { recordedControl } from "./recorder-control-visual";

const frame = (t: number): AvatarFrame => ({
  t,
  head: { p: { x: 2, y: 1.6, z: 8 }, q: { x: 0, y: 0, z: 0, w: 1 } },
  hands: { left: null, right: null },
  balls: { left: { p: { x: 1, y: 1.2, z: 8 } }, leftShadow: null, right: null, rightShadow: null },
  micBar: null,
  personalUi: null,
});

describe("avatar recording timeline", () => {
  it("holds the last measured frame until the next sample", () => {
    const frames = [frame(0), frame(50), frame(100)];
    expect(frameAt(frames, 75)).toBe(frames[1]);
    expect(frameAt(frames, -1)).toBe(frames[0]);
    expect(frameAt(frames, 200)).toBe(frames[2]);
    expect(frameAt([], 50)).toBeNull();
  });

  it("stages a take ahead of arrivals and turns the whole captured rig together", () => {
    const staged = stagedFrames([frame(0)])[0];
    expect(staged.head.p.x).toBeCloseTo(ROOM.spawn.x);
    expect(staged.head.p.z).toBeCloseTo(ROOM.spawn.z - 1.5);
    expect(staged.head.p.y).toBeCloseTo(1.6);
    expect(staged.balls.left?.p.x).toBeCloseTo(ROOM.spawn.x + 1);
    expect(staged.head.q.y).toBeCloseTo(1);
  });

  it("captures controls in world coordinates beneath the XR origin", () => {
    const origin = new THREE.Group();
    origin.position.set(4, 0, 5);
    const ball = new THREE.Mesh();
    ball.position.set(0.5, 1, -1);
    origin.add(ball);
    expect(recordedControl(ball)?.p).toEqual({ x: 4.5, y: 1, z: 4 });
    ball.visible = false;
    expect(recordedControl(ball)).toBeNull();
  });
});
