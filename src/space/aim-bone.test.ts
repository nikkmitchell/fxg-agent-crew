import { describe, expect, test } from "vitest";
import * as THREE from "three";
import { aimSegment } from "./aim-bone";

/**
 * A normalised VRM bone in miniature: a parent at the shoulder with identity
 * rotation, and a child bone whose segment rests along -X, the way a left arm
 * does in a T-pose.
 */
function rig(restDir: THREE.Vector3, parentRotation = new THREE.Euler(0, 0, 0)) {
  const root = new THREE.Object3D();
  root.rotation.copy(parentRotation);
  const bone = new THREE.Object3D();
  bone.position.set(0, 1.4, 0);
  root.add(bone);
  root.updateWorldMatrix(true, true);
  return { root, bone, restDir };
}

/** Where the far end of the segment ends up, in world space. */
function tipOf(bone: THREE.Object3D, restDir: THREE.Vector3, length: number) {
  bone.updateWorldMatrix(true, false);
  const at = new THREE.Vector3();
  bone.getWorldPosition(at);
  const q = new THREE.Quaternion();
  bone.getWorldQuaternion(q);
  return at.add(restDir.clone().applyQuaternion(q).multiplyScalar(length));
}

describe("aimSegment", () => {
  test("the segment ends up pointing at the target", () => {
    const rest = new THREE.Vector3(-1, 0, 0);
    const { root, bone } = rig(rest);
    const target = new THREE.Vector3(0.3, 0.9, 0.4);
    aimSegment(bone, rest, target);
    root.updateWorldMatrix(true, true);

    const shoulder = new THREE.Vector3();
    bone.getWorldPosition(shoulder);
    const length = shoulder.distanceTo(target);
    expect(tipOf(bone, rest, length).distanceTo(target)).toBeLessThan(1e-6);
  });

  test("it works when the parent is itself turned", () => {
    // The case the old code got wrong in the room: a body facing any direction
    // but zero. The rotation is expressed in the parent\u2019s frame, so ignoring
    // the parent swings the arm off by however far the body has turned.
    const rest = new THREE.Vector3(-1, 0, 0);
    const { root, bone } = rig(rest, new THREE.Euler(0, 1.1, 0));
    const target = new THREE.Vector3(-0.6, 1.1, 0.8);
    aimSegment(bone, rest, target);
    root.updateWorldMatrix(true, true);

    const shoulder = new THREE.Vector3();
    bone.getWorldPosition(shoulder);
    expect(tipOf(bone, rest, shoulder.distanceTo(target)).distanceTo(target)).toBeLessThan(1e-6);
  });

  test("a rest direction that is not \u00b1X is handled too", () => {
    // An A-pose model rests with its arms down and out, not straight sideways.
    const rest = new THREE.Vector3(-0.7, -0.7, 0).normalize();
    const { root, bone } = rig(rest);
    const target = new THREE.Vector3(0.5, 1.9, -0.2);
    aimSegment(bone, rest, target);
    root.updateWorldMatrix(true, true);

    const shoulder = new THREE.Vector3();
    bone.getWorldPosition(shoulder);
    expect(tipOf(bone, rest, shoulder.distanceTo(target)).distanceTo(target)).toBeLessThan(1e-6);
  });

  test("a target sitting on the joint leaves the bone alone rather than breaking it", () => {
    const rest = new THREE.Vector3(-1, 0, 0);
    const { root, bone } = rig(rest);
    const before = bone.quaternion.clone();
    const on = new THREE.Vector3();
    bone.getWorldPosition(on);
    aimSegment(bone, rest, on);
    root.updateWorldMatrix(true, true);
    expect(bone.quaternion.angleTo(before)).toBe(0);
    expect(Number.isNaN(bone.quaternion.x)).toBe(false);
  });

  test("a bone with no parent is left alone", () => {
    const orphan = new THREE.Object3D();
    const before = orphan.quaternion.clone();
    aimSegment(orphan, new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 1, 1));
    expect(orphan.quaternion.angleTo(before)).toBe(0);
  });
});
