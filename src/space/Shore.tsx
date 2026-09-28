import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { audio } from "./breath-sound";

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

export function Shore() {
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
    <mesh position={[SHORE_AT.x, 0.008, SHORE_AT.z]} rotation={[-Math.PI / 2, 0, Math.PI]} material={material} raycast={() => null}>
      <planeGeometry args={[SHORE_AT.width, SHORE_AT.depth]} />
    </mesh>
  );
}
