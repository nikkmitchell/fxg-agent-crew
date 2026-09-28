import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { audio } from "./breath-sound";

/**
 * THE RAIN CURTAIN: a circle of soft rain falling out of nothing, back-right of
 * the room. From outside it is a column of silver streaks and faint rings on
 * the floor; step inside and the rain falls all round you, and you hear it,
 * louder the further in you go. Stand in it for a minute.
 *
 * Nothing sent or stored: the rain is the same for everyone because it is
 * drawn from the clock, and the sound is only for whoever is standing in it.
 */

export const RAIN_AT = { x: 3.6, z: 0.3, radius: 0.9, top: 2.7 } as const;
const DROPS = 420;
const FALL_SPEED = 4.2;

/** How loud the rain is for someone `distance` metres from its middle: full inside, gone two metres out. */
export function rainLevel(distance: number): number {
  if (distance <= RAIN_AT.radius) return 1;
  return Math.max(0, 1 - (distance - RAIN_AT.radius) / 2);
}

function rainSound(): { set: (level: number) => void; stop: () => void } {
  const ctx = audio();
  if (!ctx) return { set: () => {}, stop: () => {} };
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 2400;
  band.Q.value = 0.6;
  const low = ctx.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 6000;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(band).connect(low).connect(gain).connect(ctx.destination);
  source.start();
  return {
    set: (level) => gain.gain.setTargetAtTime(level * 0.09, ctx.currentTime, 0.5),
    stop: () => {
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      setTimeout(() => source.stop(), 1500);
    },
  };
}

export function RainCurtain() {
  const drops = useRef<THREE.InstancedMesh>(null);
  const rings = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(
    () =>
      Array.from({ length: DROPS }, () => {
        const r = Math.sqrt(Math.random()) * RAIN_AT.radius;
        const a = Math.random() * Math.PI * 2;
        return { x: Math.cos(a) * r, z: Math.sin(a) * r, offset: Math.random() * 10, speed: 0.85 + Math.random() * 0.3 };
      }),
    [],
  );
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const scale = useMemo(() => new THREE.Vector3(), []);
  const position = useMemo(() => new THREE.Vector3(), []);
  const turn = useMemo(() => new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), []);
  const still = useMemo(() => new THREE.Quaternion(), []);
  const eye = useMemo(() => new THREE.Vector3(), []);
  const sound = useRef<ReturnType<typeof rainSound> | null>(null);
  useEffect(() => () => sound.current?.stop(), []);

  useFrame((state) => {
    const t = Date.now() / 1000;
    const fall = RAIN_AT.top / FALL_SPEED;
    seeds.forEach((drop, index) => {
      const phase = ((t * drop.speed + drop.offset) % fall) / fall;
      const y = RAIN_AT.top * (1 - phase);
      position.set(drop.x, y, drop.z);
      scale.set(1, 1, 1);
      matrix.compose(position, still, scale);
      drops.current?.setMatrixAt(index, matrix);
      // A ring spreading where each drop landed, for a moment after it did.
      if (index < 70) {
        const since = phase * fall;
        const grow = Math.min(1, since * 3);
        position.set(drop.x, 0.012, drop.z);
        scale.setScalar(0.02 + grow * 0.09);
        matrix.compose(position, turn, scale);
        rings.current?.setMatrixAt(index, matrix);
      }
    });
    if (drops.current) drops.current.instanceMatrix.needsUpdate = true;
    if (rings.current) rings.current.instanceMatrix.needsUpdate = true;

    state.camera.getWorldPosition(eye);
    const level = rainLevel(Math.hypot(eye.x - RAIN_AT.x, eye.z - RAIN_AT.z));
    if (level > 0 && !sound.current) sound.current = rainSound();
    sound.current?.set(level);
  });

  return (
    <group position={[RAIN_AT.x, 0, RAIN_AT.z]}>
      <instancedMesh ref={drops} args={[undefined, undefined, DROPS]} raycast={() => null} frustumCulled={false}>
        <boxGeometry args={[0.003, 0.16, 0.003]} />
        <meshBasicMaterial color="#cfe3f5" transparent opacity={0.45} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={rings} args={[undefined, undefined, 70]} raycast={() => null} frustumCulled={false}>
        <ringGeometry args={[0.85, 1, 24]} />
        <meshBasicMaterial color="#bcd6ee" transparent opacity={0.12} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </instancedMesh>
      {/* A dark wet patch where the rain lands. */}
      <mesh position={[0, 0.006, 0]} rotation-x={-Math.PI / 2} raycast={() => null}>
        <circleGeometry args={[RAIN_AT.radius + 0.1, 48]} />
        <meshBasicMaterial color="#0d1a24" transparent opacity={0.35} depthWrite={false} />
      </mesh>
    </group>
  );
}
