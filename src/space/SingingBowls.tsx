import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { BOWLS, bowlForNote, onBowlWall, rimSpeed, strengthFromSpeed, type BowlStrike } from "../../shared/bowl";
import { onBowlStruck } from "./bowl-strikes";
import { ringBowl, singBowl } from "./bowl-sound";
import { goHandInput } from "./go-hand-input";
import { space } from "../space-client";

/**
 * Three singing bowls on a low round table beside the orb (shared/bowl.ts).
 *
 * TAP a bowl with a ray, a pinch or a fingertip and it rings, for everyone.
 * CIRCLE its rim with a fingertip and it sings: the faster the circle, the
 * fuller the note. A ringing bowl glows faintly and its surface shivers, so a
 * strike across the room can be seen as well as heard.
 */

/** Where the table stands: in front of the orb and to its right, facing the room. */
export const BOWLS_AT = { x: 1.15, z: 4.2, tableHeight: 0.72 } as const;
/** Across the table, where each bowl sits (x, z from its centre). */
const PLACES: readonly [number, number][] = [[-0.22, 0.02], [0.08, -0.08], [0.27, 0.1]];

const BRONZE = "#b98a4a";

function bowlGeometry(radius: number, height: number): THREE.LatheGeometry {
  // A bowl's profile from the base out to the rim, a little thick at the lip.
  const profile = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(radius * 0.42, 0),
    new THREE.Vector2(radius * 0.72, height * 0.14),
    new THREE.Vector2(radius * 0.93, height * 0.45),
    new THREE.Vector2(radius, height * 0.82),
    new THREE.Vector2(radius * 0.985, height),
    new THREE.Vector2(radius * 0.94, height),
    new THREE.Vector2(radius * 0.9, height * 0.8),
    new THREE.Vector2(radius * 0.8, height * 0.4),
    new THREE.Vector2(radius * 0.5, height * 0.14),
    new THREE.Vector2(0.001, height * 0.1),
  ];
  return new THREE.LatheGeometry(profile, 48);
}

export function SingingBowls({ you }: { you: string | null }) {
  const bowls = useRef<(THREE.Mesh | null)[]>([]);
  const glows = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  /** How much each bowl is ringing right now, 0 to 1, for the glow and the shiver. */
  const ringing = useRef<number[]>(BOWLS.map(() => 0));
  const geometries = useMemo(() => BOWLS.map((bowl) => bowlGeometry(bowl.radius, bowl.height)), []);
  useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries]);

  const listener = useRef(new THREE.Vector3());
  const distanceTo = (index: number) => {
    const [px, pz] = PLACES[index];
    return Math.hypot(listener.current.x - (BOWLS_AT.x + px), listener.current.z - (BOWLS_AT.z + pz));
  };
  const sound = (index: number, kind: "strike" | "sing", strength: number) => {
    const note = BOWLS[index].note;
    if (kind === "sing") singBowl(note, strength, distanceTo(index));
    else ringBowl(note, strength, distanceTo(index));
    ringing.current[index] = Math.min(1, ringing.current[index] + (kind === "sing" ? 0.25 : strength));
  };

  // SOMEBODY ELSE rang one: ring it here too. My own strikes rang the moment I made them.
  useEffect(
    () =>
      onBowlStruck((strike: BowlStrike) => {
        if (you && strike.by.toLowerCase() === you.toLowerCase()) return;
        const index = strike.bowl ?? bowlForNote(strike.note);
        sound(index, strike.kind === "sing" ? "sing" : "strike", strike.strength ?? 0.6);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [you],
  );

  const ring = (index: number, kind: "strike" | "sing", strength: number) => {
    sound(index, kind, strength);
    void space.bowl({ bowl: index, strength, kind }).catch(() => {
      // Too soon, or the room is away: the bowl still rang for you.
    });
  };

  // FINGERTIPS: a tap on a bowl's wall strikes it; circling the rim sings it.
  const last = useRef<Record<"left" | "right", { at: THREE.Vector3; time: number; inside: number | null; sungAt: number } | null>>({ left: null, right: null });
  useFrame((state, delta) => {
    state.camera.getWorldPosition(listener.current);
    ringing.current = ringing.current.map((level, index) => {
      const next = Math.max(0, level - delta / (index === 0 ? 5 : 3.5));
      const glow = glows.current[index];
      if (glow) glow.emissiveIntensity = next * 0.28;
      const mesh = bowls.current[index];
      if (mesh) {
        const shiver = 1 + Math.sin(state.clock.elapsedTime * BOWLS[index].note * 0.05) * 0.004 * next;
        mesh.scale.set(shiver, 1, shiver);
      }
      return next;
    });

    const now = performance.now();
    for (const side of ["left", "right"] as const) {
      const hand = goHandInput[side];
      if (!hand || now - hand.at > 200) {
        last.current[side] = null;
        continue;
      }
      const at = new THREE.Vector3(hand.contact.x, hand.contact.y, hand.contact.z);
      const before = last.current[side];
      const seconds = before ? Math.max(0.001, (now - before.time) / 1000) : 0;
      const velocity = before ? at.clone().sub(before.at).divideScalar(seconds) : new THREE.Vector3();
      let inside: number | null = null;
      let sungAt = before?.sungAt ?? 0;
      BOWLS.forEach((bowl, index) => {
        const [px, pz] = PLACES[index];
        const local = { x: at.x - (BOWLS_AT.x + px), y: at.y - BOWLS_AT.tableHeight, z: at.z - (BOWLS_AT.z + pz) };
        const round = rimSpeed(local, velocity, bowl);
        if (round > 0.12 && now - sungAt > 280) {
          sungAt = now;
          ring(index, "sing", Math.min(1, round / 0.6));
        } else if (onBowlWall(local, bowl)) {
          inside = index;
        }
      });
      // A strike is the moment a fingertip ENTERS a bowl's wall, moving.
      if (inside !== null && before && before.inside !== inside && velocity.length() > 0.15) {
        ring(inside, "strike", strengthFromSpeed(velocity.length()));
      }
      last.current[side] = { at, time: now, inside, sungAt };
    }
  });

  return (
    <group position={[BOWLS_AT.x, 0, BOWLS_AT.z]}>
      {/* The table: a low round top on one thick stem. */}
      <mesh position={[0, BOWLS_AT.tableHeight - 0.02, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.46, 0.46, 0.04, 48]} />
        <meshStandardMaterial color="#3b2a1e" roughness={0.8} />
      </mesh>
      <mesh position={[0, (BOWLS_AT.tableHeight - 0.04) / 2, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.07, 0.12, BOWLS_AT.tableHeight - 0.04, 24]} />
        <meshStandardMaterial color="#2c2018" roughness={0.9} />
      </mesh>
      {BOWLS.map((bowl, index) => {
        const [px, pz] = PLACES[index];
        return (
          <group key={index} position={[px, BOWLS_AT.tableHeight, pz]}>
            {/* A cushion under each bowl, the way they are rested. */}
            <mesh position={[0, 0.008, 0]} raycast={() => null}>
              <cylinderGeometry args={[bowl.radius * 0.7, bowl.radius * 0.75, 0.016, 32]} />
              <meshStandardMaterial color="#6d2b2b" roughness={1} />
            </mesh>
            <mesh
              ref={(mesh) => {
                bowls.current[index] = mesh;
              }}
              geometry={geometries[index]}
              position={[0, 0.016, 0]}
              onClick={(event) => {
                event.stopPropagation();
                ring(index, "strike", 0.7);
              }}
            >
              <meshStandardMaterial
                ref={(material) => {
                  glows.current[index] = material;
                }}
                color={BRONZE}
                metalness={0.75}
                roughness={0.32}
                emissive="#ff9f40"
                emissiveIntensity={0}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
