import * as THREE from "three";
import type { RecordedControl } from "./avatar-recording";

const position = new THREE.Vector3();
const rotation = new THREE.Quaternion();

export function recordedControl(node: THREE.Object3D | null): RecordedControl {
  if (!node?.visible) return null;
  node.updateWorldMatrix(true, false);
  node.getWorldPosition(position);
  node.getWorldQuaternion(rotation);
  return {
    p: { x: position.x, y: position.y, z: position.z },
    q: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
  };
}

export const recorderControlVisual: { micBar: RecordedControl; personalUi: RecordedControl } = {
  micBar: null,
  personalUi: null,
};
