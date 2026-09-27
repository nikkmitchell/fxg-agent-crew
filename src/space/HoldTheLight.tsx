import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { WirePerson } from "../../shared/space-wire";
import { selfPose } from "./self-pose";

/**
 * HOLD THE LIGHT: a qigong exercise. Stand at the low pedestal and bring your
 * hands up in front of you, palms facing, as if holding a ball: a ball of soft
 * light appears between them. Part your hands as you breathe in and it grows
 * and brightens; bring them together as you breathe out and it gathers. The
 * breath made visible, in your own hands.
 *
 * Anyone's hands at the pedestal hold their own light, and everyone sees each
 * one, because the room already shares where hands are. Nothing new is sent.
 */

// Open floor at the back, behind the lanterns, clear of the dome and the book.
export const LIGHT_AT = { x: -0.4, z: 1.2, reach: 0.9 } as const;

/**
 * The ball two hands make, or null: they must be near the pedestal, at chest
 * height or so, and between a fist's width and a shoulder's width apart.
 */
export function ballBetween(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
): { x: number; y: number; z: number; radius: number } | null {
  const gap = Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
  const middle = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, z: (left.z + right.z) / 2 };
  if (Math.hypot(middle.x - LIGHT_AT.x, middle.z - LIGHT_AT.z) > LIGHT_AT.reach) return null;
  if (middle.y < 0.7 || middle.y > 1.9) return null;
  if (gap < 0.06 || gap > 0.6) return null;
  return { ...middle, radius: gap * 0.38 };
}

const MOST = 6;

export function HoldTheLight({ peopleRef, you }: { peopleRef: MutableRefObject<WirePerson[] | null> | { current: WirePerson[] | null }; you: string | null }) {
  const balls = useRef<(THREE.Mesh | null)[]>([]);
  const halos = useRef<(THREE.Mesh | null)[]>([]);
  const shown = useRef(Array.from({ length: MOST }, () => ({ x: 0, y: 0, z: 0, r: 0 })));
  const glowMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#ffe7b0", transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }),
    [],
  );
  const haloMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#ffb86b", transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    [],
  );
  const ring = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((state, delta) => {
    const pairs: { left: { x: number; y: number; z: number }; right: { x: number; y: number; z: number } }[] = [];
    if (selfPose.hands.left && selfPose.hands.right) pairs.push({ left: selfPose.hands.left.p, right: selfPose.hands.right.p });
    for (const person of peopleRef.current ?? []) {
      if (you && person.actorId.toLowerCase() === you.toLowerCase()) continue;
      if (person.hands?.left && person.hands?.right) pairs.push({ left: person.hands.left.p, right: person.hands.right.p });
    }
    const found = pairs.map((pair) => ballBetween(pair.left, pair.right)).filter((ball): ball is NonNullable<typeof ball> => ball !== null);
    const t = state.clock.elapsedTime;
    for (let i = 0; i < MOST; i += 1) {
      const target = found[i];
      const now = shown.current[i];
      const ease = Math.min(1, delta * 10);
      if (target) {
        now.x = target.x;
        now.y = target.y;
        now.z = target.z;
        now.r += (target.radius - now.r) * ease;
      } else {
        now.r += (0 - now.r) * ease;
      }
      const ball = balls.current[i];
      const halo = halos.current[i];
      const visible = now.r > 0.004;
      if (ball) {
        ball.visible = visible;
        ball.position.set(now.x, now.y, now.z);
        ball.scale.setScalar(Math.max(0.001, now.r * (1 + Math.sin(t * 3 + i) * 0.03)));
      }
      if (halo) {
        halo.visible = visible;
        halo.position.set(now.x, now.y, now.z);
        halo.scale.setScalar(Math.max(0.001, now.r * 2.2));
      }
    }
    if (ring.current) ring.current.opacity = 0.25 + (found.length ? 0.3 : 0) + Math.sin(t) * 0.05;
  });

  return (
    <group>
      {/* The pedestal, and a soft ring round where to stand. */}
      <group position={[LIGHT_AT.x, 0, LIGHT_AT.z]}>
        <mesh position={[0, 0.3, 0]} raycast={() => null}>
          <cylinderGeometry args={[0.07, 0.12, 0.6, 16]} />
          <meshStandardMaterial color="#4a4640" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.63, 0]} raycast={() => null}>
          <sphereGeometry args={[0.05, 16, 12]} />
          <meshBasicMaterial color="#ffe7b0" toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.012, 0]} rotation-x={-Math.PI / 2} raycast={() => null}>
          <ringGeometry args={[LIGHT_AT.reach - 0.03, LIGHT_AT.reach, 64]} />
          <meshBasicMaterial ref={ring} color="#ffcf8a" transparent opacity={0.3} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
      {Array.from({ length: MOST }, (_, i) => (
        <group key={i}>
          <mesh ref={(node) => { balls.current[i] = node; }} material={glowMaterial} visible={false} raycast={() => null}>
            <sphereGeometry args={[1, 20, 14]} />
          </mesh>
          <mesh ref={(node) => { halos.current[i] = node; }} material={haloMaterial} visible={false} raycast={() => null}>
            <sphereGeometry args={[1, 16, 12]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
