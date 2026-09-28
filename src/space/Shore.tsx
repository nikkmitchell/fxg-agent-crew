import { useEffect, useMemo, useRef, useState } from "react";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { audio } from "./breath-sound";
import { DRIFT_WORDS, driftAt, type Drift } from "../../shared/driftwood";
import { onDrift } from "./driftwood-events";
import { space } from "../space-client";

/**
 * THE SHORE: a strip of pale sand in the back-left corner where small waves
 * roll in, spread into a thin lace of foam, and draw back, about once every
 * eight seconds, a little like breathing. The sound of them grows as you walk
 * over, and is gone a few steps away. The same waves for everyone (the clock).
 */

export const SHORE_AT = { x: -4.8, z: 0.4, width: 1.6, depth: 1.0 } as const;
/** One wave: in, spread, and back. */
export const WAVE_SECONDS = 8;

/** How far up the sand the water reaches at `seconds`, 0 (low) to 1 (high). */
export function reachAt(seconds: number): number {
  const t = ((seconds % WAVE_SECONDS) + WAVE_SECONDS) % WAVE_SECONDS / WAVE_SECONDS;
  // Rushes in over the first third, lingers, then slides back more slowly.
  return t < 0.33 ? Math.sin((t / 0.33) * (Math.PI / 2)) : Math.cos(((t - 0.33) / 0.67) * (Math.PI / 2)) ** 1.5;
}

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const fragment = /* glsl */ `
  uniform float uReach;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    // vUv.y: 0 at the sea end, 1 at the dry sand.
    float edge = 0.15 + uReach * 0.55 + sin(vUv.x * 18.0 + uTime * 0.6) * 0.02 + sin(vUv.x * 41.0 - uTime) * 0.01;
    float wet = smoothstep(edge + 0.02, edge - 0.02, vUv.y);
    float foam = smoothstep(0.035, 0.0, abs(vUv.y - edge)) * (0.6 + 0.4 * sin(vUv.x * 90.0 + uTime * 2.0));
    vec3 sand = vec3(0.86, 0.8, 0.66);
    vec3 dampSand = vec3(0.62, 0.56, 0.45);
    vec3 sea = mix(vec3(0.12, 0.3, 0.36), vec3(0.28, 0.5, 0.55), vUv.y * 1.5);
    // Sand darkens where the water has just been.
    float damp = smoothstep(edge + 0.2, edge, vUv.y);
    vec3 colour = mix(mix(sand, dampSand, damp), sea, wet * 0.85) + vec3(1.0) * foam * 0.7;
    // The far edge fades into the room.
    float fade = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x) * smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
    gl_FragColor = vec4(colour, fade * 0.95);
  }
`;

function waves(): { set: (level: number, reach: number) => void; stop: () => void } {
  const ctx = audio();
  if (!ctx) return { set: () => {}, stop: () => {} };
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i += 1) {
    last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04;
    data[i] = last * 4;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start();
  return {
    // The wash is louder and brighter as a wave comes in.
    set: (level, reach) => {
      gain.gain.setTargetAtTime(level * (0.03 + reach * 0.09), ctx.currentTime, 0.2);
      filter.frequency.setTargetAtTime(500 + reach * 2200, ctx.currentTime, 0.2);
    },
    stop: () => {
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      setTimeout(() => source.stop(), 1500);
    },
  };
}

/** One piece of driftwood with a word on it, floating out on its own clock. */
function Driftwood({ drift, slot, onGone }: { drift: Drift & { started: number }; slot: number; onGone: () => void }) {
  const group = useRef<THREE.Group>(null);
  const words = useRef<{ fillOpacity: number } | null>(null);
  const wood = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    const place = driftAt((performance.now() - drift.started) / 1000);
    if (place.fade <= 0) return onGone();
    // Out is toward the sea: -z, the back of the room.
    group.current?.position.set(SHORE_AT.x + (slot - 1) * 0.35, 0.03 + place.bob, SHORE_AT.z + 0.1 - place.out);
    if (wood.current) wood.current.opacity = place.fade;
    if (words.current) words.current.fillOpacity = place.fade;
  });
  return (
    <group ref={group} rotation-y={(slot - 1) * 0.25}>
      <mesh rotation-z={Math.PI / 2} raycast={() => null}>
        <cylinderGeometry args={[0.025, 0.03, 0.34, 8]} />
        <meshStandardMaterial ref={wood} color="#9c8a70" roughness={1} transparent />
      </mesh>
      <Text ref={words as never} position={[0, 0.032, 0]} rotation-x={-Math.PI / 2} fontSize={0.05} color="#fff4dc" outlineWidth={0.003} outlineColor="#2a1f14" raycast={() => null}>
        {drift.word}
      </Text>
    </group>
  );
}

export function Shore({ you = null }: { you?: string | null }) {
  const [drifts, setDrifts] = useState<(Drift & { started: number; key: number })[]>([]);
  const next = useRef(0);
  const [note, setNote] = useState<string | null>(null);
  const launch = (drift: Drift) => setDrifts((all) => [...all.slice(-2), { ...drift, started: performance.now(), key: next.current++ }]);
  useEffect(
    () =>
      onDrift((drift) => {
        if (you && drift.by.toLowerCase() === you.toLowerCase()) return;
        launch(drift);
      }),
    [you],
  );
  const write = (word: string) => {
    setNote(null);
    launch({ by: you ?? "", word, at: Date.now() });
    space.writeOnDriftwood(word).catch((error: unknown) => setNote(error instanceof Error ? error.message : "The sea is resting."));
  };
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { uReach: { value: 0 }, uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const sound = useRef<ReturnType<typeof waves> | null>(null);
  useEffect(() => () => sound.current?.stop(), []);
  const eye = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    const reach = reachAt(Date.now() / 1000);
    material.uniforms.uReach.value = reach;
    material.uniforms.uTime.value = state.clock.elapsedTime;
    state.camera.getWorldPosition(eye);
    const distance = Math.hypot(eye.x - SHORE_AT.x, eye.z - SHORE_AT.z);
    const level = Math.max(0, 1 - distance / 4);
    if (level > 0 && !sound.current) sound.current = waves();
    sound.current?.set(level, reach);
  });

  // The sea is toward the room's back wall (-z), the dry sand toward you.
  return (
    <group>
      <mesh position={[SHORE_AT.x, 0.008, SHORE_AT.z]} rotation={[-Math.PI / 2, 0, Math.PI]} material={material} raycast={() => null}>
        <planeGeometry args={[SHORE_AT.width, SHORE_AT.depth]} />
      </mesh>
      {drifts.map((drift, index) => (
        <Driftwood key={drift.key} drift={drift} slot={index} onGone={() => setDrifts((all) => all.filter((one) => one.key !== drift.key))} />
      ))}
      {/* A low post at the dry end: tap a word and a wave takes it. */}
      <group position={[SHORE_AT.x + SHORE_AT.width / 2 + 0.2, 0, SHORE_AT.z + 0.3]} rotation-y={-0.5}>
        <mesh position={[0, 0.35, 0]} raycast={() => null}>
          <boxGeometry args={[0.05, 0.7, 0.05]} />
          <meshStandardMaterial color="#7d6c55" roughness={1} />
        </mesh>
        <Text position={[0, 0.82, 0.03]} fontSize={0.035} color="#e8e0cf" outlineWidth={0.002} outlineColor="#1a1714" raycast={() => null}>
          {note ?? "SEND SOMETHING OUT TO SEA"}
        </Text>
        {DRIFT_WORDS.map((word, index) => (
          <Text
            key={word}
            position={[((index % 3) - 1) * 0.16, 0.74 - Math.floor(index / 3) * 0.06, 0.03]}
            fontSize={0.035}
            color="#bfe3e6"
            outlineWidth={0.002}
            outlineColor="#10262a"
            onClick={(event) => {
              event.stopPropagation();
              write(word);
            }}
          >
            {word}
          </Text>
        ))}
      </group>
    </group>
  );
}
