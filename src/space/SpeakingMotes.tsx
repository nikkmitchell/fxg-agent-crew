import { useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { WirePerson } from "../../shared/space-wire";
import type { Utterance } from "../../shared/voice";
import { MOTE_COUNT, moteField, moteOpacity, pulseFor, stepMotes } from "./speaking-motes";
import { useDisposableList } from "./use-disposable";

/** At most this many people lit at once; a fourth speaker reuses the oldest. */
const POOL = 3;

type Pulse = {
  points: THREE.Points;
  positions: Float32Array;
  rise: Float32Array;
  actorId: string | null;
  age: number;
  seconds: number;
};

/**
 * Light rising off whoever is speaking, for as long as their line lasts.
 * See speaking-motes.ts. Nothing at all under reduced motion.
 *
 * IT FOLLOWS THEM. An agent can walk while a line of theirs is still being
 * spoken, and a glow left behind at the place they set off from would point at
 * the wrong person — worse in a room whose whole purpose is knowing who said
 * what. So the position is read every frame rather than captured at the start.
 */
export function SpeakingMotes({
  peopleRef,
  liveUtterance,
  you,
  reducedMotion,
}: {
  peopleRef: RefObject<WirePerson[]>;
  liveUtterance: Utterance | null;
  you: string | null;
  reducedMotion: boolean;
}) {
  const started = useRef<number | null>(null);
  const next = useRef(0);
  const seed = useRef(1);

  // Freed on unmount: switching rooms remounts the scene, and each pool
  // used to stay on the GPU.
  const pulses = useDisposableList<Pulse>(
    () =>
      Array.from({ length: POOL }, () => {
        const positions = new Float32Array(MOTE_COUNT * 3);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({
          // Cooler than the arrival burst's gold, so the two read as different
          // events rather than as the same thing happening twice.
          color: "#8fd8ff",
          size: 0.045,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const points = new THREE.Points(geometry, material);
        points.visible = false;
        points.frustumCulled = false;
        return { points, positions, rise: new Float32Array(MOTE_COUNT), actorId: null, age: 0, seconds: 0 };
      }),
    (one) => {
      one.points.geometry.dispose();
      (one.points.material as THREE.Material).dispose();
    },
  );

  useFrame((_, delta) => {
    const people = peopleRef.current ?? [];

    const pulse = pulseFor(liveUtterance, you, started.current);
    if (pulse && liveUtterance) {
      // MARKED EVEN UNDER REDUCED MOTION, so turning animation back on does not
      // begin by lighting up a line somebody finished saying minutes ago.
      started.current = liveUtterance.id;
      if (!reducedMotion) {
        const slot = pulses[next.current];
        next.current = (next.current + 1) % POOL;
        const field = moteField(seed.current++);
        slot.positions.set(field.positions);
        slot.rise.set(field.rise);
        slot.actorId = pulse.actorId;
        slot.age = 0;
        slot.seconds = pulse.seconds;
        slot.points.visible = true;
      }
    }

    const dt = Math.min(delta, 0.05);
    for (const slot of pulses) {
      if (!slot.actorId) continue;
      slot.age += dt;
      const person = people.find((candidate) => candidate.actorId === slot.actorId);
      if (person) slot.points.position.set(person.at.x, 0, person.at.z);
      stepMotes(slot.positions, slot.rise, dt);
      (slot.points.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (slot.points.material as THREE.PointsMaterial).opacity = moteOpacity(slot.age, slot.seconds);
      if (slot.age >= slot.seconds) {
        slot.actorId = null;
        slot.points.visible = false;
      }
    }
  });

  return (
    <group>
      {pulses.map((slot, index) => (
        <primitive key={index} object={slot.points} />
      ))}
    </group>
  );
}
