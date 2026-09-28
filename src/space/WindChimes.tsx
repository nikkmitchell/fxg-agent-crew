import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { WirePerson } from "../../shared/space-wire";
import { selfPose } from "./self-pose";
import { goHandInput } from "./go-hand-input";
import { audio } from "./breath-sound";

/**
 * WIND CHIMES hanging just inside where people arrive: brushed tubes on
 * strings under a small wooden disc.
 *
 * WALK UNDER THEM and they stir and ring, and whoever else is near hears it:
 * every device works out the chimes from where everyone is standing, which the
 * room already shares, so nothing new is sent. REACH UP and touch a tube, or
 * point and pinch at one, and that tube rings clearly. A room with people
 * arriving and leaving sounds like it.
 */

// Right of the way in, clear of Sill's tea table (-1.7, 6.8).
export const CHIMES_AT = { x: 0.9, z: 7.2, top: 2.25 } as const;
/** Five tubes, a pentatonic set high enough to shimmer: D6 E6 G6 A6 B6. */
export const CHIME_NOTES = [1174.7, 1318.5, 1568, 1760, 1975.5] as const;
const TUBE_LENGTHS = [0.46, 0.42, 0.38, 0.34, 0.31] as const;
const RING_RADIUS = 0.11;

/** How strongly the chimes stir for a body `distance` metres away on the floor. */
export function stirFor(distance: number): number {
  if (distance >= 1.2) return 0;
  return (1.2 - distance) / 1.2;
}

export function ringTube(note: number, strength: number): void {
  const ctx = audio();
  if (!ctx) return;
  const at = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  // A tube's partials: inharmonic, bright, long; the fundamental outlasts the rest.
  for (const [ratio, level, decay] of [[1, 1, 4.5], [2.76, 0.45, 2.5], [5.4, 0.2, 1.2]] as const) {
    const osc = ctx.createOscillator();
    const partial = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = note * ratio;
    partial.gain.setValueAtTime(0.0001, at);
    partial.gain.exponentialRampToValueAtTime(0.045 * strength * level, at + 0.004);
    partial.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(partial).connect(gain);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }
}

export function WindChimes({ peopleRef, you, reducedMotion = false }: { peopleRef: MutableRefObject<WirePerson[] | null> | { current: WirePerson[] | null }; you: string | null; reducedMotion?: boolean }) {
  const tubes = useRef<(THREE.Group | null)[]>([]);
  /** Each tube's swing (radians) and its speed, as a damped pendulum. */
  const swing = useRef(CHIME_NOTES.map(() => ({ angle: 0, speed: 0, lastRing: 0 })));
  const clapper = useRef<THREE.Mesh>(null);
  const eye = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => () => {}, []);

  const strike = (index: number, strength: number) => {
    const tube = swing.current[index];
    const now = performance.now();
    if (!reducedMotion) tube.speed += strength * 3 * (Math.random() > 0.5 ? 1 : -1);
    if (now - tube.lastRing < 180) return;
    tube.lastRing = now;
    ringTube(CHIME_NOTES[index], strength);
  };

  useFrame((state, delta) => {
    const now = performance.now();
    // HOW MUCH THE AIR IS MOVING: the nearest body walking under the chimes.
    let stir = 0;
    const bodies: { x: number; z: number }[] = [];
    state.camera.getWorldPosition(eye);
    bodies.push({ x: eye.x, z: eye.z });
    for (const person of peopleRef.current ?? []) {
      if (you && person.actorId.toLowerCase() === you.toLowerCase()) continue;
      bodies.push({ x: person.at.x, z: person.at.z });
    }
    for (const body of bodies) stir = Math.max(stir, stirFor(Math.hypot(body.x - CHIMES_AT.x, body.z - CHIMES_AT.z)));
    // Stirred air knocks a random tube now and then, more often the closer.
    if (stir > 0 && Math.random() < stir * delta * 2.2) strike(Math.floor(Math.random() * CHIME_NOTES.length), 0.25 + stir * 0.45);

    // A HAND touching a tube rings it clearly.
    for (const side of ["left", "right"] as const) {
      const hand = goHandInput[side] ?? (selfPose.hands[side] ? { contact: selfPose.hands[side]!.p, at: now } : null);
      if (!hand || now - hand.at > 200) continue;
      CHIME_NOTES.forEach((_, index) => {
        const a = (index / CHIME_NOTES.length) * Math.PI * 2;
        const tx = CHIMES_AT.x + Math.cos(a) * RING_RADIUS;
        const tz = CHIMES_AT.z + Math.sin(a) * RING_RADIUS;
        const bottom = CHIMES_AT.top - 0.08 - TUBE_LENGTHS[index];
        const near = Math.hypot(hand.contact.x - tx, hand.contact.z - tz) < 0.035;
        if (near && hand.contact.y < CHIMES_AT.top - 0.05 && hand.contact.y > bottom) strike(index, 0.8);
      });
    }

    // THE PENDULUMS.
    swing.current.forEach((tube, index) => {
      const group = tubes.current[index];
      if (reducedMotion) {
        tube.angle = 0;
        tube.speed = 0;
      } else {
        tube.speed += -tube.angle * 18 * delta;
        tube.speed *= Math.exp(-delta * 1.4);
        tube.angle += tube.speed * delta;
      }
      if (group) group.rotation.x = reducedMotion ? 0 : tube.angle;
    });
    if (clapper.current) clapper.current.rotation.z = reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * 1.3) * 0.08 * (0.3 + stir);
  });

  return (
    <group position={[CHIMES_AT.x, CHIMES_AT.top, CHIMES_AT.z]}>
      {/* The disc they hang from, on a thin cord up out of sight. */}
      <mesh raycast={() => null}>
        <cylinderGeometry args={[0.16, 0.16, 0.025, 32]} />
        <meshStandardMaterial color="#6b4a2f" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.5, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.002, 0.002, 1, 4]} />
        <meshBasicMaterial color="#8a8578" />
      </mesh>
      {CHIME_NOTES.map((note, index) => {
        const a = (index / CHIME_NOTES.length) * Math.PI * 2;
        const length = TUBE_LENGTHS[index];
        return (
          <group key={note} position={[Math.cos(a) * RING_RADIUS, -0.012, Math.sin(a) * RING_RADIUS]} rotation-y={-a} ref={(node) => { tubes.current[index] = node; }}>
            <mesh position={[0, -0.04, 0]} raycast={() => null}>
              <cylinderGeometry args={[0.0012, 0.0012, 0.08, 4]} />
              <meshBasicMaterial color="#8a8578" />
            </mesh>
            <mesh
              position={[0, -0.08 - length / 2, 0]}
              onClick={(event) => {
                event.stopPropagation();
                strike(index, 0.8);
              }}
            >
              <cylinderGeometry args={[0.012, 0.012, length, 16]} />
              <meshStandardMaterial color="#c9ccd2" metalness={0.9} roughness={0.25} />
            </mesh>
          </group>
        );
      })}
      {/* The clapper in the middle, and the sail under it that catches the air. */}
      <mesh ref={clapper} position={[0, -0.3, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.035, 0.035, 0.012, 20]} />
        <meshStandardMaterial color="#6b4a2f" roughness={0.7} />
      </mesh>
      <mesh position={[0, -0.52, 0]} raycast={() => null}>
        <boxGeometry args={[0.07, 0.16, 0.004]} />
        <meshStandardMaterial color="#8c6a48" roughness={0.8} />
      </mesh>
    </group>
  );
}
