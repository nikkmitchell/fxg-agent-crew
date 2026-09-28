import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { WirePerson } from "../../shared/space-wire";
import { selfPose } from "./self-pose";

/**
 * FIREFLIES drifting over the left of the room, between the garden and the
 * mandala: small warm lights that wander, and blink slowly. HOLD A HAND STILL
 * among them for a few seconds, palm up, and the nearest one comes and rests on
 * it, pulsing gently, until the hand moves. Patience, rewarded.
 *
 * The same fireflies for everyone (they fly on the clock), and anyone can see
 * one resting on anyone's hand: the room already shares where hands are, and
 * every device works it out the same way.
 */

export const FIREFLIES_AT = { x: -2.9, z: 6.3, radius: 1.3 } as const;
const COUNT = 26;
/** How long a hand must be still before one comes. */
export const STILL_SECONDS = 2.5;
/** How still is still: metres the hand may drift. */
const STILL_METRES = 0.03;

/** Where firefly `index` wanders at `seconds`, from the middle of the swarm. */
export function fireflyAt(index: number, seconds: number): { x: number; y: number; z: number; blink: number } {
  const s = index * 1.618;
  const t = seconds * (0.08 + (index % 5) * 0.012);
  const r = FIREFLIES_AT.radius * (0.35 + 0.6 * Math.abs(Math.sin(s * 3.1)));
  return {
    x: Math.cos(t + s) * r + Math.sin(t * 2.3 + s) * 0.2,
    y: 1.1 + Math.sin(t * 1.7 + s * 2) * 0.4,
    z: Math.sin(t + s) * r * 0.85 + Math.cos(t * 1.9 + s) * 0.2,
    blink: Math.max(0.15, Math.sin(seconds * (0.8 + (index % 3) * 0.3) + s * 5) ** 8),
  };
}

export function fireflyMotionTime(seconds: number, reducedMotion = false): number {
  return reducedMotion ? 0 : seconds;
}

type Hand = { x: number; y: number; z: number };

export function Fireflies({ peopleRef, you, reducedMotion = false }: { peopleRef: MutableRefObject<WirePerson[] | null> | { current: WirePerson[] | null }; you: string | null; reducedMotion?: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const colours = useMemo(() => new Float32Array(COUNT * 3), []);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  /** Each hand's resting place and how long it has been still, by key. */
  const stillness = useRef(new Map<string, { at: Hand; since: number }>());
  /** Which firefly is on which hand, and how far it has come. */
  const landed = useRef(new Map<number, { hand: string; progress: number }>());
  const shown = useRef(Array.from({ length: COUNT }, () => new THREE.Vector3()));
  const colour = useMemo(() => new THREE.Color(), []);

  useFrame((_, delta) => {
    const now = performance.now();
    const seconds = fireflyMotionTime(Date.now() / 1000, reducedMotion);

    // Every hand in the room, keyed.
    const hands = new Map<string, Hand>();
    if (you && selfPose.hands.left) hands.set(`${you}:l`, selfPose.hands.left.p);
    if (you && selfPose.hands.right) hands.set(`${you}:r`, selfPose.hands.right.p);
    for (const person of peopleRef.current ?? []) {
      if (you && person.actorId.toLowerCase() === you.toLowerCase()) continue;
      if (person.hands?.left) hands.set(`${person.actorId}:l`, person.hands.left.p);
      if (person.hands?.right) hands.set(`${person.actorId}:r`, person.hands.right.p);
    }

    // How long each hand in the swarm has been still.
    const still = new Map<string, Hand>();
    for (const [key, hand] of hands) {
      const inSwarm = Math.hypot(hand.x - FIREFLIES_AT.x, hand.z - FIREFLIES_AT.z) < FIREFLIES_AT.radius + 0.3;
      const was = stillness.current.get(key);
      if (!inSwarm) {
        stillness.current.delete(key);
        continue;
      }
      if (!was || Math.hypot(hand.x - was.at.x, hand.y - was.at.y, hand.z - was.at.z) > STILL_METRES) {
        stillness.current.set(key, { at: { ...hand }, since: now });
      } else if ((now - was.since) / 1000 > STILL_SECONDS) {
        still.set(key, hand);
      }
    }
    for (const key of [...stillness.current.keys()]) if (!hands.has(key)) stillness.current.delete(key);

    // A still hand with no firefly draws the nearest free one; a moved hand lets it go.
    for (const [index, land] of landed.current) if (!still.has(land.hand)) landed.current.delete(index);
    for (const [key, hand] of still) {
      if ([...landed.current.values()].some((land) => land.hand === key)) continue;
      let best = -1;
      let bestDistance = Infinity;
      for (let i = 0; i < COUNT; i += 1) {
        if (landed.current.has(i)) continue;
        const f = fireflyAt(i, seconds);
        const d = Math.hypot(FIREFLIES_AT.x + f.x - hand.x, f.y - hand.y, FIREFLIES_AT.z + f.z - hand.z);
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      }
      if (best >= 0) landed.current.set(best, { hand: key, progress: 0 });
    }

    const node = mesh.current;
    if (!node) return;
    for (let i = 0; i < COUNT; i += 1) {
      const f = fireflyAt(i, seconds);
      const target = new THREE.Vector3(FIREFLIES_AT.x + f.x, f.y, FIREFLIES_AT.z + f.z);
      let blink = f.blink;
      const land = landed.current.get(i);
      if (land) {
        const hand = still.get(land.hand)!;
        land.progress = reducedMotion ? 1 : Math.min(1, land.progress + delta / 2.5);
        target.lerp(new THREE.Vector3(hand.x, hand.y + 0.04, hand.z), land.progress);
        blink = reducedMotion ? 0.5 : 0.5 + Math.sin(seconds * 2.2) * 0.35;
      }
      if (reducedMotion) shown.current[i].copy(target);
      else shown.current[i].lerp(target, Math.min(1, delta * 4));
      const size = 0.012 + blink * 0.01;
      matrix.makeScale(size, size, size).setPosition(shown.current[i]);
      node.setMatrixAt(i, matrix);
      colour.setRGB(1 * blink + 0.1, 0.85 * blink + 0.08, 0.35 * blink);
      colours.set([colour.r, colour.g, colour.b], i * 3);
    }
    node.instanceMatrix.needsUpdate = true;
    if (node.instanceColor) node.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]} raycast={() => null} frustumCulled={false}>
      <sphereGeometry args={[1, 8, 6]} />
      <meshBasicMaterial toneMapped={false} />
      <instancedBufferAttribute attach="instanceColor" args={[colours, 3]} />
    </instancedMesh>
  );
}
