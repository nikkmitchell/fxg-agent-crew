import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { audio } from "./breath-sound";

/**
 * THE CONCH on a tall stone by the tide pool, at ear height. Lean your head
 * close to it and you hear the sea inside: a hollow, resonant roar that swells
 * the nearer you are and is silent a hand's width away. Only you hear it.
 */

export const CONCH_AT = { x: -2.6, z: -0.6, y: 1.35 } as const;
/** How close your head must be before the sea begins, in metres. */
const REACH = 0.35;

/** How loud the sea in the shell is with your head `distance` metres from it. */
export function conchLevel(distance: number): number {
  if (distance >= REACH) return 0;
  return (1 - distance / REACH) ** 2;
}

function seaInShell(): { set: (level: number, seconds: number) => void; stop: () => void } {
  const ctx = audio();
  if (!ctx) return { set: () => {}, stop: () => {} };
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  // A shell is a resonator: two narrow bands give it the hollow sound.
  const low = ctx.createBiquadFilter();
  low.type = "bandpass";
  low.frequency.value = 380;
  low.Q.value = 6;
  const high = ctx.createBiquadFilter();
  high.type = "bandpass";
  high.frequency.value = 1150;
  high.Q.value = 9;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(low).connect(gain);
  source.connect(high).connect(gain);
  gain.connect(ctx.destination);
  source.start();
  return {
    // A slow swell inside the roar, like distant surf.
    set: (level, seconds) => gain.gain.setTargetAtTime(level * (0.5 + 0.25 * Math.sin(seconds * 0.6)), ctx.currentTime, 0.15),
    stop: () => {
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
      setTimeout(() => source.stop(), 1000);
    },
  };
}

export function Conch() {
  const sound = useRef<ReturnType<typeof seaInShell> | null>(null);
  useEffect(() => () => sound.current?.stop(), []);
  const eye = useMemo(() => new THREE.Vector3(), []);
  const shell = useRef<THREE.Group>(null);
  const at = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    state.camera.getWorldPosition(eye);
    shell.current?.getWorldPosition(at);
    const level = conchLevel(eye.distanceTo(at));
    if (level > 0 && !sound.current) sound.current = seaInShell();
    sound.current?.set(level, state.clock.elapsedTime);
  });

  // The shell: a spiral of shrinking, turning lobes, and a flared lip.
  const lobes = useMemo(() => Array.from({ length: 7 }, (_, i) => ({ r: 0.07 * 0.8 ** i, x: i * 0.03, turn: i * 0.9 })), []);
  return (
    <group position={[CONCH_AT.x, 0, CONCH_AT.z]}>
      <mesh position={[0, (CONCH_AT.y - 0.06) / 2, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.09, 0.14, CONCH_AT.y - 0.06, 9]} />
        <meshStandardMaterial color="#5a554c" roughness={0.95} flatShading />
      </mesh>
      <group ref={shell} position={[0, CONCH_AT.y, 0]} rotation-z={0.3}>
        {lobes.map((lobe, i) => (
          <mesh key={i} position={[lobe.x, Math.sin(lobe.turn) * 0.01, Math.cos(lobe.turn) * 0.01]} scale={[lobe.r * 1.3, lobe.r, lobe.r]} raycast={() => null}>
            <sphereGeometry args={[1, 12, 8]} />
            <meshStandardMaterial color={i % 2 ? "#e9d6c0" : "#f2e4d2"} roughness={0.5} />
          </mesh>
        ))}
        <mesh position={[-0.06, 0, 0]} rotation-z={Math.PI / 2} raycast={() => null}>
          <coneGeometry args={[0.07, 0.07, 14, 1, true]} />
          <meshStandardMaterial color="#f4b8a4" roughness={0.4} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <Text position={[0, CONCH_AT.y + 0.16, 0]} fontSize={0.035} color="#e8e0cf" outlineWidth={0.002} outlineColor="#1a1714" raycast={() => null}>
        lean close and listen
      </Text>
    </group>
  );
}
