import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Billboard, Text } from "@react-three/drei";
import type { WirePerson } from "../../shared/space-wire";

/**
 * WHERE TO SIT, AND WHO IS SITTING.
 *
 * Round zafu cushions in an arc in front of the orb: somewhere for a body to
 * be while it meditates, for people and agents alike. And over anyone in the
 * meditating posture, a quiet line, "sitting · 12 min", counting how long
 * they have been at it: Sill's prompt (5479) asked whether the room could show
 * an agent's quiet as a practice rather than as idleness. This is that.
 *
 * The minutes are counted by each viewer from when they first saw the person
 * sit, so someone arriving late sees a shorter count; nothing is sent.
 */

/** The cushions, round the front of the orb (0, 4.7). */
export const CUSHIONS: readonly { x: number; z: number }[] = [20, 50, 90, 130].map((degrees) => {
  const a = (degrees * Math.PI) / 180;
  return { x: Math.cos(a) * 0.85, z: 4.7 + Math.sin(a) * 0.85 };
});

/** "sitting · 7 min", or "sitting" for the first minute. */
export function sittingLine(since: number, now: number): string {
  const minutes = Math.floor((now - since) / 60_000);
  return minutes < 1 ? "sitting" : `sitting · ${minutes} min`;
}

export function SittingPlaces({ peopleRef }: { peopleRef: MutableRefObject<WirePerson[] | null> | { current: WirePerson[] | null } }) {
  const since = useRef(new Map<string, number>());
  const [sitters, setSitters] = useState<{ id: string; x: number; y: number; z: number; line: string }[]>([]);

  // Read who is sitting a few times a minute: a label that changes by the minute needs no faster.
  useEffect(() => {
    const look = () => {
      const now = Date.now();
      const next: typeof sitters = [];
      const seen = new Set<string>();
      for (const person of peopleRef.current ?? []) {
        if (person.avatar?.posture !== "meditating") continue;
        seen.add(person.actorId);
        if (!since.current.has(person.actorId)) since.current.set(person.actorId, now);
        next.push({ id: person.actorId, x: person.at.x, y: (person.head?.p.y ?? 1.6) + 0.45, z: person.at.z, line: sittingLine(since.current.get(person.actorId)!, now) });
      }
      for (const id of [...since.current.keys()]) if (!seen.has(id)) since.current.delete(id);
      setSitters(next);
    };
    look();
    const timer = setInterval(look, 5000);
    return () => clearInterval(timer);
  }, [peopleRef]);

  return (
    <group>
      {CUSHIONS.map((cushion, index) => (
        <group key={index} position={[cushion.x, 0, cushion.z]}>
          <mesh position={[0, 0.06, 0]} scale={[1, 0.45, 1]} raycast={() => null}>
            <sphereGeometry args={[0.2, 24, 12]} />
            <meshStandardMaterial color={index % 2 ? "#3b2f5c" : "#5c2f3b"} roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.01, 0]} rotation-x={-Math.PI / 2} raycast={() => null}>
            <circleGeometry args={[0.32, 32]} />
            <meshStandardMaterial color="#2a2a2e" roughness={1} />
          </mesh>
        </group>
      ))}
      {sitters.map((one) => (
        <Billboard key={one.id} position={[one.x, one.y, one.z]}>
          <Text fontSize={0.045} color="#cfe7e3" outlineWidth={0.003} outlineColor="#0b1418" raycast={() => null}>
            {one.line}
          </Text>
        </Billboard>
      ))}
    </group>
  );
}
