import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";

/**
 * THE STILL FLOWER: a closed pale bud on a low stem. Come within a couple of
 * metres and keep still, and over about a minute it opens, petal by petal,
 * and begins to glow. Move, and it slowly closes again. It answers only to
 * you; nothing is sent. A small reward for being still.
 */

export const STILL_AT = { x: -1.2, z: 2.4 } as const;
const NEAR = 2.2;
const PETALS = 10;
/** Seconds of stillness to open fully. */
export const OPEN_SECONDS = Number(new URLSearchParams(globalThis.location?.search ?? "").get("openSeconds")) || 60;

/**
 * One step of the flower's openness (0 closed, 1 open): stillness opens it
 * steadily, movement closes it three times as fast, and far away it closes.
 * `moved` is how far the head moved this step, in metres.
 */
export function openStep(open: number, moved: number, delta: number, near: boolean): number {
  const still = near && moved / Math.max(delta, 1e-3) < 0.06;
  const next = still ? open + delta / OPEN_SECONDS : open - (3 * delta) / OPEN_SECONDS;
  return Math.min(1, Math.max(0, next));
}

export function StillFlower() {
  const petals = useRef<THREE.InstancedMesh>(null);
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  const light = useRef<THREE.PointLight>(null);
  const open = useRef(0);
  const last = useRef<THREE.Vector3 | null>(null);
  const eye = useMemo(() => new THREE.Vector3(), []);
  const root = useRef<THREE.Group>(null);
  const here = useMemo(() => new THREE.Vector3(), []);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const turn = useMemo(() => new THREE.Quaternion(), []);
  const euler = useMemo(() => new THREE.Euler(), []);
  const at = useMemo(() => new THREE.Vector3(), []);
  const size = useMemo(() => new THREE.Vector3(0.018, 0.06, 0.006), []);

  useFrame((state, delta) => {
    state.camera.getWorldPosition(eye);
    const moved = last.current ? eye.distanceTo(last.current) : 1;
    last.current = (last.current ?? new THREE.Vector3()).copy(eye);
    root.current?.getWorldPosition(here);
    const near = Math.hypot(eye.x - here.x, eye.z - here.z) < NEAR;
    open.current = openStep(open.current, moved, Math.min(delta, 0.1), near);
    const o = open.current;
    const node = petals.current;
    if (node) {
      for (let i = 0; i < PETALS; i += 1) {
        // Petals open one after another: the outer ring first.
        const own = Math.min(1, Math.max(0, o * 1.6 - (i % 2) * 0.35 - (i / PETALS) * 0.25));
        const angle = (i / PETALS) * Math.PI * 2 + (i % 2) * 0.3;
        const lean = 0.12 + own * (i % 2 ? 1.05 : 1.3);
        euler.set(lean, angle, 0, "YXZ");
        turn.setFromEuler(euler);
        // Each petal rises from the bud's centre; the matrix pivots it at its base.
        at.set(Math.sin(angle) * Math.sin(lean) * 0.055, 0.5 + Math.cos(lean) * 0.055, Math.cos(angle) * Math.sin(lean) * 0.055);
        matrix.compose(at, turn, size);
        node.setMatrixAt(i, matrix);
      }
      node.instanceMatrix.needsUpdate = true;
    }
    const breathe = 0.85 + Math.sin(state.clock.elapsedTime * 1.2) * 0.15;
    if (glow.current) glow.current.opacity = o * o * 0.8 * breathe;
    if (light.current) light.current.intensity = o * o * 1.2 * breathe;
  });

  return (
    <group ref={root} position={[STILL_AT.x, 0, STILL_AT.z]}>
      <mesh position={[0, 0.25, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.006, 0.009, 0.5, 6]} />
        <meshStandardMaterial color="#3f5f34" roughness={0.8} />
      </mesh>
      <instancedMesh ref={petals} args={[undefined, undefined, PETALS]} raycast={() => null} frustumCulled={false}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial color="#f3eef8" emissive="#cfc2ff" emissiveIntensity={0.25} roughness={0.5} />
      </instancedMesh>
      <mesh position={[0, 0.52, 0]} raycast={() => null}>
        <sphereGeometry args={[0.05, 12, 10]} />
        <meshBasicMaterial ref={glow} color="#e6dcff" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <pointLight ref={light} position={[0, 0.6, 0]} color="#d9ccff" intensity={0} distance={1.8} decay={2} />
      <Text position={[0, 0.08, 0.08]} rotation-x={-0.9} fontSize={0.028} color="#cfc6b4" outlineWidth={0.002} outlineColor="#1a1714" raycast={() => null}>
        be still, and it opens
      </Text>
    </group>
  );
}
