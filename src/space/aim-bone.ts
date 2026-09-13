import * as THREE from "three";

/**
 * Turn a bone so that the segment it drives points where you want it to.
 *
 * WHAT THIS REPLACES, and why the old one could not have worked. It was
 * `bone.lookAt(target)` followed by `bone.rotateX(Math.PI / 2)`, which aims a
 * bone's local +Y axis. That is the right move for a rig whose bones run along
 * their own +Y — and three-vrm's NORMALISED bones are not such a rig. They are
 * built with identity rotation and world-aligned axes at rest, so an arm bone's
 * +Y points at the ceiling while the arm itself points sideways. Every arm was
 * solved about a quarter turn away from the hand it was supposed to reach.
 *
 * So: rotate from the segment's MEASURED rest direction to the direction you
 * want, expressed in the bone's own parent space. `restDir` comes from
 * `armSpecOf`, which measures it off the model.
 *
 * The caller must have the parent's world matrix up to date — after moving an
 * upper arm, the forearm's parent has moved with it.
 */
export function aimSegment(
  bone: THREE.Object3D,
  restDir: THREE.Vector3,
  targetWorld: THREE.Vector3,
): void {
  const parent = bone.parent;
  if (!parent) return;
  parent.updateWorldMatrix(true, false);

  bone.getWorldPosition(FROM);
  WANT.copy(targetWorld).sub(FROM);
  // A target sitting exactly on the joint has no direction to point in; leaving
  // the bone where it is beats a NaN rotation, which propagates to the whole
  // skeleton and makes the body vanish.
  if (WANT.lengthSq() < 1e-12) return;
  WANT.normalize();

  parent.getWorldQuaternion(PARENT);
  // The wanted direction, said in the parent's frame — because that is the
  // frame the bone's own rotation is expressed in.
  WANT.applyQuaternion(PARENT.invert());
  bone.quaternion.setFromUnitVectors(restDir, WANT);
}

const FROM = new THREE.Vector3();
const WANT = new THREE.Vector3();
const PARENT = new THREE.Quaternion();
