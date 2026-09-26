import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { MIC_GESTURE_JOINT_NAMES, micGestureHands, micGestureIndicator } from "./mic-gesture-input";

const BONES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8], [8, 9],
  [0, 10], [10, 11], [11, 12], [12, 13], [13, 14],
  [0, 15], [15, 16], [16, 17], [17, 18], [18, 19],
  [0, 20], [20, 21], [21, 22], [22, 23], [23, 24],
  [5, 10], [10, 15], [15, 20],
];
/** Outside edge of the hand silhouette, from thumb around to the little finger. */
const OUTLINE: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 9],
  [9, 14], [14, 19], [19, 24], [24, 23], [23, 22], [22, 21], [21, 20], [20, 0],
];

/** A light skeletal outline, drawn over the tracked hand while gesture recording. */
export function MicGestureOutline() {
  const group = useRef<THREE.Group>(null);
  const outer = useRef<THREE.LineBasicMaterial>(null);
  const pointsGlow = useRef<THREE.PointsMaterial>(null);
  const pointsCore = useRef<THREE.PointsMaterial>(null);
  const lineGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(BONES.length * 2 * 3);
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    return geometry;
  }, []);
  const outlineGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(OUTLINE.length * 2 * 3);
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    return geometry;
  }, []);
  const pointGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MIC_GESTURE_JOINT_NAMES.length * 3);
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    return geometry;
  }, []);

  useEffect(() => () => {
    lineGeometry.dispose();
    outlineGeometry.dispose();
    pointGeometry.dispose();
  }, [lineGeometry, outlineGeometry, pointGeometry]);

  useFrame(({ clock }) => {
    const side = micGestureIndicator.side;
    const hand = side ? micGestureHands[side] : null;
    const node = group.current;
    if (!node) return;
    node.visible = hand !== null;
    if (!hand) return;

    const linePosition = lineGeometry.getAttribute("position") as THREE.BufferAttribute;
    let lineCount = 0;
    for (const [from, to] of BONES) {
      const a = hand.joints[from];
      const b = hand.joints[to];
      if (!a || !b) continue;
      linePosition.setXYZ(lineCount++, a.x, a.y, a.z);
      linePosition.setXYZ(lineCount++, b.x, b.y, b.z);
    }
    linePosition.needsUpdate = true;
    lineGeometry.setDrawRange(0, lineCount);

    const outlinePosition = outlineGeometry.getAttribute("position") as THREE.BufferAttribute;
    let outlineCount = 0;
    for (const [from, to] of OUTLINE) {
      const a = hand.joints[from];
      const b = hand.joints[to];
      if (!a || !b) continue;
      outlinePosition.setXYZ(outlineCount++, a.x, a.y, a.z);
      outlinePosition.setXYZ(outlineCount++, b.x, b.y, b.z);
    }
    outlinePosition.needsUpdate = true;
    outlineGeometry.setDrawRange(0, outlineCount);

    const pointPosition = pointGeometry.getAttribute("position") as THREE.BufferAttribute;
    let pointCount = 0;
    hand.joints.forEach((joint) => {
      if (!joint) return;
      pointPosition.setXYZ(pointCount++, joint.x, joint.y, joint.z);
    });
    pointPosition.needsUpdate = true;
    pointGeometry.setDrawRange(0, pointCount);

    // A restrained pulse makes the capture visible without flashing in XR.
    if (outer.current) outer.current.opacity = 0.34 + (Math.sin(clock.elapsedTime * 5) + 1) * 0.08;
    if (pointsGlow.current) pointsGlow.current.opacity = 0.28 + (Math.sin(clock.elapsedTime * 5) + 1) * 0.07;
  });

  return (
    <group ref={group} visible={false} raycast={() => null} renderOrder={20}>
      <lineSegments geometry={outlineGeometry} raycast={() => null} renderOrder={20}>
        <lineBasicMaterial ref={outer} color="#55fff0" transparent opacity={0.45} depthTest={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </lineSegments>
      <lineSegments geometry={lineGeometry} raycast={() => null} renderOrder={21}>
        <lineBasicMaterial color="#eaffff" transparent opacity={0.92} depthTest={false} toneMapped={false} />
      </lineSegments>
      <points geometry={pointGeometry} raycast={() => null} renderOrder={22}>
        <pointsMaterial ref={pointsGlow} color="#55fff0" transparent opacity={0.4} size={12} sizeAttenuation={false} depthTest={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </points>
      <points geometry={pointGeometry} raycast={() => null} renderOrder={23}>
        <pointsMaterial ref={pointsCore} color="#ffffff" transparent opacity={0.95} size={4} sizeAttenuation={false} depthTest={false} toneMapped={false} />
      </points>
    </group>
  );
}
