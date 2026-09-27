import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { POND_AT } from "./KoiPond";
import { audio } from "./breath-sound";

/**
 * THE SHISHI-ODOSHI at the edge of the koi pond: a bamboo pipe trickles into a
 * pivoting bamboo tube; when the tube is full it tips, pours into the pond, and
 * swings back to knock against a stone with a hollow clack. Then it fills
 * again. A clock you can hear, marking a slow, steady time for sitting by the
 * water.
 *
 * Drawn from the shared clock, so the knock lands at the same moment for
 * everyone; heard only near the pond.
 */

/** One fill-tip-knock, in seconds. */
export const CYCLE_SECONDS = 14;

/**
 * The tube's tilt at `seconds` into a cycle, in radians: resting with its mouth
 * up while it fills, a quick tip down to pour, and the fall back that knocks.
 */
export function tiltAt(seconds: number): number {
  const t = ((seconds % CYCLE_SECONDS) + CYCLE_SECONDS) % CYCLE_SECONDS;
  const rest = -0.35;
  const tipped = 0.55;
  const fill = CYCLE_SECONDS - 1.6;
  if (t < fill) return rest + (t / fill) * 0.12; // slowly heavier as it fills
  if (t < fill + 0.5) return rest + 0.12 + ((t - fill) / 0.5) * (tipped - rest - 0.12);
  if (t < fill + 0.9) return tipped;
  const back = Math.min(1, (t - fill - 0.9) / 0.25);
  return tipped + (rest - tipped) * back;
}

/** The moment in each cycle the tube strikes the stone. */
export const KNOCK_AT = CYCLE_SECONDS - 1.6 + 0.9 + 0.25;

function knock(level: number): void {
  const ctx = audio();
  if (!ctx || level <= 0) return;
  const at = ctx.currentTime;
  // A hollow wooden clack: a quick drop in pitch through a resonant body.
  for (const [f, loud, decay] of [[520, 0.12, 0.18], [1180, 0.05, 0.08], [240, 0.06, 0.25]] as const) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(f * 1.15, at);
    osc.frequency.exponentialRampToValueAtTime(f, at + 0.03);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(loud * level, at + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }
}

const KNOCKER_AT = { x: POND_AT.x + 0.55, z: POND_AT.z + 0.62 } as const;

export function BambooKnocker() {
  const tube = useRef<THREE.Group>(null);
  const stream = useRef<THREE.Mesh>(null);
  const lastCycle = useRef<number | null>(null);
  const eye = useRef(new THREE.Vector3());

  useFrame((state) => {
    const seconds = Date.now() / 1000;
    if (tube.current) tube.current.rotation.z = tiltAt(seconds);
    const phase = seconds % CYCLE_SECONDS;
    if (stream.current) stream.current.visible = phase > CYCLE_SECONDS - 1.1 && phase < CYCLE_SECONDS - 0.7;
    const cycle = Math.floor((seconds - KNOCK_AT) / CYCLE_SECONDS);
    if (lastCycle.current !== null && cycle > lastCycle.current) {
      state.camera.getWorldPosition(eye.current);
      const distance = Math.hypot(eye.current.x - KNOCKER_AT.x, eye.current.z - KNOCKER_AT.z);
      knock(Math.max(0, 1 - distance / 6));
    }
    lastCycle.current = cycle;
  });

  const bamboo = "#9fae5a";
  return (
    <group position={[KNOCKER_AT.x, 0, KNOCKER_AT.z]} rotation-y={-0.9}>
      {/* Two posts holding the pivot. */}
      {[-0.05, 0.05].map((z) => (
        <mesh key={z} position={[0, 0.25, z]} raycast={() => null}>
          <cylinderGeometry args={[0.018, 0.018, 0.5, 10]} />
          <meshStandardMaterial color={bamboo} roughness={0.6} />
        </mesh>
      ))}
      {/* The tube on its pivot: mouth toward the pond, the heavy end on the stone. */}
      <group ref={tube} position={[0, 0.46, 0]}>
        <mesh position={[-0.12, 0, 0]} rotation-z={Math.PI / 2} raycast={() => null}>
          <cylinderGeometry args={[0.028, 0.028, 0.55, 14]} />
          <meshStandardMaterial color={bamboo} roughness={0.55} />
        </mesh>
        {[-0.3, -0.05, 0.12].map((x) => (
          <mesh key={x} position={[x, 0, 0]} rotation-z={Math.PI / 2} raycast={() => null}>
            <torusGeometry args={[0.029, 0.004, 6, 16]} />
            <meshStandardMaterial color="#7f8c45" roughness={0.6} />
          </mesh>
        ))}
      </group>
      {/* The stone it knocks on. */}
      <mesh position={[0.18, 0.08, 0]} scale={[0.09, 0.08, 0.08]} raycast={() => null}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#6a6660" roughness={0.9} flatShading />
      </mesh>
      {/* The spout above, and its trickle. */}
      <mesh position={[-0.32, 0.72, 0]} rotation-z={-0.4} raycast={() => null}>
        <cylinderGeometry args={[0.018, 0.018, 0.3, 10]} />
        <meshStandardMaterial color={bamboo} roughness={0.6} />
      </mesh>
      <mesh position={[-0.38, 0.6, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.003, 0.003, 0.14, 4]} />
        <meshBasicMaterial color="#cfe3f5" transparent opacity={0.6} />
      </mesh>
      {/* The pour into the pond as it tips. */}
      <mesh ref={stream} position={[-0.42, 0.33, 0]} visible={false} raycast={() => null}>
        <cylinderGeometry args={[0.012, 0.004, 0.18, 6]} />
        <meshBasicMaterial color="#cfe3f5" transparent opacity={0.7} />
      </mesh>
    </group>
  );
}
