import { useMemo } from "react";
import { Line, Text } from "@react-three/drei";
import * as THREE from "three";
import { LABYRINTH, labyrinthPath } from "../../shared/labyrinth";

/**
 * THE WALKING LABYRINTH (shared/labyrinth.ts): the classical seven-circuit
 * path drawn as a soft line of light on the floor, behind where people
 * arrive. Turn round, find the mouth, and follow the line in to the centre
 * and back out, slowly. In passthrough it lies on your own floor. A separate
 * experience (Nikk, 5484); nothing is sent or kept.
 */
const noRaycast = () => undefined;

export function Labyrinth() {
  const points = useMemo(
    () => labyrinthPath().map((point) => new THREE.Vector3(point.x, 0.012, point.z)),
    [],
  );
  return <group position={[LABYRINTH.x, 0, LABYRINTH.z]}>
    <Line points={points} color="#cfe9ff" lineWidth={3} transparent opacity={0.75} raycast={noRaycast} />
    {/* The centre: a soft pool of light to stand in. */}
    <mesh position={[0, 0.011, 0]} rotation-x={-Math.PI / 2} raycast={noRaycast}>
      <circleGeometry args={[0.2, 40]} />
      <meshBasicMaterial color="#f2d59a" transparent opacity={0.35} depthWrite={false} toneMapped={false} />
    </mesh>
    {/* A small sign at the mouth, lying back so it reads from standing height. */}
    <Text position={[0, 0.02, -(LABYRINTH.outer + 0.45)]} rotation={[Math.PI / 2.4, Math.PI, 0]} fontSize={0.07} color="#eefaf7" raycast={noRaycast} outlineWidth={0.004} outlineColor="#0b1418">
      {"LABYRINTH · ONE PATH IN, THE SAME PATH OUT · WALK SLOWLY"}
    </Text>
  </group>;
}
