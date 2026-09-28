import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";

/**
 * THE TIDE POOL beside the shore: a shallow ring of stones holding still water,
 * with pieces of sea glass glowing softly on the bottom. Tap one and it rises
 * to eye height, turning slowly and brightening as if held to the light, then
 * sinks back after a while. Just for you (nothing is sent): a thing to look at.
 */

export const TIDEPOOL_AT = { x: -3.5, z: -0.2, radius: 0.45 } as const;
const COLOURS = ["#7fd6c2", "#a8e6ff", "#c9f2a8", "#f3d6a0", "#b8a8f0", "#8fc4ff", "#e8b4c8"] as const;
const HELD_MS = 9_000;

/** Where glass `index` lies on the bottom of the pool, relative to its centre. */
export function glassRest(index: number): { x: number; z: number; turn: number } {
  const angle = index * 2.4 + 0.3;
  const r = 0.1 + ((index * 0.37) % 1) * 0.22;
  return { x: Math.cos(angle) * r, z: Math.sin(angle) * r, turn: index * 1.3 };
}

/** How far through being held, 0 resting to 1 at eye height, `ms` after the tap. */
export function liftAt(ms: number, reducedMotion = false): number {
  if (ms < 0 || ms > HELD_MS) return 0;
  if (reducedMotion) return 1;
  const rise = Math.min(1, ms / 1200);
  const fall = Math.min(1, (HELD_MS - ms) / 1500);
  return Math.min(rise, fall) ** 0.7;
}

export function TidePool({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const held = useRef<number[]>(COLOURS.map(() => -Infinity));
  const pieces = useRef<(THREE.Mesh | null)[]>([]);
  const glow = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const stones = useMemo(() => Array.from({ length: 14 }, (_, i) => (i / 14) * Math.PI * 2), []);

  useFrame((state) => {
    const now = performance.now();
    pieces.current.forEach((mesh, index) => {
      if (!mesh) return;
      const rest = glassRest(index);
      const lift = liftAt(now - held.current[index], reducedMotion);
      mesh.position.set(rest.x * (1 - lift), 0.03 + lift * 1.35, rest.z * (1 - lift) + lift * 0.25);
      mesh.rotation.set(lift * (reducedMotion ? 0 : 0.6), rest.turn + (reducedMotion ? 0 : lift * state.clock.elapsedTime * 0.8), 0);
      mesh.scale.setScalar(1 + lift * 0.6);
      const material = glow.current[index];
      if (material) material.emissiveIntensity = 0.35 + lift * 1.4 + (reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * 0.7 + index) * 0.08);
    });
  });

  const pick = (index: number) => (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (liftAt(performance.now() - held.current[index], reducedMotion) === 0) held.current[index] = performance.now();
  };

  return (
    <group position={[TIDEPOOL_AT.x, 0, TIDEPOOL_AT.z]}>
      {/* The still water. */}
      <mesh position={[0, 0.06, 0]} rotation-x={-Math.PI / 2} raycast={() => null}>
        <circleGeometry args={[TIDEPOOL_AT.radius, 40]} />
        <meshStandardMaterial color="#1d4a52" transparent opacity={0.55} roughness={0.05} metalness={0.2} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.004, 0]} rotation-x={-Math.PI / 2} raycast={() => null}>
        <circleGeometry args={[TIDEPOOL_AT.radius, 40]} />
        <meshStandardMaterial color="#6b6454" roughness={1} />
      </mesh>
      {/* The ring of stones. */}
      {/* One draw for all fourteen stones. */}
      <instancedMesh
        args={[undefined, undefined, stones.length]}
        raycast={() => null}
        ref={(node) => {
          if (!node) return;
          const matrix = new THREE.Matrix4();
          stones.forEach((angle, i) => {
            matrix.compose(
              new THREE.Vector3(Math.cos(angle) * (TIDEPOOL_AT.radius + 0.04), 0.05, Math.sin(angle) * (TIDEPOOL_AT.radius + 0.04)),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0)),
              new THREE.Vector3(0.09, 0.06, 0.07 + (i % 3) * 0.015),
            );
            node.setMatrixAt(i, matrix);
            node.setColorAt(i, new THREE.Color(i % 2 ? "#5d5850" : "#6e685d"));
          });
          node.instanceMatrix.needsUpdate = true;
          node.computeBoundingSphere();
        }}
      >
        <sphereGeometry args={[1, 10, 6]} />
        <meshStandardMaterial roughness={0.95} flatShading />
      </instancedMesh>
      {/* The sea glass: tap a piece to hold it to the light. */}
      {COLOURS.map((colour, index) => (
        <mesh key={colour} ref={(mesh) => { pieces.current[index] = mesh; }} onClick={pick(index)}>
          <dodecahedronGeometry args={[0.035, 0]} />
          <meshStandardMaterial ref={(material) => { glow.current[index] = material; }} color={colour} emissive={colour} emissiveIntensity={0.35} transparent opacity={0.85} roughness={0.4} flatShading />
        </mesh>
      ))}
    </group>
  );
}
