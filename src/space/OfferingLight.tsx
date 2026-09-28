import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { WirePerson } from "../../shared/space-wire";
import { selfPose } from "./self-pose";

/**
 * THE OFFERING LIGHT, Inkstone's answer (5549) to "a practice for two
 * strangers who share no language": a low stone with a soft mark on each side.
 * When someone stands at each mark, a small light appears over the stone
 * between them. Reach toward it with a hand and it drifts halfway toward the
 * other person, and waits. They may reach and draw it the rest of the way,
 * and offer it back; or simply let it be, and after a while it settles back
 * to the middle. No turns to miss, no score, nothing said.
 *
 * Worked out on each device from where the two people and their hands are,
 * which the room already shares; nothing is sent or kept.
 */

export const OFFERING_AT = { x: 1.4, z: 0.2, apart: 0.7 } as const;
const LIGHT_Y = 1.15;

type Side = -1 | 1;

/**
 * Where the light wants to be along the line between the two marks, from -1
 * (at the left person) to 1 (at the right), given where it is and whose hand
 * is reaching into it. A reach sends it half the way to the other side; a
 * reach from the side it is waiting on draws it the rest of the way.
 */
export function nextPlace(place: number, reachingFrom: Side | null): number {
  if (reachingFrom === null) return place;
  const onMySide = Math.sign(place) === reachingFrom;
  // Waiting half way on your side: you draw it the rest of the way in.
  if (onMySide && Math.abs(place) < 0.8) return reachingFrom * 0.9;
  // In the middle, or already held by you: you offer it, and it goes half way to them.
  if (onMySide || place === 0) return -reachingFrom * 0.5;
  // Reaching across for one still on their side: it stays with them.
  return place;
}

export function OfferingLight({ peopleRef, you, reducedMotion = false }: { peopleRef: MutableRefObject<WirePerson[] | null> | { current: WirePerson[] | null }; you: string | null; reducedMotion?: boolean }) {
  const light = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const marks = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const state = useRef({ place: 0, shown: 0, target: 0, lastReach: 0, reaching: null as Side | null, idleSince: 0 });
  const eye = useMemo(() => new THREE.Vector3(), []);

  useFrame((frame, delta) => {
    frame.camera.getWorldPosition(eye);
    const markX = (side: Side) => OFFERING_AT.x + side * OFFERING_AT.apart;
    // Who stands at each mark, with their hands.
    const bodies: { x: number; z: number; hands: { x: number; y: number; z: number }[] }[] = [
      { x: eye.x, z: eye.z, hands: [selfPose.hands.left?.p, selfPose.hands.right?.p].filter((h): h is NonNullable<typeof h> => Boolean(h)) },
    ];
    for (const person of peopleRef.current ?? []) {
      if (you && person.actorId.toLowerCase() === you.toLowerCase()) continue;
      bodies.push({ x: person.at.x, z: person.at.z, hands: [person.hands?.left?.p, person.hands?.right?.p].filter((h): h is NonNullable<typeof h> => Boolean(h)) });
    }
    const standing = ([-1, 1] as Side[]).map((side) => bodies.find((body) => Math.hypot(body.x - markX(side), body.z - OFFERING_AT.z) < 0.55) ?? null);
    marks.current.forEach((material, index) => {
      if (material) material.opacity = standing[index] ? 0.55 : 0.2;
    });
    const both = standing[0] !== null && standing[1] !== null;

    const s = state.current;
    const now = performance.now();
    const lightX = OFFERING_AT.x + s.shown * OFFERING_AT.apart;
    // A hand of the person at a mark reaching into the light.
    let reaching: Side | null = null;
    ([-1, 1] as Side[]).forEach((side, index) => {
      const body = standing[index];
      if (!body) return;
      for (const hand of body.hands) {
        if (Math.hypot(hand.x - lightX, hand.y - LIGHT_Y, hand.z - OFFERING_AT.z) < 0.14) reaching = side;
      }
    });
    if (both && reaching !== null && reaching !== s.reaching && now - s.lastReach > 1200) {
      s.target = nextPlace(s.target, reaching);
      s.lastReach = now;
      s.idleSince = now;
    }
    s.reaching = reaching;
    // Left be for twenty seconds, it settles back to the middle.
    if (now - s.idleSince > 20_000) s.target = 0;
    const visible = both ? 1 : 0;
    if (reducedMotion) {
      s.shown = s.target;
      s.place = visible;
    } else {
      s.shown += (s.target - s.shown) * Math.min(1, delta * 0.9);
      s.place += (visible - s.place) * Math.min(1, delta * 1.5);
    }

    const x = OFFERING_AT.x + s.shown * OFFERING_AT.apart;
    const pulse = reducedMotion ? 1 : 1 + Math.sin(frame.clock.elapsedTime * 1.6) * 0.08;
    if (light.current) {
      light.current.position.set(x, LIGHT_Y, OFFERING_AT.z);
      light.current.scale.setScalar(Math.max(0.001, 0.035 * s.place * pulse));
    }
    if (halo.current) {
      halo.current.position.set(x, LIGHT_Y, OFFERING_AT.z);
      halo.current.scale.setScalar(Math.max(0.001, 0.12 * s.place * pulse));
    }
  });

  return (
    <group>
      {/* The low stone, and a soft mark on each side of it to stand on. */}
      <mesh position={[OFFERING_AT.x, 0.25, OFFERING_AT.z]} raycast={() => null}>
        <cylinderGeometry args={[0.16, 0.2, 0.5, 16]} />
        <meshStandardMaterial color="#5b564e" roughness={0.9} />
      </mesh>
      {([-1, 1] as const).map((side, index) => (
        <mesh key={side} position={[OFFERING_AT.x + side * OFFERING_AT.apart, 0.012, OFFERING_AT.z]} rotation-x={-Math.PI / 2} raycast={() => null}>
          <ringGeometry args={[0.18, 0.24, 32]} />
          <meshBasicMaterial ref={(material) => { marks.current[index] = material; }} color="#ffe3b0" transparent opacity={0.2} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
      <mesh ref={light} raycast={() => null}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color="#fff1cf" toneMapped={false} />
      </mesh>
      <mesh ref={halo} raycast={() => null}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color="#ffc27a" transparent opacity={0.18} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  );
}
