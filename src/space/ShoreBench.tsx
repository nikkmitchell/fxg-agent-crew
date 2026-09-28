import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { WAVE_SECONDS } from "./Shore";

/**
 * A DRIFTWOOD BENCH facing the shore. Sit (or just stand) at it and it counts,
 * quietly, the waves you have watched come in: "12 waves". Nothing to do but
 * that. Only you see your count; it starts again when you leave.
 */

export const BENCH_AT = { x: -4.8, z: 1.7 } as const;
const NEAR = 0.7;

/** How many whole waves have come in between `since` and `now` (seconds). */
export function wavesWatched(since: number, now: number): number {
  return Math.max(0, Math.floor(now / WAVE_SECONDS) - Math.floor(since / WAVE_SECONDS));
}

export function ShoreBench() {
  const eye = useMemo(() => new THREE.Vector3(), []);
  const since = useRef<number | null>(null);
  const [count, setCount] = useState<number | null>(null);

  useFrame((state) => {
    state.camera.getWorldPosition(eye);
    const here = Math.hypot(eye.x - BENCH_AT.x, eye.z - BENCH_AT.z) < NEAR;
    const now = Date.now() / 1000;
    if (here && since.current === null) since.current = now;
    if (!here) since.current = null;
    const next = since.current === null ? null : wavesWatched(since.current, now);
    if (next !== count) setCount(next);
  });

  return (
    <group position={[BENCH_AT.x, 0, BENCH_AT.z]}>
      {/* A weathered log seat on two stones; it faces the sea (-z). */}
      <mesh position={[0, 0.42, 0]} rotation-z={Math.PI / 2} raycast={() => null}>
        <cylinderGeometry args={[0.11, 0.12, 1.1, 10]} />
        <meshStandardMaterial color="#a39279" roughness={1} flatShading />
      </mesh>
      {[-0.38, 0.38].map((x) => (
        <mesh key={x} position={[x, 0.16, 0]} scale={[0.14, 0.16, 0.14]} raycast={() => null}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#5f5a52" roughness={0.95} flatShading />
        </mesh>
      ))}
      <Text position={[0, 0.6, 0.05]} rotation-x={-0.5} fontSize={0.04} color="#e8e0cf" outlineWidth={0.002} outlineColor="#1a1714" raycast={() => null}>
        {count === null ? "sit and watch the waves" : count === 0 ? "the next wave is coming" : count === 1 ? "1 wave" : `${count} waves`}
      </Text>
    </group>
  );
}
