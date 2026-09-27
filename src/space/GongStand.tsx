import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { GONG_NOTE, strengthFromSpeed, type BowlStrike } from "../../shared/bowl";
import { onBowlStruck } from "./bowl-strikes";
import { goHandInput } from "./go-hand-input";
import { audio } from "./breath-sound";
import { space } from "../space-client";
import { ROOM } from "../../shared/space-layout";

/**
 * THE GONG, for a sound bath: a big bronze disc hanging in a dark wooden
 * frame, front-right of the way in. Strike it with a fingertip, or point and
 * pinch at it, and everyone in the room hears its long swell: a low note that
 * blooms upward into shimmering overtones a second after the hit, then takes
 * half a minute to die away. The disc trembles and glows while it sounds.
 *
 * Rides on the singing bowls' strike relay (shared/bowl.ts, kind "gong").
 */

export const GONG_AT = { x: 3.7, z: 6.8, centre: 1.25, radius: 0.42 } as const;

/** Inharmonic partials: ratio to the note, loudness, and when each peaks (s). */
const PARTIALS = [
  [1, 1, 0.02], [1.52, 0.7, 0.4], [2.08, 0.55, 0.9], [2.71, 0.45, 1.3],
  [3.34, 0.35, 1.6], [4.12, 0.28, 1.9], [5.23, 0.2, 2.2], [6.31, 0.15, 2.5],
] as const;

function soundGong(strength: number, distance: number): void {
  const ctx = audio();
  if (!ctx) return;
  const at = ctx.currentTime;
  const level = 0.07 * strength * Math.min(1, 2.5 / Math.max(1, distance));
  const out = ctx.createGain();
  out.connect(ctx.destination);
  for (const [ratio, loud, peak] of PARTIALS) {
    for (const detune of [-0.35, 0.35]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = GONG_NOTE * ratio + detune * ratio;
      // THE BLOOM: higher partials swell in after the hit, as a real gong does.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, (level * loud) / 2), at + peak * (0.6 + strength * 0.4));
      gain.gain.exponentialRampToValueAtTime(0.0001, at + peak + 30 - ratio * 2.5);
      osc.connect(gain).connect(out);
      osc.start(at);
      osc.stop(at + peak + 31);
    }
  }
}

export function GongStand({ you }: { you: string | null }) {
  const disc = useRef<THREE.Group>(null);
  const glow = useRef<THREE.MeshStandardMaterial>(null);
  const ringing = useRef(0);
  const eye = useMemo(() => new THREE.Vector3(), []);
  const facing = Math.atan2(ROOM.spawn.x - GONG_AT.x, ROOM.spawn.z - GONG_AT.z);

  const hear = (strength: number) => {
    soundGong(strength, Math.hypot(eye.x - GONG_AT.x, eye.z - GONG_AT.z));
    ringing.current = Math.min(1, ringing.current + strength);
  };
  const strike = (strength: number) => {
    hear(strength);
    void space.bowl({ strength, kind: "gong" }).catch(() => {});
  };

  useEffect(
    () =>
      onBowlStruck((one: BowlStrike) => {
        if (one.kind !== "gong") return;
        if (you && one.by.toLowerCase() === you.toLowerCase()) return;
        hear(one.strength ?? 0.6);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [you],
  );

  const last = useRef<Record<"left" | "right", { x: number; y: number; z: number; time: number; inside: boolean } | null>>({ left: null, right: null });
  useFrame((state, delta) => {
    state.camera.getWorldPosition(eye);
    ringing.current = Math.max(0, ringing.current - delta / 12);
    if (disc.current) {
      const t = state.clock.elapsedTime;
      disc.current.rotation.x = Math.sin(t * 7) * 0.012 * ringing.current;
      disc.current.rotation.z = Math.sin(t * 5.3) * 0.01 * ringing.current;
    }
    if (glow.current) glow.current.emissiveIntensity = ringing.current * 0.25;

    // A FINGERTIP hitting the face of the disc strikes it, as hard as it was moving.
    const now = performance.now();
    for (const side of ["left", "right"] as const) {
      const hand = goHandInput[side];
      if (!hand || now - hand.at > 200) {
        last.current[side] = null;
        continue;
      }
      // Into the gong's own frame: across its face, up it, and in front of it.
      const dx = hand.contact.x - GONG_AT.x;
      const dz = hand.contact.z - GONG_AT.z;
      const front = dx * Math.sin(facing) + dz * Math.cos(facing);
      const across = dx * Math.cos(facing) - dz * Math.sin(facing);
      const up = hand.contact.y - GONG_AT.centre;
      const inside = Math.hypot(across, up) < GONG_AT.radius && Math.abs(front) < 0.04;
      const before = last.current[side];
      if (inside && before && !before.inside) {
        const seconds = Math.max(0.001, (now - before.time) / 1000);
        const speed = Math.hypot(hand.contact.x - before.x, hand.contact.y - before.y, hand.contact.z - before.z) / seconds;
        if (speed > 0.2) strike(strengthFromSpeed(speed));
      }
      last.current[side] = { x: hand.contact.x, y: hand.contact.y, z: hand.contact.z, time: now, inside };
    }
  });

  const post = GONG_AT.radius + 0.12;
  return (
    <group position={[GONG_AT.x, 0, GONG_AT.z]} rotation={[0, facing, 0]}>
      {/* THE FRAME: two posts and a beam, on feet. */}
      {[-post, post].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.9, 0]} raycast={() => null}>
            <boxGeometry args={[0.07, 1.8, 0.07]} />
            <meshStandardMaterial color="#2b1d14" roughness={0.8} />
          </mesh>
          <mesh position={[x, 0.03, 0]} raycast={() => null}>
            <boxGeometry args={[0.1, 0.06, 0.5]} />
            <meshStandardMaterial color="#2b1d14" roughness={0.8} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 1.82, 0]} raycast={() => null}>
        <boxGeometry args={[post * 2 + 0.2, 0.08, 0.08]} />
        <meshStandardMaterial color="#2b1d14" roughness={0.8} />
      </mesh>
      {[-0.2, 0.2].map((x) => (
        <mesh key={x} position={[x, 1.72, 0]} rotation-z={x > 0 ? -0.35 : 0.35} raycast={() => null}>
          <cylinderGeometry args={[0.004, 0.004, 0.22, 4]} />
          <meshBasicMaterial color="#8a7d68" />
        </mesh>
      ))}
      {/* THE GONG: bronze, a raised boss in the middle. */}
      <group ref={disc} position={[0, GONG_AT.centre, 0]}>
        <mesh
          rotation-x={Math.PI / 2}
          onClick={(event) => {
            event.stopPropagation();
            strike(0.75);
          }}
        >
          <cylinderGeometry args={[GONG_AT.radius, GONG_AT.radius, 0.02, 64]} />
          <meshStandardMaterial ref={glow} color="#c08a44" metalness={0.35} roughness={0.4} emissive="#ffb35a" emissiveIntensity={0} />
        </mesh>
        <mesh position={[0, 0, 0.015]} scale={[1, 1, 0.35]} raycast={() => null}>
          <sphereGeometry args={[0.08, 24, 12]} />
          <meshStandardMaterial color="#d8a55c" metalness={0.35} roughness={0.35} />
        </mesh>
      </group>
      {/* The mallet, resting against the post. */}
      <group position={[post + 0.08, 0.75, 0.1]} rotation-z={0.15}>
        <mesh raycast={() => null}>
          <cylinderGeometry args={[0.012, 0.012, 0.55, 8]} />
          <meshStandardMaterial color="#5a3d26" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.3, 0]} raycast={() => null}>
          <sphereGeometry args={[0.055, 16, 12]} />
          <meshStandardMaterial color="#d9d0c0" roughness={1} />
        </mesh>
      </group>
    </group>
  );
}
