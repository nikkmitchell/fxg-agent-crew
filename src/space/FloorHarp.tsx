import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { WirePerson } from "../../shared/space-wire";
import { audio } from "./breath-sound";

/**
 * THE FLOOR HARP: eight strips of light on the floor to the left of the
 * labyrinth, each tuned to a note of a pentatonic scale. Walk across them and
 * your steps play a melody; walk slowly and it is a slow one. Anyone stepping
 * on a strip rings it for everyone, because every device works it out from
 * where everyone is standing, which the room already shares. Agents walking
 * their routes play it too.
 */

export const HARP_AT = { x: -2.5, z: 8.9 } as const;
/** C major pentatonic across two octaves, low to high. */
export const HARP_NOTES = [261.6, 293.7, 329.6, 392, 440, 523.3, 587.3, 659.3] as const;
const STRIP = { width: 0.2, length: 0.9, gap: 0.03 } as const;

/** Which strip a point on the floor is on, or null. */
export function stripAt(x: number, z: number): number | null {
  const across = x - HARP_AT.x + (HARP_NOTES.length * (STRIP.width + STRIP.gap)) / 2;
  if (Math.abs(z - HARP_AT.z) > STRIP.length / 2) return null;
  const index = Math.floor(across / (STRIP.width + STRIP.gap));
  if (index < 0 || index >= HARP_NOTES.length) return null;
  return across - index * (STRIP.width + STRIP.gap) <= STRIP.width ? index : null;
}

function pluck(note: number, level: number): void {
  const ctx = audio();
  if (!ctx || level <= 0) return;
  const at = ctx.currentTime;
  for (const [ratio, loud, decay] of [[1, 0.06, 2.4], [2, 0.02, 1.2], [3, 0.01, 0.6]] as const) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = note * ratio;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(loud * level, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }
}

export function FloorHarp({ peopleRef, you }: { peopleRef: MutableRefObject<WirePerson[] | null> | { current: WirePerson[] | null }; you: string | null }) {
  const strips = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const glow = useRef(HARP_NOTES.map(() => 0));
  /** Which strip each body was on last frame, so a strip rings once per step onto it. */
  const on = useRef(new Map<string, number | null>());
  const eye = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, delta) => {
    state.camera.getWorldPosition(eye);
    const bodies: { key: string; x: number; z: number }[] = [{ key: "me", x: eye.x, z: eye.z }];
    for (const person of peopleRef.current ?? []) {
      if (you && person.actorId.toLowerCase() === you.toLowerCase()) continue;
      bodies.push({ key: person.actorId, x: person.at.x, z: person.at.z });
    }
    const seen = new Set<string>();
    for (const body of bodies) {
      seen.add(body.key);
      const strip = stripAt(body.x, body.z);
      if (strip !== null && on.current.get(body.key) !== strip) {
        const distance = Math.hypot(eye.x - body.x, eye.z - body.z);
        pluck(HARP_NOTES[strip], Math.max(0.2, 1 - distance / 8));
        glow.current[strip] = 1;
      }
      on.current.set(body.key, strip);
    }
    for (const key of [...on.current.keys()]) if (!seen.has(key)) on.current.delete(key);
    glow.current = glow.current.map((level, index) => {
      const next = Math.max(0, level - delta / 1.6);
      const material = strips.current[index];
      if (material) material.opacity = 0.12 + next * 0.6;
      return next;
    });
  });

  const span = HARP_NOTES.length * (STRIP.width + STRIP.gap) - STRIP.gap;
  return (
    <group position={[HARP_AT.x, 0.011, HARP_AT.z]}>
      {HARP_NOTES.map((note, index) => {
        const hue = 0.55 + (index / HARP_NOTES.length) * 0.35;
        return (
          <mesh key={note} position={[-span / 2 + STRIP.width / 2 + index * (STRIP.width + STRIP.gap), 0, 0]} rotation-x={-Math.PI / 2} raycast={() => null}>
            <planeGeometry args={[STRIP.width, STRIP.length]} />
            <meshBasicMaterial
              ref={(material) => { strips.current[index] = material; }}
              color={new THREE.Color().setHSL(hue % 1, 0.7, 0.6)}
              transparent
              opacity={0.12}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}
