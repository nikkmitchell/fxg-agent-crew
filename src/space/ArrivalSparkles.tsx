import { useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { WirePerson } from "../../shared/space-wire";
import { SPARKLE_COUNT, SPARKLE_LIFE_S, arrivals, burstVelocities, sparkleOpacity, stepSparkles } from "./arrival-sparkle";
import { useDisposableList } from "./use-disposable";

/** At most this many bursts at once; a fifth arrival reuses the oldest. */
const POOL = 4;

type Burst = {
  points: THREE.Points;
  positions: Float32Array;
  velocities: Float32Array;
  age: number;
  live: boolean;
};

/**
 * Sparks where an agent reaches a board, the moment its card change lands.
 * See arrival-sparkle.ts. Nothing at all under reduced motion.
 */
export function ArrivalSparkles({
  peopleRef,
  reducedMotion,
}: {
  peopleRef: RefObject<WirePerson[]>;
  reducedMotion: boolean;
}) {
  const seen = useRef(new Map<string, boolean>());
  const next = useRef(0);
  const seed = useRef(1);

  // Freed on unmount: switching rooms remounts the scene, and each pool
  // used to stay on the GPU.
  const bursts = useDisposableList<Burst>(
    () =>
      Array.from({ length: POOL }, () => {
        const positions = new Float32Array(SPARKLE_COUNT * 3);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({
          color: "#ffd23f",
          size: 0.06,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const points = new THREE.Points(geometry, material);
        points.visible = false;
        points.frustumCulled = false;
        return { points, positions, velocities: new Float32Array(SPARKLE_COUNT * 3), age: 0, live: false };
      }),
    (one) => {
      one.points.geometry.dispose();
      (one.points.material as THREE.Material).dispose();
    },
  );

  useFrame((_, delta) => {
    const people = peopleRef.current ?? [];
    const arrived = arrivals(seen.current, people);
    if (!reducedMotion) {
      for (const actorId of arrived) {
        const person = people.find((candidate) => candidate.actorId === actorId);
        if (!person) continue;
        const burst = bursts[next.current];
        next.current = (next.current + 1) % POOL;
        // In front of the agent, at about hand height for a half-size figure.
        burst.points.position.set(
          person.at.x - Math.sin(person.facing) * 0.45,
          0.75,
          person.at.z - Math.cos(person.facing) * 0.45,
        );
        burst.positions.fill(0);
        burst.velocities.set(burstVelocities(seed.current++));
        burst.age = 0;
        burst.live = true;
        burst.points.visible = true;
      }
    }

    const dt = Math.min(delta, 0.05);
    for (const burst of bursts) {
      if (!burst.live) continue;
      burst.age += dt;
      stepSparkles(burst.positions, burst.velocities, dt);
      (burst.points.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (burst.points.material as THREE.PointsMaterial).opacity = sparkleOpacity(burst.age);
      if (burst.age >= SPARKLE_LIFE_S) {
        burst.live = false;
        burst.points.visible = false;
      }
    }
  });

  return (
    <group>
      {bursts.map((burst, index) => (
        <primitive key={index} object={burst.points} />
      ))}
    </group>
  );
}
