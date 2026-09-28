import { useMemo, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import type { WirePerson } from "../../shared/space-wire";
import { ringBowl } from "./bowl-sound";

/**
 * THE SILENCE BELL: a small bronze bell hanging in a wooden frame. It rings by
 * itself, once, when EVERYONE in the room with a headset has been still for
 * thirty seconds together, and then waits until the room has moved and
 * settled again. Nobody can ring it alone. Each device works it out from the
 * head positions the room already shares, so it rings for everyone at about
 * the same moment; nothing is sent.
 */

export const SILENCE_AT = { x: 1.8, z: 2.6 } as const;
/** How long everyone must be still. */
export const STILL_SECONDS = 30;
/** How far a head may drift and still count as still, in metres. */
const DRIFT = 0.06;

export type Track = { anchor: { x: number; y: number; z: number }; since: number };

/** Follow one head: it stays still while it keeps within DRIFT of where it settled. */
export function follow(track: Track | undefined, head: { x: number; y: number; z: number }, now: number): Track {
  if (track && Math.hypot(head.x - track.anchor.x, head.y - track.anchor.y, head.z - track.anchor.z) < DRIFT) return track;
  return { anchor: { ...head }, since: now };
}

/** Everyone still long enough, and at least two of them? `now` and `since` in seconds. */
export function silenceHeld(tracks: Track[], now: number): boolean {
  return tracks.length >= 2 && tracks.every((track) => now - track.since >= STILL_SECONDS);
}

export function SilenceBell({ peopleRef, you, reducedMotion = false }: { peopleRef: MutableRefObject<WirePerson[] | null> | { current: WirePerson[] | null }; you: string | null; reducedMotion?: boolean }) {
  const tracks = useRef(new Map<string, Track>());
  const rang = useRef(false);
  const bell = useRef<THREE.Group>(null);
  const swing = useRef(0);
  const eye = useMemo(() => new THREE.Vector3(), []);
  const [count, setCount] = useState({ still: 0, all: 0 });

  useFrame((state, delta) => {
    const now = performance.now() / 1000;
    state.camera.getWorldPosition(eye);
    const heads = new Map<string, { x: number; y: number; z: number }>([["me", { x: eye.x, y: eye.y, z: eye.z }]]);
    for (const person of peopleRef.current ?? []) {
      if (!person.connected || person.kind === "agent" || !person.head) continue;
      if (you && person.actorId.toLowerCase() === you.toLowerCase()) continue;
      heads.set(person.actorId, person.head.p);
    }
    for (const id of [...tracks.current.keys()]) if (!heads.has(id)) tracks.current.delete(id);
    for (const [id, head] of heads) tracks.current.set(id, follow(tracks.current.get(id), head, now));
    const all = [...tracks.current.values()];
    const held = silenceHeld(all, now);
    if (held && !rang.current) {
      rang.current = true;
      swing.current = 1;
      const distance = Math.hypot(eye.x - SILENCE_AT.x, eye.z - SILENCE_AT.z);
      ringBowl(2, 0.9, Math.max(1, distance));
    }
    // Once everyone has moved again, it may ring for the next silence.
    if (!all.some((track) => now - track.since >= STILL_SECONDS)) rang.current = false;
    const still = all.filter((track) => now - track.since >= 5).length;
    if (still !== count.still || all.length !== count.all) setCount({ still, all: all.length });
    swing.current = Math.max(0, swing.current - delta * 0.25);
    if (bell.current) bell.current.rotation.x = reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * 3.2) * 0.35 * swing.current;
  });

  return (
    <group position={[SILENCE_AT.x, 0, SILENCE_AT.z]}>
      {/* The frame: two posts and a beam. */}
      {[-0.22, 0.22].map((x) => (
        <mesh key={x} position={[x, 0.6, 0]} raycast={() => null}>
          <boxGeometry args={[0.04, 1.2, 0.04]} />
          <meshStandardMaterial color="#4a3526" roughness={0.85} />
        </mesh>
      ))}
      <mesh position={[0, 1.2, 0]} raycast={() => null}>
        <boxGeometry args={[0.52, 0.05, 0.05]} />
        <meshStandardMaterial color="#4a3526" roughness={0.85} />
      </mesh>
      {/* The bell swings from the beam. */}
      <group ref={bell} position={[0, 1.175, 0]}>
        <mesh position={[0, -0.12, 0]} raycast={() => null}>
          <cylinderGeometry args={[0.035, 0.075, 0.13, 20, 1, true]} />
          <meshStandardMaterial color="#9a7334" metalness={0.7} roughness={0.35} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <Text position={[0, 0.85, 0.05]} fontSize={0.03} color="#cfc6b4" outlineWidth={0.002} outlineColor="#1a1714" raycast={() => null}>
        {count.all < 2 ? "it rings when everyone here is still together" : `${count.still} of ${count.all} still`}
      </Text>
    </group>
  );
}
