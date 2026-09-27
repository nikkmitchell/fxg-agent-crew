import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { goHandInput } from "./go-hand-input";
import { audio } from "./breath-sound";
import { ROOM } from "../../shared/space-layout";

/**
 * THE MALA: a loop of 108 wooden beads hanging from a stand, with one larger
 * guru bead. Count breaths or a mantra on it: pinch a bead (or touch the bead
 * at the front with a fingertip) and it slides round one place with a soft
 * wooden click; at the guru bead, after 108, a small bell. Per person, like
 * counting on your own mala: nothing is sent.
 */

export const MALA_AT = { x: -1.6, z: 0.3 } as const;
export const BEADS = 108;
const LOOP = { radius: 0.22, centre: 1.05 } as const;

/** Where bead `index` hangs, when the loop has been turned `turned` beads round. */
export function beadAt(index: number, turned: number): { x: number; y: number } {
  // The loop hangs as an ellipse: taller than wide, like a real mala on a peg.
  const a = ((index - turned) / BEADS) * Math.PI * 2 - Math.PI / 2;
  return { x: Math.cos(a) * LOOP.radius * 0.72, y: LOOP.centre + Math.sin(a) * LOOP.radius * 1.25 };
}

function click(bell: boolean): void {
  const ctx = audio();
  if (!ctx) return;
  const at = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(bell ? 1568 : 2600, at);
  if (!bell) osc.frequency.exponentialRampToValueAtTime(1500, at + 0.02);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(bell ? 0.06 : 0.03, at + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + (bell ? 2.2 : 0.05));
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + (bell ? 2.3 : 0.08));
}

export function MalaStand() {
  const [count, setCount] = useState(0);
  const shown = useRef(0);
  const beads = useRef<THREE.InstancedMesh>(null);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const facing = Math.atan2(ROOM.spawn.x - MALA_AT.x, ROOM.spawn.z - MALA_AT.z);
  const touching = useRef<Record<"left" | "right", boolean>>({ left: false, right: false });

  const next = () => {
    setCount((was) => {
      const now = was + 1;
      click(now % BEADS === 0);
      return now;
    });
  };

  useFrame((_, delta) => {
    shown.current += (count - shown.current) * Math.min(1, delta * 8);
    const mesh = beads.current;
    if (mesh) {
      for (let i = 0; i < BEADS; i += 1) {
        const at = beadAt(i, shown.current);
        const size = i === 0 ? 0.016 : 0.009;
        matrix.makeScale(size, size, size).setPosition(at.x, at.y, 0);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    // A fingertip at the bottom of the loop, where your thumb would be, moves a bead.
    const now = performance.now();
    const bottom = beadAt(0, 0);
    for (const side of ["left", "right"] as const) {
      const hand = goHandInput[side];
      if (!hand || now - hand.at > 200) {
        touching.current[side] = false;
        continue;
      }
      const dx = hand.contact.x - MALA_AT.x;
      const dz = hand.contact.z - MALA_AT.z;
      const across = dx * Math.cos(facing) - dz * Math.sin(facing);
      const front = dx * Math.sin(facing) + dz * Math.cos(facing);
      const on = Math.hypot(across - bottom.x, hand.contact.y - bottom.y) < 0.04 && Math.abs(front) < 0.05;
      if (on && !touching.current[side]) next();
      touching.current[side] = on;
    }
  });

  const round = Math.floor(count / BEADS);
  const within = count % BEADS;

  return (
    <group position={[MALA_AT.x, 0, MALA_AT.z]} rotation={[0, facing, 0]}>
      {/* The stand: a post and a peg. */}
      <mesh position={[0, 0.7, -0.1]} raycast={() => null}>
        <boxGeometry args={[0.04, 1.36, 0.04]} />
        <meshStandardMaterial color="#3a2a1d" roughness={0.8} />
      </mesh>
      <mesh position={[0, LOOP.centre + LOOP.radius * 1.25 + 0.03, -0.05]} rotation-x={Math.PI / 2} raycast={() => null}>
        <cylinderGeometry args={[0.008, 0.008, 0.14, 8]} />
        <meshStandardMaterial color="#6b4a2f" roughness={0.7} />
      </mesh>
      {/* The beads: pinch any of them to move one along. */}
      <instancedMesh
        ref={beads}
        args={[undefined, undefined, BEADS]}
        frustumCulled={false}
        onClick={(event) => {
          event.stopPropagation();
          next();
        }}
      >
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial color="#7a4a2a" roughness={0.45} />
      </instancedMesh>
      {/* The tassel under the guru bead. */}
      <mesh position={[0, LOOP.centre - LOOP.radius * 1.25 - 0.06, 0]} raycast={() => null}>
        <coneGeometry args={[0.018, 0.08, 10]} />
        <meshStandardMaterial color="#a8262c" roughness={0.9} />
      </mesh>
      <Text position={[0, 0.55, 0.03]} fontSize={0.03} color="#eadcc0" outlineWidth={0.002} outlineColor="#2a1a0a" raycast={() => null}>
        {count === 0 ? "MALA · pinch a bead for each breath" : `${within} of 108${round ? ` · ${round} round${round > 1 ? "s" : ""}` : ""}`}
      </Text>
    </group>
  );
}
