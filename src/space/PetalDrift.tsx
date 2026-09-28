import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

/**
 * PETALS DRIFTING DOWN over the sand garden and the tea table: a few dozen pale
 * pink blossom petals falling slowly out of nothing, turning as they fall,
 * swaying on a light air, and settling on nothing. Something to watch while
 * sitting still. The same petals for everyone (they fall on the clock).
 */

export const PETALS_AT = { x: -2.0, z: 6.0, width: 2.6, depth: 2.2, top: 2.6 } as const;
const COUNT = 60;

/** Where petal `index` is at `seconds`: falling slowly, swaying, and turning. */
export function petalAt(index: number, seconds: number, reducedMotion = false): { x: number; y: number; z: number; spin: number } {
  if (reducedMotion) seconds = 0;
  const s = index * 7.31;
  const fall = 0.18 + (index % 7) * 0.015;
  const cycle = PETALS_AT.top / fall;
  const t = (seconds + s * 3.1) % cycle;
  const baseX = ((Math.sin(s * 1.9) + 1) / 2 - 0.5) * PETALS_AT.width;
  const baseZ = ((Math.cos(s * 2.7) + 1) / 2 - 0.5) * PETALS_AT.depth;
  return {
    x: PETALS_AT.x + baseX + Math.sin(t * 0.9 + s) * 0.25,
    y: PETALS_AT.top - t * fall,
    z: PETALS_AT.z + baseZ + Math.cos(t * 0.7 + s) * 0.2,
    spin: t * (1.2 + (index % 3) * 0.4) + s,
  };
}

export function PetalDrift({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const turn = useMemo(() => new THREE.Quaternion(), []);
  const euler = useMemo(() => new THREE.Euler(), []);
  const at = useMemo(() => new THREE.Vector3(), []);
  const size = useMemo(() => new THREE.Vector3(0.018, 0.012, 1), []);

  useFrame(() => {
    const node = mesh.current;
    if (!node) return;
    const seconds = Date.now() / 1000;
    for (let i = 0; i < COUNT; i += 1) {
      const petal = petalAt(i, seconds, reducedMotion);
      euler.set(petal.spin, petal.spin * 0.7, petal.spin * 0.3);
      turn.setFromEuler(euler);
      at.set(petal.x, petal.y, petal.z);
      matrix.compose(at, turn, size);
      node.setMatrixAt(i, matrix);
    }
    node.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]} raycast={() => null} frustumCulled={false}>
      <circleGeometry args={[1, 8]} />
      <meshStandardMaterial color="#f6c9d6" roughness={0.8} side={THREE.DoubleSide} transparent opacity={0.9} />
    </instancedMesh>
  );
}
